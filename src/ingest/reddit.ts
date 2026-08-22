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
// post_title / body_text are NOT real Bright Data field names -- they exist here only
// so the schema does not silently strip them when --simulate-break renames title/
// description to those names (see docs/AUTO_REPAIR.md). Zod strips unknown keys by
// default, and the whole point of the drill is that the renamed fields survive
// validation but fail to normalize, exactly like a real upstream shape change would.
const RedditRecord = z.object({
  id: z.string().optional(),
  post_id: z.string().optional(),
  url: z.string().optional(),
  user_posted: z.string().optional(),
  author: z.string().optional(),
  title: z.string().optional(),
  post_title: z.string().optional(),
  description: z.string().optional(),
  text: z.string().optional(),
  body_text: z.string().optional(),
  community_name: z.string().optional(),
  subreddit: z.string().optional(),
  date_posted: z.string().optional(),
  created_at: z.string().optional(),
});
const RedditPayload = z.array(RedditRecord);
type RedditRecord = z.infer<typeof RedditRecord>;

// Repair map: for each logical field, the ordered list of field names normalize()
// will accept once --repair is passed. `title` and `description` are the pre-break
// names; `post_title`/`body_text` are the field names simulate-break renames them to.
// This is a targeted, explicit fix for one known break, not a speculative catch-all --
// per CLAUDE.md, no abstraction beyond what the demo needs.
const REPAIR_ALIASES = {
  title: ['title', 'post_title'] as const,
  description: ['description', 'text', 'body_text'] as const,
};

function pick(rec: Record<string, unknown>, keys: readonly string[]): string | undefined {
  for (const k of keys) {
    const v = rec[k];
    if (typeof v === 'string' && v) return v;
  }
  return undefined;
}

