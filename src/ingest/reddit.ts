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
 *   bun run src/ingest/reddit.ts                # real fetch, needs BRIGHTDATA_API_TOKEN
 *   bun run src/ingest/reddit.ts --cached        # replay most recent ./data/raw/ file
 *
 * Live fetch goes through Bright Data's Direct API (Web Unlocker, Bearer token) --
 * POST https://api.brightdata.com/request with { zone, url, format: 'raw', country: 'us' }.
 * The `country` param is required: without it Bright Data's exit node selection for
 * reddit.com returns HTTP 200 with an empty body (verified directly), which reads
 * exactly like the "silent 200" failure mode this project's whole grounding story is
 * built around -- it just isn't the failure mode here, it's a missing request param.
 * The web_unlocker1 *proxy* zone (BRIGHTDATA_PROXY_*) consistently 407'd even with
 * correct credentials and an active account; Direct API is the path that actually works.
 */
import { z } from 'zod';
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { migrate } from '../db/migrate';
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

const BRIGHTDATA_ZONE = 'web_unlocker1';

function hasApiConfig(): boolean {
  return Boolean(process.env.BRIGHTDATA_API_TOKEN);
}

/**
 * Fetches one subreddit's public JSON listing through Bright Data's Direct API
 * (Web Unlocker product, Bearer token). Shared by the full multi-subreddit sweep
 * (fetchFromBrightData) and the single-subreddit, per-chat-question attempt
 * (attemptTargetedFetch) so this exists in exactly one place. `country: 'us'` is
 * required -- omitting it gets a 200 with an empty body from Bright Data's default
 * exit-node selection for this target, verified directly against the live API.
 */
async function fetchSubredditViaBrightData(subreddit: string): Promise<{ records: unknown[]; error?: string }> {
  const token = process.env.BRIGHTDATA_API_TOKEN;
  try {
    const res = await fetch('https://api.brightdata.com/request', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        zone: BRIGHTDATA_ZONE,
        url: `https://www.reddit.com/r/${subreddit}.json`,
        format: 'raw',
        country: 'us',
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      return { records: [], error: `r/${subreddit}: HTTP ${res.status} ${detail.slice(0, 200)}` };
    }
    const text = await res.text();
    if (!text) {
      return { records: [], error: `r/${subreddit}: 200 with empty body (blocked or JS shell)` };
    }
    let body: any;
    try {
      body = JSON.parse(text);
    } catch {
      return { records: [], error: `r/${subreddit}: 200 but response was not valid JSON (${text.length} bytes, likely a block page)` };
    }
    const children = body?.data?.children ?? [];
    const records = children.map((c: any) => {
      const d = c?.data ?? {};
      return {
        id: d.id ? `t3_${d.id}` : d.name,
        url: d.url ?? (d.permalink ? `https://www.reddit.com${d.permalink}` : undefined),
        user_posted: d.author,
        title: d.title,
        description: d.selftext,
        community_name: d.subreddit,
        date_posted: typeof d.created_utc === 'number' ? new Date(d.created_utc * 1000).toISOString() : undefined,
      };
    });
    return { records };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return { records: [], error: `r/${subreddit}: ${reason}` };
  }
}

async function fetchFromBrightData(): Promise<unknown> {
  if (!hasApiConfig()) {
    throw new Error('BRIGHTDATA_API_TOKEN missing');
  }

  const merged: unknown[] = [];
  const errors: string[] = [];

  for (const subreddit of SUBREDDITS) {
    const { records, error } = await fetchSubredditViaBrightData(subreddit);
    if (error) errors.push(error);
    merged.push(...records);
  }

  if (merged.length === 0) {
    // All subreddits failed (or all returned zero usable rows), most likely the
    // suspended-account proxy being blocked too. Fail loudly with the real
    // per-subreddit errors instead of silently returning an empty array.
    throw new Error(`proxied fetch produced 0 records across ${SUBREDDITS.length} subreddit(s): ${errors.join(' | ') || 'no data in any response'}`);
  }

  return merged;
}

