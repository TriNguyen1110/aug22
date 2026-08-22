/**
 * Route handler logic for the six routes frozen in CONTRACT.md. Pure functions over
 * a better-sqlite3 handle, no framework dependency, so app/api/**\/route.ts wrappers
 * stay a one-line pass-through. Every call is wrapped in an OTel span per CONTRACT's
 * observability rule (duration, record count, failure reason).
 */
import type Database from 'better-sqlite3';
import { readdirSync } from 'node:fs';
import Anthropic from '@anthropic-ai/sdk';
import { withSpan } from '../otel';
import { burstWindow, scoreBurstTerms } from '../detect/burst';
import { attemptTargetedFetch } from '../ingest/reddit';

export async function getHealth(db: Database.Database) {
  return withSpan('api.health', async (span) => {
    const { n: records_extracted } = db.prepare('select count(*) as n from posts').get() as { n: number };
    const last = db.prepare('select max(fetched_at) as t from posts').get() as { t: string | null };
    span.setRecordCount(records_extracted);
    return {
      ok: true,
      records_extracted,
      last_ingest_at: last.t ?? null,
    };
  });
}

export async function getTrends(db: Database.Database) {
  return withSpan('api.trends', async (span) => {
    const trends = db.prepare('select * from trends order by score desc').all();
    span.setRecordCount(trends.length);
    return { trends };
  });
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Finds a verbatim substring of `text` matching `term` (which may be a 1-3 word
 * n-gram produced with punctuation stripped and lowercased). Builds a case-insensitive
 * regex that tolerates whatever punctuation/whitespace actually separates the words in
 * the original text, then returns the literal matched slice of `text` itself -- never a
 * reconstructed string -- so the CONTRACT grounding invariant (quote is a verbatim
 * substring of posts.text) holds by construction.
 */
function findVerbatimQuote(term: string, text: string): string | null {
  const words = term.split(' ').filter(Boolean).map(escapeRegex);
  if (words.length === 0) return null;
  const pattern = new RegExp(words.join('[^a-zA-Z0-9]+'), 'i');
  const m = text.match(pattern);
  return m ? m[0] : null;
}

interface PostRow {
  id: string;
  company_id: string | null;
  source_type: string;
  platform: string;
  author: string;
  url: string;
  text: string;
  posted_at: string;
  fetched_at: string;
}

/**
 * On-the-fly, unpersisted burst detection scoped to posts whose text matches `q`
 * (case-insensitive substring, any source_type). Reuses the exact recent/prior/floor
 * scoring in src/detect/burst.ts -- just fed a filtered post list instead of the
 * global `source_type = 'trend'` sweep. Never writes to the `trends` table: that
 * table stays the global unscoped view per CONTRACT.md. findings are generated at
 * request time, each quote a verbatim substring of the post it cites (grounding
 * invariant is not relaxed for the scoped path).
 */
export async function getTrendsSearch(db: Database.Database, rawQuery: string) {
  return withSpan('api.trends.search', async (span) => {
    const q = rawQuery.trim();
    span.setAttr('query', q);
    if (!q) {
      span.setAttr('failure_reason', 'empty query');
      return { query: rawQuery, matched_posts: 0, trends: [], findings: [], posts: [] };
    }

    const matched = db
      .prepare(`select * from posts where text like '%' || ? || '%' collate nocase`)
      .all(q) as PostRow[];

    span.setRecordCount(matched.length);
    if (matched.length === 0) {
      span.setAttr('failure_reason', 'zero matched posts');
      return { query: q, matched_posts: 0, trends: [], findings: [], posts: [] };
    }

    const window = burstWindow();
    const ranked = scoreBurstTerms(
      matched.map((p) => ({ text: p.text, posted_at: p.posted_at })),
      window,
      { minCount: 1, floorOn: 'total', relevanceTo: q },
    );

    const trends: Record<string, unknown>[] = [];
    const findings: Record<string, unknown>[] = [];
    const citedPosts = new Map<string, PostRow>();

    for (const r of ranked) {
      const trendId = `q-${q.toLowerCase().replace(/\s+/g, '-')}-${r.term.replace(/\s+/g, '-')}`;
      trends.push({
        id: trendId,
        term: r.term,
        recent_count: r.recent,
        prior_count: r.prior,
        score: r.score,
        window_start: window.priorStart,
        window_end: window.nowIso,
      });

      const citedPost = matched.find((p) => findVerbatimQuote(r.term, p.text));
      if (!citedPost) continue; // no post literally contains this n-gram verbatim; skip rather than fabricate
      const quote = findVerbatimQuote(r.term, citedPost.text)!;
      citedPosts.set(citedPost.id, citedPost);

      findings.push({
        id: `f-${trendId}`,
        post_id: citedPost.id,
        trend_id: trendId,
        company_id: citedPost.company_id,
        use_case: 'trends',
        claim: `"${r.term}" is trending in results for "${q}": ${r.recent} recent mention(s) vs ${r.prior} prior.`,
        quote,
        category: 'trend',
        confidence: Math.min(1, r.score / 5),
      });
    }

    span.setAttr('trends_found', trends.length);
    return { query: q, matched_posts: matched.length, trends, findings, posts: [...citedPosts.values()] };
  });
}

/**
 * Daily post-count timeline for a trend's term across its window_start..window_end,
 * computed from real posted_at timestamps -- powers a sparkline, not a new stored
 * table. Zero-filled for days with no matches so the UI can render a continuous
 * line (CONTRACT.md), not a sparse/skipped array.
 */
function buildTimeline(
  db: Database.Database,
  term: string,
  windowStart: string,
  windowEnd: string,
): Array<{ date: string; count: number }> {
  const rows = db
    .prepare(
      `select substr(posted_at, 1, 10) as day, count(*) as n
       from posts
       where posted_at >= ? and posted_at <= ? and text like '%' || ? || '%' collate nocase
       group by day`,
    )
    .all(windowStart, windowEnd, term) as { day: string; n: number }[];
  const countsByDay = new Map(rows.map((r) => [r.day, r.n]));

  const timeline: Array<{ date: string; count: number }> = [];
  const start = new Date(windowStart.slice(0, 10));
  const end = new Date(windowEnd.slice(0, 10));
  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    const day = d.toISOString().slice(0, 10);
    timeline.push({ date: day, count: countsByDay.get(day) ?? 0 });
  }
  return timeline;
}

