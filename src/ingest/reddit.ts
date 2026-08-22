/**
 * Bright Data Reddit ingest. Terminal only, per CLAUDE.md's Scraper Studio section.
 *
 * Subreddit -> source_type / company mapping (docs/USE_CASES.md):
 *   r/Notion, r/SaaS, r/productivity   -> source_type 'trend',      company_id null
 *   r/Linear                           -> source_type 'competitor', company_id co-linear
 *   r/asana                            -> source_type 'competitor', company_id co-asana
 *   r/Notion (Notion-affiliated proxy) -> source_type 'own',        company_id co-notion
 *
 * Flow: fetch -> cache raw JSON to ./data/raw/ BEFORE parsing -> validate with Zod ->
 * upsert into posts -> assert records_extracted > 0 or throw. A 200 with 0 records is
 * a failure, not a success (docs/USE_CASES.md, CLAUDE.md Bright Data section).
 *
 * Usage:
 *   bun run src/ingest/reddit.ts                # real fetch, needs BRIGHTDATA_PROXY_* (web_unlocker1 zone)
 *   bun run src/ingest/reddit.ts --cached        # replay most recent ./data/raw/ file
 *
 * Bright Data's direct API (BRIGHTDATA_API_TOKEN / collector trigger) is unavailable
 * while the account shows "suspended, contact account manager". Live fetch instead
 * proxies each subreddit's public JSON listing through the web_unlocker1 zone via
 * undici's ProxyAgent. If that zone is blocked by the same suspension, this fails
 * loudly (non-zero exit, span failure_reason set) rather than pretending to succeed.
 */
import { z } from 'zod';
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ProxyAgent, fetch as undiciFetch } from 'undici';
import { migrate } from '../db/migrate.js';
import { withSpan } from '../otel';

const RAW_DIR = './data/raw';
const PLATFORM = 'reddit';

// Subreddit -> row shape mapping, filled in from the Wednesday dry run per CLAUDE.md.
const SUBREDDIT_MAP: Record<string, { source_type: 'trend' | 'competitor' | 'own'; company_id: string | null }> = {
  notion: { source_type: 'trend', company_id: null },
  saas: { source_type: 'trend', company_id: null },
  productivity: { source_type: 'trend', company_id: null },
  linear: { source_type: 'competitor', company_id: 'co-linear' },
  asana: { source_type: 'competitor', company_id: 'co-asana' },
};
const SUBREDDITS = Object.keys(SUBREDDIT_MAP);

// Bright Data Reddit collector record shape. Loose on purpose: validate only the
// fields this pipeline actually reads, since the collector may add fields over time.
const RedditRecord = z.object({
  id: z.string().optional(),
  post_id: z.string().optional(),
  url: z.string().optional(),
  user_posted: z.string().optional(),
  author: z.string().optional(),
  title: z.string().optional(),
  description: z.string().optional(),
  text: z.string().optional(),
  community_name: z.string().optional(),
  subreddit: z.string().optional(),
  date_posted: z.string().optional(),
  created_at: z.string().optional(),
});
const RedditPayload = z.array(RedditRecord);
type RedditRecord = z.infer<typeof RedditRecord>;