/**
 * Single-subreddit, best-effort live fetch triggered per /api/chat question (rather
 * than the full multi-subreddit sweep). Reuses the same proxy dispatcher + per-
 * subreddit fetch helper as the real ingest path -- this is NOT a separate mock
 * implementation. Expected to fail while the Bright Data account is suspended; that
 * failure is reported honestly (attempted: true, ok: false, real error message)
 * rather than swallowed, per CONTRACT.md's /api/chat shape.
 */
export async function attemptTargetedFetch(term: string): Promise<{
  attempted: boolean;
  ok: boolean;
  records_extracted: number;
  error?: string;
  cache_path?: string;
}> {
  if (!hasApiConfig()) {
    return { attempted: false, ok: false, records_extracted: 0, error: 'BRIGHTDATA_API_TOKEN not configured' };
  }

  const subreddit = SUBREDDITS.includes(term.toLowerCase()) ? term.toLowerCase() : 'saas';
  const result = await fetchSubredditViaBrightData(subreddit);

  if (result.error || result.records.length === 0) {
    return {
      attempted: true,
      ok: false,
      records_extracted: 0,
      error: result.error ?? `r/${subreddit}: 0 records returned`,
    };
  }

  const parsed = RedditPayload.safeParse(result.records);
  if (!parsed.success) {
    return {
      attempted: true,
      ok: false,
      records_extracted: 0,
      error: `schema validation failed: ${parsed.error.issues.slice(0, 3).map((i) => i.message).join('; ')}`,
    };
  }

  const iso = new Date().toISOString();
  mkdirSync(RAW_DIR, { recursive: true });
  const chatCachePath = join(RAW_DIR, `reddit-chat-r_${subreddit}-${iso.replace(/[:.]/g, '-')}.json`);
  // Cache BEFORE parsing/ingesting, same discipline as the main ingest path.
  writeFileSync(chatCachePath, JSON.stringify(result.records, null, 2));

  const mapping = SUBREDDIT_MAP[subreddit] ?? { source_type: 'trend' as const, company_id: null };
  const db = migrate();
  const written = ingestNormalizedRecords(db, parsed.data, mapping);
  db.close();

  if (written === 0) {
    return { attempted: true, ok: false, records_extracted: 0, error: 'records_extracted is 0: fetch succeeded but produced no usable rows', cache_path: chatCachePath };
  }

  return { attempted: true, ok: true, records_extracted: written, cache_path: chatCachePath };
}

/**
 * Upserts already-schema-validated Reddit records into `posts` under a single
 * subreddit -> mapping assignment. Shared by the full ingest transaction and the
 * single-subreddit chat-triggered fetch so the upsert SQL exists in one place.
 */
function ingestNormalizedRecords(
  db: ReturnType<typeof migrate>,
  records: RedditRecord[],
  mapping: { source_type: 'trend' | 'competitor' | 'own'; company_id: string | null },
): number {
  const upsert = db.prepare(`
    insert into posts (id, company_id, source_type, platform, author, url, text, posted_at, fetched_at)
    values (@id, @company_id, @source_type, @platform, @author, @url, @text, @posted_at, @fetched_at)
    on conflict(id) do update set
      text = excluded.text, url = excluded.url, posted_at = excluded.posted_at, fetched_at = excluded.fetched_at
  `);
  const fetchedAt = new Date().toISOString();
  let written = 0;
  const tx = db.transaction((recs: RedditRecord[]) => {
    for (const rec of recs) {
      const n = normalize(rec);
      if (!n.id || !n.text) continue;
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
  tx(records);
  return written;
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
      if (!hasApiConfig()) {
        // Non-fatal: log clearly and exit without crashing the app, per the
        // instruction that missing credentials must not throw.
        console.log('[ingest:reddit] BRIGHTDATA_API_TOKEN not set. Skipping live fetch.');
        console.log('[ingest:reddit] Run with --cached to replay a cached payload, or set the token in .env.local.');
        span.setAttr('failure_reason', 'no API token, skipped');
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