export async function getTrendById(db: Database.Database, id: string) {
  return withSpan('api.trends.byId', async (span) => {
    const trend = db.prepare('select * from trends where id = ?').get(id) as
      | { id: string; term: string; window_start: string; window_end: string }
      | undefined;
    if (!trend) {
      span.setAttr('failure_reason', 'not found');
      return null;
    }
    const findings = db.prepare('select * from findings where trend_id = ?').all(id);
    const postIds = [...new Set((findings as { post_id: string }[]).map((f) => f.post_id))];
    const posts = postIds.length
      ? db
          .prepare(`select * from posts where id in (${postIds.map(() => '?').join(',')})`)
          .all(...postIds)
      : [];
    const timeline = buildTimeline(db, trend.term, trend.window_start, trend.window_end);
    span.setRecordCount(findings.length);
    span.setAttr('timeline_days', timeline.length);
    return { trend, findings, posts, timeline };
  });
}

const SIZE_ORDER: Record<string, number> = { startup: 0, 'mid-market': 1, enterprise: 2 };

interface CompanyRow {
  id: string;
  name: string;
  domain: string;
  role: string;
  industry: string | null;
  market_share: number | null;
  size: string | null;
  niche: string | null;
}

/**
 * `industry`/`sort` are both optional query params (CONTRACT.md). No params leaves the
 * behavior byte-for-byte the same as before this feature: unfiltered, DB-insertion-order
 * `role = 'competitor'` rows. `industry` matches case-insensitively; `sort` orders the
 * returned array in JS (not SQL) because `size` is an ordinal category, not a string
 * ORDER BY can sort correctly on its own.
 */
interface SnapshotRow {
  id: string;
  company_id: string;
  item_type: string;
  label: string;
  value_text: string;
  url: string;
  captured_at: string;
}