function normalize(rec: RedditRecord) {
  const id = rec.id ?? rec.post_id;
  const text = [rec.title, rec.description ?? rec.text].filter(Boolean).join('\n\n').trim();
  const author = rec.user_posted ?? rec.author ?? 'unknown';
  const subreddit = (rec.community_name ?? rec.subreddit ?? '').toLowerCase().replace(/^r\//, '');
  const posted_at = rec.date_posted ?? rec.created_at ?? new Date().toISOString();
  return { id, text, author, subreddit, url: rec.url, posted_at };
}

function cachePath(iso: string) {
  return join(RAW_DIR, `${PLATFORM}-${iso.slice(0, 10)}.json`);
}

function proxyEnv() {
  return {
    host: process.env.BRIGHTDATA_PROXY_HOST,
    port: process.env.BRIGHTDATA_PROXY_PORT,
    username: process.env.BRIGHTDATA_PROXY_USERNAME,
    password: process.env.BRIGHTDATA_PROXY_PASSWORD,
  };
}

function hasProxyConfig(): boolean {
  const { host, port, username, password } = proxyEnv();
  return Boolean(host && port && username && password);
}

// Bright Data account is currently suspended, so the Bearer-token collector API
// (api.brightdata.com/dca/trigger_immediate) is unavailable. Fall back to the
// web_unlocker1 proxy zone: proxy each subreddit's public JSON listing through
// Bright Data's Web Unlocker so requests come from Bright Data's IP pool instead
// of ours. This proxy zone may ALSO be blocked by the same suspension -- that is
// an expected failure mode here, not a bug, and must surface loudly rather than
// being swallowed.
async function fetchFromBrightData(): Promise<unknown> {
  const { host, port, username, password } = proxyEnv();
  if (!host || !port || !username || !password) {
    throw new Error('BRIGHTDATA_PROXY_HOST/PORT/USERNAME/PASSWORD missing');
  }

  const proxyUrl = `http://${username}:${password}@${host}:${port}`;
  const dispatcher = new ProxyAgent(proxyUrl);

  const merged: unknown[] = [];
  const errors: string[] = [];

  for (const subreddit of SUBREDDITS) {
    try {
      const res = await undiciFetch(`https://www.reddit.com/r/${subreddit}.json`, {
        dispatcher,
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; trendwatch-ingest/1.0)' },
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) {
        errors.push(`r/${subreddit}: HTTP ${res.status}`);
        continue;
      }
      const body: any = await res.json();
      const children = body?.data?.children ?? [];
      for (const c of children) {
        const d = c?.data ?? {};
        merged.push({
          id: d.id ? `t3_${d.id}` : d.name,
          url: d.url ?? (d.permalink ? `https://www.reddit.com${d.permalink}` : undefined),
          user_posted: d.author,
          title: d.title,
          description: d.selftext,
          community_name: d.subreddit,
          date_posted: typeof d.created_utc === 'number' ? new Date(d.created_utc * 1000).toISOString() : undefined,
        });
      }
    } catch (err) {
      // undici wraps the real proxy error a couple of `cause` layers deep (e.g.
      // "Proxy response (407) !== 200 when HTTP Tunneling" for a suspended or
      // unauthorized account) behind a generic top-level "fetch failed" message.
      // Walk the chain so observability sees the real reason, not the wrapper.
      let cur: unknown = err;
      let reason = String(err);
      while (cur instanceof Error) {
        reason = cur.message;
        cur = (cur as { cause?: unknown }).cause;
      }
      errors.push(`r/${subreddit}: ${reason}`);
    }
  }

  await dispatcher.close();

  if (merged.length === 0) {
    // All subreddits failed (or all returned zero usable rows), most likely the
    // suspended-account proxy being blocked too. Fail loudly with the real
    // per-subreddit errors instead of silently returning an empty array.
    throw new Error(`proxied fetch produced 0 records across ${SUBREDDITS.length} subreddit(s): ${errors.join(' | ') || 'no data in any response'}`);
  }

  return merged;
}

function loadMostRecentCache(): { path: string; data: unknown } {
  mkdirSync(RAW_DIR, { recursive: true });
  const files = readdirSync(RAW_DIR)
    .filter((f) => f.startsWith(`${PLATFORM}-`) && f.endsWith('.json'))
    .sort()
    .reverse();
  if (files.length === 0) {
    throw new Error(`no cached files in ${RAW_DIR} for platform ${PLATFORM}`);
  }
  const path = join(RAW_DIR, files[0]);
  return { path, data: JSON.parse(readFileSync(path, 'utf-8')) };
}

export async function ingestReddit(opts: { cached: boolean }) {
  return withSpan('ingest.reddit', async (span) => {
    span.setAttr('platform', PLATFORM);
    span.setAttr('mode', opts.cached ? 'cached' : 'live');

    let raw: unknown;
    let cachePathUsed: string;

    if (opts.cached) {
      const { path, data } = loadMostRecentCache();
      raw = data;
      cachePathUsed = path;
    } else {
      if (!hasProxyConfig()) {
        // Non-fatal: log clearly and exit without crashing the app, per the
        // instruction that missing credentials must not throw.
        console.log('[ingest:reddit] BRIGHTDATA_PROXY_* vars not set. Skipping live fetch.');
        console.log('[ingest:reddit] Run with --cached to replay a cached payload, or set the proxy vars in .env.local.');
        span.setAttr('failure_reason', 'no proxy config, skipped');
        span.setRecordCount(0);
        return { skipped: true, records_extracted: 0 };
      }
      raw = await fetchFromBrightData();
      const iso = new Date().toISOString();
      cachePathUsed = cachePath(iso);
      mkdirSync(RAW_DIR, { recursive: true });
      // Cache BEFORE parsing, so a bad payload is still recoverable from disk.
      writeFileSync(cachePathUsed, JSON.stringify(raw, null, 2));
    }

    const parsed = RedditPayload.safeParse(raw);
    if (!parsed.success) {
      span.setAttr('failure_reason', `schema validation failed: ${parsed.error.issues.slice(0, 3).map((i) => i.message).join('; ')}`);
      throw new Error(`Reddit payload failed schema validation: ${parsed.error.issues.length} issue(s)`);
    }

    const db = migrate();
    const upsert = db.prepare(`
      insert into posts (id, company_id, source_type, platform, author, url, text, posted_at, fetched_at)
      values (@id, @company_id, @source_type, @platform, @author, @url, @text, @posted_at, @fetched_at)
      on conflict(id) do update set
        text = excluded.text, url = excluded.url, posted_at = excluded.posted_at, fetched_at = excluded.fetched_at
    `);

    const fetchedAt = new Date().toISOString();
    let written = 0;
    const tx = db.transaction((records: RedditRecord[]) => {
      for (const rec of records) {
        const n = normalize(rec);
        if (!n.id || !n.text) continue; // no stable join key or nothing to say, skip
        const mapping = SUBREDDIT_MAP[n.subreddit] ?? { source_type: 'trend' as const, company_id: null };
        upsert.run({
          id: n.id,
          company_id: mapping.company_id,
          source_type: mapping.source_type,
          platform: PLATFORM,
          author: n.author,
          url: n.url ?? null,
          text: n.text,
          posted_at: n.posted_at,
          fetched_at: fetchedAt,
        });
        written += 1;
      }
    });
    tx(parsed.data);
    db.close();

    span.setRecordCount(written);
    span.setAttr('cache_path', cachePathUsed);

    if (written === 0) {
      // Grounding rule: a 200 with zero rows is the expected failure mode, not a
      // warning. Fail loudly regardless of HTTP status.
      span.setAttr('failure_reason', 'records_extracted is 0');
      throw new Error('records_extracted is 0: fetch succeeded but produced no usable rows');
    }

    console.log(`[ingest:reddit] ${written} records from ${cachePathUsed} (${opts.cached ? 'cached' : 'live'})`);
    return { skipped: false, records_extracted: written, cache_path: cachePathUsed };
  });
}

// CLI entry point.
if (process.argv[1] && process.argv[1].endsWith('reddit.ts')) {
  const cached = process.argv.includes('--cached');
  ingestReddit({ cached })
    .then((result) => {
      console.log('[ingest:reddit] summary', result);
      process.exit(0);
    })
    .catch((err) => {
      console.error('[ingest:reddit] FAILED', err.message);
      process.exit(1);
    });
}