function normalize(rec: RedditRecord, opts: { repair: boolean } = { repair: false }) {
  const id = rec.id ?? rec.post_id;
  const title = opts.repair ? pick(rec as Record<string, unknown>, REPAIR_ALIASES.title) : rec.title;
  const description = opts.repair
    ? pick(rec as Record<string, unknown>, REPAIR_ALIASES.description)
    : rec.description ?? rec.text;
  const text = [title, description].filter(Boolean).join('\n\n').trim();
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
/**
 * Picks the most relevant subreddit for a free-text question, by checking whether
 * any known subreddit name appears as a whole word in the question -- not by
 * requiring the entire question to equal a subreddit name (that would never match
 * a real natural-language question, silently defaulting to r/saas every time).
 */
function pickSubredditForQuestion(question: string): string {
  const lower = question.toLowerCase();
  for (const subreddit of SUBREDDITS) {
    if (new RegExp(`\\b${subreddit}\\b`).test(lower)) return subreddit;
  }
  return 'saas';
}

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

  const subreddit = pickSubredditForQuestion(term);
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

// Matches only the plain daily sweep cache, e.g. reddit-2026-08-22.json -- excludes
// reddit-chat-*.json (per-question targeted fetches) and reddit-simulated-break-*.json
// (the deliberately mutated drill artifact), so --cached and the simulate-break source
// selection never accidentally pick up a chat fetch or a previous break as "the real data".
const REAL_CACHE_RE = /^reddit-\d{4}-\d{2}-\d{2}\.json$/;

function loadMostRecentCache(): { path: string; data: unknown } {
  mkdirSync(RAW_DIR, { recursive: true });
  const files = readdirSync(RAW_DIR)
    .filter((f) => REAL_CACHE_RE.test(f))
    .sort()
    .reverse();
  if (files.length === 0) {
    throw new Error(`no cached files in ${RAW_DIR} for platform ${PLATFORM}`);
  }
  const path = join(RAW_DIR, files[0]);
  return { path, data: JSON.parse(readFileSync(path, 'utf-8')) };
}

/**
 * Loads the most recent real (non-simulated, non-chat) cached payload and rewrites
 * two field names to simulate a plausible upstream shape change: `title` -> `post_title`
 * and `description` -> `body_text`. Writes the mutated payload to its own cache file
 * (never overwrites the real one) so the break is honestly reproducible on demand.
 * See docs/AUTO_REPAIR.md for the full demo sequence this feeds.
 */
function writeSimulatedBreakCache(): string {
  const { path, data } = loadMostRecentCache();
  const records = data as Array<Record<string, unknown>>;
  if (!Array.isArray(records) || records.length === 0) {
    throw new Error(`cannot simulate a break: ${path} has no records to mutate`);
  }
  const mutated = records.map((rec) => {
    const { title, description, ...rest } = rec;
    return { ...rest, post_title: title, body_text: description };
  });
  const iso = new Date().toISOString();
  mkdirSync(RAW_DIR, { recursive: true });
  const outPath = join(RAW_DIR, `reddit-simulated-break-${iso.slice(0, 10)}.json`);
  writeFileSync(outPath, JSON.stringify(mutated, null, 2));
  console.log(`[ingest:reddit] simulated a shape break: title->post_title, description->body_text (${mutated.length} records), sourced from ${path}`);
  console.log(`[ingest:reddit] wrote ${outPath}`);
  return outPath;
}

export async function ingestReddit(opts: { cached: boolean; simulateBreak?: boolean; repair?: boolean }) {
  return withSpan('ingest.reddit', async (span) => {
    span.setAttr('platform', PLATFORM);
    span.setAttr('mode', opts.simulateBreak ? 'simulate-break' : opts.cached ? 'cached' : 'live');
    span.setAttr('repair', String(Boolean(opts.repair)));

    let raw: unknown;
    let cachePathUsed: string;

    if (opts.simulateBreak) {
      cachePathUsed = writeSimulatedBreakCache();
      raw = JSON.parse(readFileSync(cachePathUsed, 'utf-8'));
    } else if (opts.cached) {
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
        const n = normalize(rec, { repair: Boolean(opts.repair) });
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
      // warning. Fail loudly regardless of HTTP status. Before throwing, run the
      // same cheap heuristic scrape-doctor step 3 documents ("did the field mapping
      // change shape") so the failure message names a likely cause instead of just
      // reporting the symptom -- the count would otherwise be all a human has to go on.
      const hadRows = parsed.data.length > 0;
      const anyKnownFieldPresent = parsed.data.some((r) => r.title || r.description || r.text);
      const anyAliasFieldPresent = parsed.data.some((r) => r.post_title || r.body_text);
      let cause = 'unknown -- run scrape-doctor against ' + cachePathUsed;
      if (hadRows && !anyKnownFieldPresent && anyAliasFieldPresent) {
        cause = `field mapping changed shape: ${cachePathUsed} has records but none carry the expected title/description/text keys, while post_title/body_text (unmapped alias fields) are present -- likely upstream renamed the field. Re-run with --repair once confirmed.`;
      } else if (hadRows && !anyKnownFieldPresent) {
        cause = `field mapping changed shape: ${cachePathUsed} has ${parsed.data.length} record(s) but none carry a title/description/text field normalize() reads -- check for an upstream rename.`;
      } else if (!hadRows) {
        cause = `empty payload: ${cachePathUsed} contained 0 records after schema validation -- check for a bot wall or rate limit, not a mapping change.`;
      }
      span.setAttr('failure_reason', `records_extracted is 0: ${cause}`);
      throw new Error(`records_extracted is 0: fetch succeeded but produced no usable rows. Likely cause: ${cause}`);
    }

    console.log(`[ingest:reddit] ${written} records from ${cachePathUsed} (${opts.simulateBreak ? 'simulate-break' : opts.cached ? 'cached' : 'live'}${opts.repair ? ', repair applied' : ''})`);
    return { skipped: false, records_extracted: written, cache_path: cachePathUsed };
  });
}

// CLI entry point.
//
// Auto-repair demo sequence (see docs/AUTO_REPAIR.md for the full walkthrough):
//   bun run src/ingest/reddit.ts --simulate-break            # break: renamed fields, expect loud failure naming the cause
//   bun run src/ingest/reddit.ts --simulate-break --repair   # repair: same cache, expanded field-alias map, succeeds
if (process.argv[1] && process.argv[1].endsWith('reddit.ts')) {
  const cached = process.argv.includes('--cached');
  const simulateBreak = process.argv.includes('--simulate-break');
  const repair = process.argv.includes('--repair');
  ingestReddit({ cached, simulateBreak, repair })
    .then((result) => {
      console.log('[ingest:reddit] summary', result);
      process.exit(0);
    })
    .catch((err) => {
      console.error('[ingest:reddit] FAILED', err.message);
      process.exit(1);
    });
}