function sortCompanies(companies: CompanyRow[], sort: string): CompanyRow[] {
  if (sort === 'market_share') {
    return [...companies].sort((a, b) => (b.market_share ?? -Infinity) - (a.market_share ?? -Infinity));
  }
  if (sort === 'size') {
    return [...companies].sort((a, b) => (SIZE_ORDER[a.size ?? ''] ?? -1) - (SIZE_ORDER[b.size ?? ''] ?? -1));
  }
  return [...companies].sort((a, b) => a.name.localeCompare(b.name));
}

export async function getCompetitors(
  db: Database.Database,
  opts: { industry?: string | null; sort?: string | null; q?: string | null } = {},
) {
  return withSpan('api.competitors', async (span) => {
    const sort = opts.sort ?? 'name';
    span.setAttr('sort', sort);

    if (opts.q) {
      const q = opts.q.trim();
      span.setAttr('query', q);
      if (!q) {
        return { query: opts.q, matched_companies: 0, companies: [], snapshots: [] };
      }

      // Companies whose own name/niche mention the term, OR companies with at
      // least one snapshot whose label/value_text mentions the term. Computed on
      // the fly (CONTRACT.md), not a stored search index.
      let companies = db
        .prepare(
          `select distinct c.* from companies c
           left join competitor_snapshots s on s.company_id = c.id
           where c.role = 'competitor' and (
             c.name like '%' || ? || '%' collate nocase
             or c.niche like '%' || ? || '%' collate nocase
             or s.label like '%' || ? || '%' collate nocase
             or s.value_text like '%' || ? || '%' collate nocase
           )`,
        )
        .all(q, q, q, q) as CompanyRow[];

      if (opts.industry) {
        companies = companies.filter((c) => (c.industry ?? '').toLowerCase() === opts.industry!.toLowerCase());
        span.setAttr('industry_filter', opts.industry);
      }
      companies = sortCompanies(companies, sort);

      // Snapshots belonging to any matched company are relevant context (mirrors
      // /api/competitors/:id's shape), not just the individual snapshot rows that
      // literally matched the term.
      const matchedCompanyIds = new Set(companies.map((c) => c.id));
      const snapshots = matchedCompanyIds.size
        ? (db.prepare(`select * from competitor_snapshots order by captured_at desc`).all() as SnapshotRow[]).filter(
            (s) => matchedCompanyIds.has(s.company_id),
          )
        : [];

      span.setRecordCount(companies.length);
      if (companies.length === 0) span.setAttr('failure_reason', 'zero matched companies');
      return { query: q, matched_companies: companies.length, companies, snapshots };
    }

    let companies: CompanyRow[];
    if (opts.industry) {
      companies = db
        .prepare(`select * from companies where role = 'competitor' and industry = ? collate nocase`)
        .all(opts.industry) as CompanyRow[];
      span.setAttr('industry_filter', opts.industry);
    } else {
      companies = db.prepare(`select * from companies where role = 'competitor'`).all() as CompanyRow[];
    }

    companies = sortCompanies(companies, sort);

    const snapshots = db.prepare('select * from competitor_snapshots order by captured_at desc').all();
    span.setRecordCount(companies.length + snapshots.length);
    return { companies, snapshots };
  });
}

export async function getCompetitorById(db: Database.Database, id: string) {
  return withSpan('api.competitors.byId', async (span) => {
    const company = db.prepare('select * from companies where id = ?').get(id);
    if (!company) {
      span.setAttr('failure_reason', 'not found');
      return null;
    }
    const snapshots = db.prepare('select * from competitor_snapshots where company_id = ? order by captured_at desc').all(id);
    const findings = db.prepare('select * from findings where company_id = ?').all(id);
    const posts = db.prepare('select * from posts where company_id = ?').all(id);
    span.setRecordCount(snapshots.length + findings.length + posts.length);
    return { company, snapshots, findings, posts };
  });
}

const NAIVE_CACHE_TTL_MS = 60_000;
let naiveCache: { at: number; value: Record<string, unknown> } | null = null;

