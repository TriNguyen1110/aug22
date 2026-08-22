/**
 * Bright Data LinkedIn company-overview ingest. Terminal only, same discipline as
 * src/ingest/reddit.ts: fetch -> cache raw HTML to ./data/raw/ BEFORE parsing ->
 * validate with Zod -> upsert -> assert records_extracted > 0 or throw.
 *
 * Bright Data's Direct API (Web Unlocker, Bearer token, POST
 * https://api.brightdata.com/request with { zone: 'web_unlocker1', url, format: 'raw',
 * country: 'us' }) works for LinkedIn's public company *overview* page and returns a
 * real server-rendered page containing a `"description":"..."` field with the
 * company's real About text. The `/posts/` sub-page is blocked by LinkedIn
 * ("Forbidden. Use only company name in the URL") -- only the overview page is
 * fetched, never posts.
 *
 * Slug mapping below was verified live against the real API (not guessed blind):
 * a few slugs that look reasonable (e.g. "linear", "clickup", "coda", "monday-com",
 * "plaid") either 200'd with an *unrelated* company's real description (name
 * collision -- "linear" is a MEP design-software company, not the issue tracker) or
 * landed on LinkedIn's authwall (small noindex page, no description field at all).
 * Those are corrected to the verified-correct slug (linearapp, clickup-app, codainc)
 * or dropped entirely (monday, plaid) rather than fabricating a snapshot from the
 * wrong company or an empty page.
 *
 * `anthropicresearch` (Anthropic) and `openai` (OpenAI) verified live 2026-08-22 for
 * the Anthropic/OpenAI demo pivot -- both 200'd with the correct company's real
 * "description" field on the first try, no collision or authwall.
 *
 * `google` (Gemini), `meta` (Llama), `xai` (Grok) verified live 2026-08-22 for the
 * broader-competitor expansion -- all three 200'd with the correct company's real
 * "description" field on the first try.
 *
 * Updates/posts (2026-08-22, same expansion): the LinkedIn company overview page's
 * "Updates" feed is NOT embedded server-side in the initial HTML -- it's lazy-loaded
 * from a separate guest-view endpoint, `/organization-guest/api/feedUpdates/<numeric
 * id>?paginationToken=<token>`, whose exact URL (including the company's real numeric
 * id and a session pagination token) is only discoverable by first fetching the
 * overview page and reading the `feedUpdatesBaseUrl` <code> element embedded in it --
 * it is NOT a guessable/static URL per company. That second endpoint IS scrapable
 * through the same Bright Data Direct API call and returns real server-rendered post
 * cards (commentary text + a real `/posts/<slug>-activity-<id>-...` permalink per
 * post). The separate `/company/<slug>/posts/` guest page (as opposed to this feed
 * API) is confirmed Forbidden for both `openai` and `anthropicresearch` -- verified
 * live, not assumed from one earlier attempt -- so `/posts/` itself stays unused;
 * `fetchRecentUpdates` below is the real path in.
 *
 * Usage:
 *   bun run src/ingest/linkedin.ts             # real fetch, needs BRIGHTDATA_API_TOKEN
 *   bun run src/ingest/linkedin.ts --cached     # replay most recent cached HTML per slug
 */
import { z } from 'zod';
import { mkdirSync, writeFileSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { migrate } from '../db/migrate';
import { withSpan } from '../otel';

const RAW_DIR = './data/raw';
const PLATFORM = 'linkedin';
const BRIGHTDATA_ZONE = 'web_unlocker1';

// company_id -> LinkedIn company slug, verified live against the real API (see file
// header). Companies with no confidently-correct slug (Monday, Plaid -- both land on
// an authwall page with no description field) are omitted rather than guessed.
const COMPANY_SLUGS: Record<string, string> = {
  'co-anthropic': 'anthropicresearch',
  'co-openai': 'openai',
  'co-google': 'google',
  'co-meta': 'meta',
  'co-xai': 'xai',
  'co-notion': 'notionhq',
  'co-linear': 'linearapp',
  'co-asana': 'asana',
  'co-clickup': 'clickup-app',
  'co-coda': 'codainc',
  'co-stripe': 'stripe',
  'co-brex': 'brexhq',
};

const ProfileRecord = z.object({
  company_id: z.string(),
  slug: z.string(),
  url: z.string(),
  description: z.string().min(1),
});
type ProfileRecord = z.infer<typeof ProfileRecord>;

function hasApiConfig(): boolean {
  return Boolean(process.env.BRIGHTDATA_API_TOKEN);
}

function cachePath(slug: string, iso: string) {
  return join(RAW_DIR, `${PLATFORM}-${slug}-${iso.slice(0, 10)}.html`);
}

/**
 * Pulls the real `"description":"..."` field out of a LinkedIn company overview
 * page's embedded JSON. Simple string extraction, not a full HTML/JSON parser --
 * the field is a single JS-string-escaped value inside a `<code>` blob, so unescaping
 * it as a JSON string literal is the correct and sufficient approach here.
 */
function extractDescription(html: string): string | null {
  const m = html.match(/"description":"((?:[^"\\]|\\.)*)"/);
  if (!m) return null;
  try {
    const decoded = JSON.parse(`"${m[1]}"`);
    return typeof decoded === 'string' && decoded.trim().length > 0 ? decoded.trim() : null;
  } catch {
    return null;
  }
}