async function fetchNaiveUncached(span: { setAttr: (k: string, v: unknown) => void }): Promise<Record<string, unknown>> {
  const naiveUrl = 'https://www.reddit.com/r/notion.json';
  try {
    const res = await fetch(naiveUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; trendwatch-demo/1.0)' },
      signal: AbortSignal.timeout(10_000),
    });
    const bodyText = await res.text();
    const bytes = Buffer.byteLength(bodyText, 'utf-8');
    let records_found = 0;
    let note: string;
    try {
      const parsed = JSON.parse(bodyText);
      records_found = Array.isArray(parsed?.data?.children) ? parsed.data.children.length : 0;
      note = records_found > 0
        ? `HTTP ${res.status}, parsed JSON with ${records_found} post(s) in data.children`
        : `HTTP ${res.status}, JSON parsed but data.children is empty or missing (silent-zero-records failure mode)`;
    } catch {
      note = `HTTP ${res.status}, response was not valid JSON (likely a block page or JS shell), ${bytes} bytes`;
    }
    return { url: naiveUrl, status: res.status, bytes, records_found, note };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    span.setAttr('naive_failure_reason', reason);
    return { url: naiveUrl, status: null, bytes: 0, records_found: 0, note: `fetch failed: ${reason}` };
  }
}

async function getNaive(span: { setAttr: (k: string, v: unknown) => void }): Promise<Record<string, unknown>> {
  const now = Date.now();
  if (naiveCache && now - naiveCache.at < NAIVE_CACHE_TTL_MS) {
    span.setAttr('naive_cache_hit', true);
    return naiveCache.value;
  }
  span.setAttr('naive_cache_hit', false);
  const value = await fetchNaiveUncached(span);
  naiveCache = { at: now, value };
  return value;
}

/**
 * Demo endpoint for item 08 (BOARD.tsv): shows the "naive fetch vs Bright Data" gap
 * live, in the UI, with real numbers rather than a slide. `naive` runs a plain
 * unproxied fetch against Reddit's public JSON listing, cached in-memory for
 * NAIVE_CACHE_TTL_MS (~60s) so repeat requests during a demo window are instant and
 * not at the mercy of network flakiness -- it either gets rate-limited/blocked or
 * returns a real page, and we report whichever actually happens rather than assuming.
 * `brightdata` reports the last real ingest's numbers (from the DB, same source as
 * /api/health) plus whether a cached raw payload from today exists, without
 * re-running the pipeline.
 */
export async function getPipelineHealth(db: Database.Database) {
  return withSpan('api.pipeline-health', async (span) => {
    const naive = await getNaive(span);

    const { n: records_extracted } = db.prepare('select count(*) as n from posts').get() as { n: number };
    const last = db.prepare('select max(fetched_at) as t from posts').get() as { t: string | null };

    let cache_path: string | null = null;
    try {
      const todayIso = new Date().toISOString().slice(0, 10);
      const files = readdirSync('./data/raw').filter((f) => f.startsWith(`reddit-${todayIso}`));
      cache_path = files.length ? `./data/raw/${files[0]}` : null;
    } catch {
      cache_path = null;
    }

    const brightdata = {
      attempted: Boolean(cache_path),
      ok: records_extracted > 0,
      records_extracted,
      last_ingest_at: last.t ?? null,
      cache_path,
      ...(records_extracted === 0 ? { error: 'no posts in DB yet' } : {}),
    };

    span.setRecordCount((naive.records_found as number) + records_extracted);
    return { naive, brightdata };
  });
}

const CHAT_STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'is', 'are', 'was', 'were', 'be', 'been',
  'to', 'of', 'in', 'on', 'for', 'with', 'at', 'by', 'this', 'that', 'it', 'we',
  'i', 'you', 'my', 'our', 'their', 'have', 'has', 'had', 'not', 'do', 'does',
  'did', 'so', 'as', 'if', 'from', 'about', 'they', 'them', 'he', 'she', 'his',
  'her', 'its', 'us', 'am', 'just', 'can', 'will', 'would', 'could', 'should',
  'what', 'whats', 'when', 'where', 'who', 'why', 'how', 'tell', 'me', 'know',
  'any', 'are', 'saying', 'say', 'people', 'users',
]);

/**
 * Best-effort keyword/target extraction from a free-text question: prefer a known
 * company name mentioned in the question (drives both the live Bright Data
 * subreddit attempt and the DB grounding search toward the same target), otherwise
 * fall back to the longest non-stopword word in the question. Heuristic on purpose
 * per CONTRACT.md -- the LLM never decides what to search for, this does.
 */
function extractChatTerm(question: string, companyNames: string[]): string {
  const lower = question.toLowerCase();
  for (const name of companyNames) {
    if (lower.includes(name.toLowerCase())) return name;
  }
  const words = lower
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !CHAT_STOPWORDS.has(w));
  if (words.length === 0) return question.trim();
  return words.reduce((longest, w) => (w.length > longest.length ? w : longest), words[0]);
}

export interface ChatCitation {
  post_id: string;
  quote: string;
  url: string;
}

/**
 * POST /api/chat: live-per-question grounded QA. Attempts one targeted Bright Data
 * fetch (best-effort, expected to fail while the account is suspended -- reported
 * honestly via `brightdata`, never silently swallowed), retrieves grounding from
 * `posts.text` (existing DB rows plus anything freshly ingested this request), and
 * asks the LLM to answer using ONLY those verbatim quotes. Every returned citation
 * is independently re-verified server-side as a literal substring of its post's
 * text -- the model's own claim is not trusted, same defense-in-depth as findings.
 */
const CHAT_SCOPE_TO_SOURCE_TYPE: Record<string, string> = {
  trends: 'trend',
  competitor: 'competitor',
  own: 'own',
};

/**
 * Scores a candidate post's relevance to `term`: term-frequency (case-insensitive
 * occurrence count) plus a bonus if the term appears in the first ~200 characters,
 * a cheap proxy for "this post is centrally about the term" vs. mentioning it once
 * in passing near the end. No new dependency, per CONTRACT.md.
 */
function scoreRelevance(text: string, term: string): number {
  const lowerText = text.toLowerCase();
  const lowerTerm = term.toLowerCase();
  if (!lowerTerm) return 0;
  let occurrences = 0;
  let idx = lowerText.indexOf(lowerTerm);
  while (idx !== -1) {
    occurrences += 1;
    idx = lowerText.indexOf(lowerTerm, idx + lowerTerm.length);
  }
  const leadBonus = lowerText.slice(0, 200).includes(lowerTerm) ? 2 : 0;
  return occurrences + leadBonus;
}