/**
 * Fetches one company's LinkedIn overview page (or, when `overrideUrl` is given, an
 * arbitrary other LinkedIn guest-view URL -- shared here so fetchRecentUpdates below
 * reuses the exact same Bright Data Direct API call rather than a second copy of it)
 * through Bright Data's Direct API. `country: 'us'` is required -- omitting it gets a
 * 200 with an empty body from Bright Data's default exit-node selection, same failure
 * mode documented in src/ingest/reddit.ts.
 */
async function fetchOverviewViaBrightData(slug: string, overrideUrl?: string): Promise<{ html: string | null; error?: string }> {
  const token = process.env.BRIGHTDATA_API_TOKEN;
  const url = overrideUrl ?? `https://www.linkedin.com/company/${slug}`;
  try {
    const res = await fetch('https://api.brightdata.com/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ zone: BRIGHTDATA_ZONE, url, format: 'raw', country: 'us' }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      return { html: null, error: `${slug}: HTTP ${res.status} ${detail.slice(0, 200)}` };
    }
    const html = await res.text();
    if (!html) {
      return { html: null, error: `${slug}: 200 with empty body (blocked or JS shell)` };
    }
    return { html };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return { html: null, error: `${slug}: ${reason}` };
  }
}

function loadCachedHtml(slug: string, tag = ''): string | null {
  mkdirSync(RAW_DIR, { recursive: true });
  const prefix = `${PLATFORM}-${slug}${tag}-`;
  const files = readdirSync(RAW_DIR)
    .filter((f) => f.startsWith(prefix) && f.endsWith('.html'))
    .sort()
    .reverse();
  if (files.length === 0) return null;
  return readFileSync(join(RAW_DIR, files[0]), 'utf-8');
}

/**
 * Extracts the real `feedUpdatesBaseUrl` (a relative path like
 * `/organization-guest/api/feedUpdates/<id>?paginationToken=<token>`) that the
 * overview page's own lazy-loading JS uses to fetch the Updates feed. This value is
 * per-company (numeric org id) and session-scoped (pagination token) -- there is no
 * static/guessable URL, it must be read out of a real fetched overview page.
 */