export async function getChat(db: Database.Database, question: string, scope?: string) {
  return withSpan('api.chat', async (span) => {
    span.setAttr('question', question);
    if (scope) span.setAttr('scope', scope);

    const companyNames = (db.prepare(`select name from companies`).all() as { name: string }[]).map((c) => c.name);
    const term = extractChatTerm(question, companyNames);
    span.setAttr('extracted_term', term);

    const brightdataResult = await attemptTargetedFetch(term);
    span.setAttr('brightdata_attempted', brightdataResult.attempted);
    span.setAttr('brightdata_ok', brightdataResult.ok);
    if (brightdataResult.error) span.setAttr('brightdata_error', brightdataResult.error);

    const brightdata = {
      attempted: brightdataResult.attempted,
      ok: brightdataResult.ok,
      records_extracted: brightdataResult.records_extracted,
      ...(brightdataResult.error ? { error: brightdataResult.error } : {}),
    };

    const sourceType = scope ? CHAT_SCOPE_TO_SOURCE_TYPE[scope] : undefined;
    if (scope && !sourceType) {
      span.setAttr('failure_reason', `unknown scope "${scope}"`);
    }

    // Pre-filter: top 30 by recency (optionally restricted to a source_type via
    // `scope`), then re-rank that candidate set by real relevance below. Recency
    // is kept as a cheap pre-filter / natural tiebreak, not the final ranking.
    const candidates = (
      sourceType
        ? db
            .prepare(
              `select * from posts where source_type = ? and text like '%' || ? || '%' collate nocase order by posted_at desc limit 30`,
            )
            .all(sourceType, term)
        : db
            .prepare(`select * from posts where text like '%' || ? || '%' collate nocase order by posted_at desc limit 30`)
            .all(term)
    ) as PostRow[];

    const matched = candidates
      .map((p) => ({ post: p, score: scoreRelevance(p.text, term) }))
      .sort((a, b) => (b.score !== a.score ? b.score - a.score : b.post.posted_at.localeCompare(a.post.posted_at)))
      .slice(0, 10)
      .map((r) => r.post);
    span.setRecordCount(matched.length);
    span.setAttr('candidates_considered', candidates.length);

    if (matched.length === 0) {
      span.setAttr('failure_reason', 'zero matched posts, LLM call skipped');
      return {
        answer: `I don't have data on that yet. No posts in the corpus mention "${term}".`,
        citations: [] as ChatCitation[],
        brightdata,
      };
    }

    if (!process.env.ANTHROPIC_API_KEY) {
      // Guarded like every other sponsor key (CLAUDE.md pattern): missing key is a
      // clear, typed failure, not a crash.
      span.setAttr('failure_reason', 'ANTHROPIC_API_KEY not configured');
      const err = new Error('ANTHROPIC_API_KEY not configured') as Error & { status: number };
      err.status = 503;
      throw err;
    }

    const postsById = new Map(matched.map((p) => [p.id, p]));
    const contextBlock = matched
      .map((p) => `POST_ID: ${p.id}\nSOURCE: ${p.platform} (${p.source_type})\nTEXT: ${p.text}`)
      .join('\n---\n');

    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const systemPrompt = `You answer questions using ONLY the quotes below, verbatim. Never invent a fact that is not present in one of these posts. For every claim you make, cite which POST_ID it comes from and include the exact verbatim quote (a real substring of that post's TEXT) you are relying on. If these posts do not actually address the question, say plainly "I don't have data on that" instead of guessing.

Respond as JSON only, matching this shape exactly, no other text:
{"answer": "<your answer, may reference POST_IDs inline>", "citations": [{"post_id": "<id>", "quote": "<verbatim substring of that post's TEXT>"}]}

POSTS:
${contextBlock}`;

    let responseText: string;
    try {
      const message = await client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1024,
        system: systemPrompt,
        messages: [{ role: 'user', content: question }],
      });
      const block = message.content.find((b) => b.type === 'text');
      responseText = block && block.type === 'text' ? block.text : '';
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      span.setAttr('failure_reason', `anthropic call failed: ${reason}`);
      throw err;
    }

    let parsedResponse: { answer?: string; citations?: { post_id?: string; quote?: string }[] };
    try {
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      parsedResponse = JSON.parse(jsonMatch ? jsonMatch[0] : responseText);
    } catch {
      span.setAttr('failure_reason', 'model response was not valid JSON');
      parsedResponse = { answer: responseText, citations: [] };
    }

    // Defense in depth: the prompt constrains the model, but nothing from the model
    // is trusted as grounded until independently re-verified against real post text.
    const citations: ChatCitation[] = [];
    for (const c of parsedResponse.citations ?? []) {
      if (!c.post_id || !c.quote) continue;
      const post = postsById.get(c.post_id);
      if (!post || !post.text.includes(c.quote)) continue; // ungrounded claim, drop rather than pass through
      citations.push({ post_id: c.post_id, quote: c.quote, url: post.url });
    }
    span.setAttr('citations_verified', citations.length);
    span.setAttr('citations_claimed', (parsedResponse.citations ?? []).length);

    return {
      answer: parsedResponse.answer ?? "I don't have data on that.",
      citations,
      brightdata,
    };
  });
}

export async function getMonitoring(db: Database.Database) {
  return withSpan('api.monitoring', async (span) => {
    const posts = db.prepare(`select * from posts where source_type = 'own' order by posted_at desc`).all();
    const postIds = (posts as { id: string }[]).map((p) => p.id);
    const findings = postIds.length
      ? db
          .prepare(`select * from findings where post_id in (${postIds.map(() => '?').join(',')})`)
          .all(...postIds)
      : [];
    span.setRecordCount(posts.length);
    return { posts, findings };
  });
}