function extractFeedUpdatesBaseUrl(html: string): string | null {
  const m = html.match(/feedUpdatesBaseUrl" style="display: none"><!--"([^"]+)"-->/);
  return m ? m[1] : null;
}

const MAX_UPDATES_PER_COMPANY = 5;

/**
 * Parses real post cards out of the feedUpdates guest-view HTML. Splits on each
 * `<li class="mb-1">` card wrapper (the actual per-post DOM boundary, verified
 * against a live fetch) rather than a naive global regex scan, then within each
 * card independently extracts the real permalink (a `/posts/<slug>-activity-<id>-...`
 * href) and the real commentary text -- joined back together by matching the numeric
 * activity id embedded in BOTH the permalink and the id LinkedIn itself uses for the
 * post, so a permalink is never paired with the wrong card's text by position alone.
 */
function parseFeedUpdates(html: string): Array<{ url: string; text: string }> {
  const cards = html.split(/(?=<li class="mb-1">)/).slice(1);
  const results: Array<{ url: string; text: string }> = [];
  for (const card of cards) {
    const linkMatch = card.match(/href="(https:\/\/www\.linkedin\.com\/posts\/[^"]+?-activity-(\d+)-[^"]*)"/);
    const textMatch = card.match(/data-test-id="main-feed-activity-card__commentary">([\s\S]*?)<\/p>/);
    if (!linkMatch || !textMatch) continue;
    const text = textMatch[1]
      .replace(/<[^>]+>/g, '') // strip inline anchor tags (e.g. linked mentions) from the commentary
      .replace(/&amp;/g, '&')
      .replace(/&#39;/g, "'")
      .replace(/\s+\n/g, '\n')
      .trim();
    if (!text) continue;
    results.push({ url: linkMatch[1], text });
    if (results.length >= MAX_UPDATES_PER_COMPANY) break;
  }
  return results;
}

const UpdateRecord = z.object({
  company_id: z.string(),
  url: z.string(),
  text: z.string().min(1),
});
type UpdateRecord = z.infer<typeof UpdateRecord>;

function upsertUpdateSnapshot(db: ReturnType<typeof migrate>, rec: UpdateRecord, idx: number) {
  const capturedAt = new Date().toISOString();
  const label = rec.text.slice(0, 80).trim();
  db.prepare(
    `insert into competitor_snapshots (id, company_id, item_type, label, value_text, url, captured_at)
     values (@id, @company_id, 'update', @label, @value_text, @url, @captured_at)
     on conflict(id) do update set value_text = excluded.value_text, url = excluded.url, captured_at = excluded.captured_at`,
  ).run({
    id: `snap-linkedin-update-${rec.company_id}-${idx}`,
    company_id: rec.company_id,
    label,
    value_text: rec.text,
    url: rec.url,
    captured_at: capturedAt,
  });
}

/**
 * Fetches and ingests real recent LinkedIn company "Updates" (posts) for one
 * company. Best-effort per company -- a failure here (no feedUpdatesBaseUrl found,
 * blocked fetch) is reported via the returned error and does not throw, since profile
 * ingestion (the invariant-bearing part of this file) must not be blocked by the
 * additive updates feature. Same cache-before-parse discipline as everything else.
 */
async function fetchRecentUpdates(
  db: ReturnType<typeof migrate>,
  companyId: string,
  slug: string,
  overviewHtml: string,
  opts: { cached: boolean },
): Promise<{ written: number; error?: string }> {
  const baseUrl = extractFeedUpdatesBaseUrl(overviewHtml);
  if (!baseUrl) {
    return { written: 0, error: `${slug}: no feedUpdatesBaseUrl found in overview page (layout change or authwall)` };
  }
  const feedUrl = `https://www.linkedin.com${baseUrl}`;

  let html: string | null;
  if (opts.cached) {
    html = loadCachedHtml(slug, '-updates');
    if (!html) return { written: 0, error: `${slug}: no cached updates HTML in ${RAW_DIR}` };
  } else {
    const result = await fetchOverviewViaBrightData(slug, feedUrl);
    if (result.error || !result.html) {
      return { written: 0, error: result.error ?? `${slug}: no updates html returned` };
    }
    html = result.html;
    const iso = new Date().toISOString();
    mkdirSync(RAW_DIR, { recursive: true });
    // Cache BEFORE parsing, same discipline as every other fetch in this file.
    writeFileSync(join(RAW_DIR, `${PLATFORM}-${slug}-updates-${iso.slice(0, 10)}.html`), html);
  }

  const posts = parseFeedUpdates(html);
  if (posts.length === 0) {
    return { written: 0, error: `${slug}: 0 real posts parsed out of the updates feed HTML (layout change)` };
  }

  let written = 0;
  posts.forEach((p, idx) => {
    const parsed = UpdateRecord.safeParse({ company_id: companyId, url: p.url, text: p.text });
    if (!parsed.success) return;
    upsertUpdateSnapshot(db, parsed.data, idx);
    written += 1;
  });
  return { written };
}

function upsertSnapshot(db: ReturnType<typeof migrate>, rec: ProfileRecord) {
  const capturedAt = new Date().toISOString();
  db.prepare(
    `insert into competitor_snapshots (id, company_id, item_type, label, value_text, url, captured_at)
     values (@id, @company_id, 'profile', 'LinkedIn overview', @value_text, @url, @captured_at)
     on conflict(id) do update set value_text = excluded.value_text, url = excluded.url, captured_at = excluded.captured_at`,
  ).run({
    id: `snap-linkedin-profile-${rec.company_id}`,
    company_id: rec.company_id,
    value_text: rec.description,
    url: rec.url,
    captured_at: capturedAt,
  });
}

export async function ingestLinkedin(opts: { cached: boolean }) {
  return withSpan('ingest.linkedin', async (span) => {
    span.setAttr('platform', PLATFORM);
    span.setAttr('mode', opts.cached ? 'cached' : 'live');

    if (!opts.cached && !hasApiConfig()) {
      // Non-fatal per CLAUDE.md: missing token skips rather than crashes.
      console.log('[ingest:linkedin] BRIGHTDATA_API_TOKEN not set. Skipping live fetch.');
      console.log('[ingest:linkedin] Run with --cached to replay cached HTML, or set the token in .env.local.');
      span.setAttr('failure_reason', 'no API token, skipped');
      span.setRecordCount(0);
      return { skipped: true, records_extracted: 0 };
    }

    const db = migrate();
    const errors: string[] = [];
    let written = 0;
    let updatesWritten = 0;

    for (const [companyId, slug] of Object.entries(COMPANY_SLUGS)) {
      let html: string | null;
      let cachePathUsed: string | null = null;

      if (opts.cached) {
        html = loadCachedHtml(slug);
        if (!html) {
          errors.push(`${slug}: no cached HTML in ${RAW_DIR}`);
          continue;
        }
      } else {
        const result = await fetchOverviewViaBrightData(slug);
        if (result.error || !result.html) {
          errors.push(result.error ?? `${slug}: no html returned`);
          continue;
        }
        html = result.html;
        const iso = new Date().toISOString();
        cachePathUsed = cachePath(slug, iso);
        mkdirSync(RAW_DIR, { recursive: true });
        // Cache BEFORE parsing, so a bad payload is still recoverable from disk.
        writeFileSync(cachePathUsed, html);
      }

      const description = extractDescription(html);
      if (!description) {
        errors.push(`${slug}: no "description" field found in overview page (authwall or layout change)`);
        continue;
      }

      const parsed = ProfileRecord.safeParse({
        company_id: companyId,
        slug,
        url: `https://www.linkedin.com/company/${slug}`,
        description,
      });
      if (!parsed.success) {
        errors.push(`${slug}: schema validation failed: ${parsed.error.issues.slice(0, 2).map((i) => i.message).join('; ')}`);
        continue;
      }

      upsertSnapshot(db, parsed.data);
      written += 1;

      // Updates/posts (additive): best-effort per company, never blocks or fails
      // the profile ingest above -- the profile snapshot is the invariant-bearing
      // part of this file (records_extracted > 0 below is keyed off it).
      const updatesResult = await fetchRecentUpdates(db, companyId, slug, html, opts);
      if (updatesResult.error) {
        errors.push(updatesResult.error);
      } else {
        updatesWritten += updatesResult.written;
      }
    }
    db.close();

    span.setRecordCount(written);
    span.setAttr('update_snapshots_written', updatesWritten);
    if (errors.length) span.setAttr('errors', errors.join(' | ').slice(0, 500));

    if (written === 0) {
      // Grounding rule: a 200 with zero usable rows is a failure, not a warning.
      span.setAttr('failure_reason', 'records_extracted is 0');
      throw new Error(`records_extracted is 0: ${errors.join(' | ') || 'no companies produced a usable profile snapshot'}`);
    }

    console.log(`[ingest:linkedin] ${written}/${Object.keys(COMPANY_SLUGS).length} profile snapshots written, ${updatesWritten} update snapshots written (${opts.cached ? 'cached' : 'live'})`);
    if (errors.length) console.log('[ingest:linkedin] skipped:', errors.join(' | '));
    return { skipped: false, records_extracted: written, update_snapshots_written: updatesWritten, errors };
  });
}

// CLI entry point.
if (process.argv[1] && process.argv[1].endsWith('linkedin.ts')) {
  const cached = process.argv.includes('--cached');
  ingestLinkedin({ cached })
    .then((result) => {
      console.log('[ingest:linkedin] summary', result);
      process.exit(0);
    })
    .catch((err) => {
      console.error('[ingest:linkedin] FAILED', err.message);
      process.exit(1);
    });
}
