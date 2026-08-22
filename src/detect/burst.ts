/**
 * Burst-score trend detection. Plain SQL, no model call. Recent-window count over
 * prior-window count, with a floor on absolute count so a term that goes 1 -> 3 does
 * not outrank one that goes 40 -> 120.
 *
 * Operates on posts.text where source_type = 'trend', bucketed by posted_at. Extracts
 * 1-3 word lowercase n-grams (stopwords stripped), counts occurrences in the last
 * RECENT_DAYS vs the RECENT_DAYS..PRIOR_DAYS window before that, and upserts the top
 * terms into `trends`.
 */
import type Database from 'better-sqlite3';
import { withSpan } from '../otel';

const RECENT_DAYS = 3;
const PRIOR_DAYS = 14;
const MIN_ABS_COUNT = 2; // floor: a term needs at least this many recent mentions to count as a burst
const MAX_TERMS = 20;

const STOPWORDS = new Set([
  // articles / conjunctions / prepositions
  'the', 'a', 'an', 'and', 'or', 'but', 'nor', 'so', 'yet', 'for', 'to', 'of', 'in',
  'on', 'at', 'by', 'with', 'about', 'against', 'between', 'into', 'through', 'during',
  'before', 'after', 'above', 'below', 'from', 'up', 'down', 'out', 'off', 'over',
  'under', 'again', 'further', 'then', 'once', 'as', 'if', 'than', 'because', 'while',
  'until', 'unless', 'though', 'although', 'per', 'via', 'upon',
  // pronouns
  'i', 'me', 'my', 'mine', 'myself', 'we', 'us', 'our', 'ours', 'ourselves', 'you',
  'your', 'yours', 'yourself', 'yourselves', 'he', 'him', 'his', 'himself', 'she',
  'her', 'hers', 'herself', 'it', 'its', 'itself', 'they', 'them', 'their', 'theirs',
  'themselves', 'this', 'that', 'these', 'those', 'who', 'whom', 'whose', 'which',
  'what', 'whatever', 'whoever', 'anyone', 'someone', 'everyone', 'anybody', 'somebody',
  'everybody', 'anything', 'something', 'everything', 'nothing', 'one', 'ones',
  // be/have/do auxiliaries + modal verbs
  'am', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had',
  'having', 'do', 'does', 'did', 'doing', 'done', 'will', 'would', 'shall', 'should',
  'can', 'could', 'may', 'might', 'must', 'need', 'ought',
  // negation / contraction artifacts (apostrophe stripped by the tokenizer, e.g. "don't" -> "don")
  'not', 'no', 'nor', 'don', 'doesn', 'didn', 'isn', 'aren', 'wasn', 'weren', 'won',
  'wouldn', 'shouldn', 'couldn', 'can', 'cannot', 'ain', 'hasn', 'haven', 'hadn',
  'mightn', 'mustn', 'needn', 'shan', 'll', 've', 're', 'ts', 'nt', 'im', 'youre',
  // common filler / generic verbs and words that leak through as false "trends"
  'just', 'like', 'get', 'got', 'getting', 'go', 'going', 'went', 'gone', 'make',
  'made', 'making', 'use', 'used', 'using', 'uses', 'know', 'knew', 'known', 'think',
  'thought', 'thinks', 'want', 'wanted', 'wants', 'say', 'said', 'says', 'see', 'saw',
  'seen', 'look', 'looking', 'looks', 'come', 'came', 'coming', 'take', 'took', 'taken',
  'give', 'gave', 'given', 'find', 'found', 'tell', 'told', 'ask', 'asked', 'work',
  'works', 'working', 'seem', 'seems', 'seemed', 'feel', 'feels', 'felt', 'try',
  'tried', 'trying', 'let', 'put', 'really', 'still', 'also', 'even', 'much', 'many',
  'more', 'most', 'other', 'others', 'some', 'any', 'all', 'both', 'each', 'few',
  'own', 'same', 'such', 'too', 'very', 'now', 'here', 'there', 'when', 'where',
  'why', 'how', 'well', 'good', 'bad', 'new', 'old', 'lot', 'lots', 'thing', 'things',
  'way', 'ways', 'time', 'times', 'day', 'days', 'year', 'years', 'people', 'someth',
  'page', 'pages', 'post', 'posts', 'comment', 'comments', 'thread', 'sub', 'reddit',
  'yeah', 'yep', 'ok', 'okay', 'oh', 'hi', 'hey', 'hello', 'thanks', 'thank', 'please',
  'sure', 'maybe', 'actually', 'basically', 'literally', 'kind', 'sort', 'bit', 'stuff',
  // URL/markup debris that survives punctuation-stripping if a URL slips past URL_RE
  // (e.g. wrapped in markdown brackets or missing a scheme)
  'http', 'https', 'www', 'com', 'org', 'net', 'html', 'png', 'jpg', 'jpeg', 'gif',
  'webp', 'amp', 'auto', 'width', 'height', 'format', 'redd', 'preview', 'imgur',
  'href', 'src',
]);

// Reddit post bodies routinely embed raw image/link URLs (preview.redd.it?width=...&
// format=png&auto=webp&amp;...), and their query-string tokens (https, www, com, png,
// amp, webp, auto, width, format, redd, preview) survive punctuation-stripping as
// plausible-looking "phrases" that are actually URL debris, not language. Strip URLs
// entirely before tokenizing so they never enter the n-gram pool.
const URL_RE = /https?:\/\/\S+|www\.\S+/gi;

function ngrams(text: string): string[] {
  const words = text
    .toLowerCase()
    .replace(URL_RE, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w && !STOPWORDS.has(w) && w.length > 2);

  const out: string[] = [];
  for (let n = 1; n <= 3; n++) {
    for (let i = 0; i + n <= words.length; i++) {
      out.push(words.slice(i, i + n).join(' '));
    }
  }
  return out;
}

interface TermCounts {
  recent: number;
  prior: number;
}

export interface RankedTerm {
  term: string;
  recent: number;
  prior: number;
  score: number;
}

export interface BurstWindow {
  recentStart: string;
  priorStart: string;
  nowIso: string;
}

export function burstWindow(now: number = Date.now()): BurstWindow {
  return {
    recentStart: new Date(now - RECENT_DAYS * 86400000).toISOString(),
    priorStart: new Date(now - PRIOR_DAYS * 86400000).toISOString(),
    nowIso: new Date(now).toISOString(),
  };
}

export interface ScoreOptions {
  // Which count the absolute floor applies to. 'recent' (default) matches the
  // global sweep's "needs to actually be bursting right now" semantics. 'total'
  // (recent+prior) is for a user-scoped search: a term that legitimately appears
  // anywhere in the (already query-filtered, small) matched set should not be
  // hidden just because it isn't also *recent*.
  floorOn?: 'recent' | 'total';
  // Absolute-count floor. Defaults to MIN_ABS_COUNT (the noise floor tuned for the
  // large, unfiltered global corpus). Scoped search callers should pass 1: if the
  // user's own query matched a real post, that post's terms are real data, not noise.
  minCount?: number;
  // For scoped search: rank terms containing this string ahead of same-score ties,
  // so a search for "onboarding" surfaces the "onboarding" n-gram itself first
  // rather than an arbitrary other n-gram from the same matched post.
  relevanceTo?: string;
}

/**
 * Core n-gram burst-scoring algorithm, generic over whatever post list is passed in.
 * Does not touch the DB. Used both for the global `source_type = 'trend'` sweep
 * (detectTrends, below) and for on-the-fly `?q=` scoped scoring (src/api/routes.ts),
 * so the two never duplicate the recent/prior/ranking logic -- only the floor differs.
 */
export function scoreBurstTerms(
  posts: { text: string; posted_at: string }[],
  window: BurstWindow,
  opts: ScoreOptions = {},
): RankedTerm[] {
  const floorOn = opts.floorOn ?? 'recent';
  const minCount = opts.minCount ?? MIN_ABS_COUNT;

  const counts = new Map<string, TermCounts>();
  for (const post of posts) {
    const isRecent = post.posted_at >= window.recentStart;
    const terms = new Set(ngrams(post.text)); // count each term once per post
    for (const term of terms) {
      const c = counts.get(term) ?? { recent: 0, prior: 0 };
      if (isRecent) c.recent += 1;
      else c.prior += 1;
      counts.set(term, c);
    }
  }

  const ranked = [...counts.entries()]
    .map(([term, c]) => ({
      term,
      recent: c.recent,
      prior: c.prior,
      // floor: prior count of 0 treated as 1 to avoid divide-by-zero inflating score;
      // absolute floor below filters out low-volume noise regardless of ratio.
      score: c.recent / Math.max(c.prior, 1),
    }))
    .filter((r) => (floorOn === 'recent' ? r.recent : r.recent + r.prior) >= minCount);

  const rank = (a: RankedTerm, b: RankedTerm) => {
    if (opts.relevanceTo) {
      const rel = opts.relevanceTo.toLowerCase();
      const aMatch = a.term.includes(rel) ? 1 : 0;
      const bMatch = b.term.includes(rel) ? 1 : 0;
      if (aMatch !== bMatch) return bMatch - aMatch;
    }
    return b.score - a.score;
  };

  // Unigrams are corpus word-frequency, not signal: "saas", "product", "based" have
  // inherently higher raw counts than any 2-3 word phrase and drown out anything
  // meaningful ("notion onboarding", "ai agent") if ranked on the same list. Surface
  // phrases first; only fall back to unigrams to fill remaining slots (or when no
  // phrase clears the floor at all) so the output is never empty.
  //
  // Exception: if the caller passed `relevanceTo` (the scoped `?q=` search), the
  // user searched for that exact term -- if it clears the floor at all, it MUST be
  // in the result regardless of whether it happens to be a unigram, since it's the
  // literal thing they asked about. Pin an exact match to the front rather than
  // letting it get crowded out by phrase-preference in a post with many phrases.
  const relLower = opts.relevanceTo?.toLowerCase();
  const exactMatch = relLower ? ranked.find((r) => r.term === relLower) : undefined;
  const rest = exactMatch ? ranked.filter((r) => r !== exactMatch) : ranked;

  const phrases = rest.filter((r) => r.term.includes(' ')).sort(rank);
  const unigrams = rest.filter((r) => !r.term.includes(' ')).sort(rank);

  const combined = exactMatch ? [exactMatch, ...phrases, ...unigrams] : [...phrases, ...unigrams];
  return combined.slice(0, MAX_TERMS);
}

/**
 * Computes burst scores from posts and makes `trends` authoritatively reflect the
 * current sweep: upserts every ranked term, then DELETEs any row not part of this
 * sweep's result set (including stale seed rows like seed-t1/seed-t2/seed-t3, and
 * any term that has aged out of the current window). This means the sweep is the
 * sole source of truth for what's in the table, not an additive upsert -- a term
 * that stops bursting stops appearing, rather than sitting at a stale score forever.
 *
 * `findings.trend_id` has no FK/cascade defined in the schema, so a deleted trend id
 * simply becomes an orphaned reference on any pre-existing finding row; nothing
 * violates the grounding invariant on findings.quote/post_id since those never
 * pointed at the trends table. GET /api/trends/:id already returns null/404 for an
 * id with no matching row, so lookups on a deleted seed id fail gracefully.
 *
 * Returns the number of trend rows written. Throws if it finds zero terms above the
 * absolute-count floor (fail loud, not a silent empty table) -- and in that failure
 * case leaves the existing `trends` table untouched rather than wiping it out.
 */
export function detectTrends(db: Database.Database): number {
  const { recentStart, priorStart, nowIso } = burstWindow();

  const posts = db
    .prepare(`select text, posted_at from posts where source_type = 'trend' and posted_at >= ?`)
    .all(priorStart) as { text: string; posted_at: string }[];

  const ranked = scoreBurstTerms(posts, { recentStart, priorStart, nowIso });

  if (ranked.length === 0) {
    // Fail loud without wiping the table -- runDetect throws on this below.
    return 0;
  }

  const upsert = db.prepare(`
    insert into trends (id, term, recent_count, prior_count, score, window_start, window_end)
    values (@id, @term, @recent, @prior, @score, @window_start, @window_end)
    on conflict(id) do update set
      recent_count = excluded.recent_count,
      prior_count = excluded.prior_count,
      score = excluded.score,
      window_start = excluded.window_start,
      window_end = excluded.window_end
  `);

  const tx = db.transaction((rows: typeof ranked) => {
    const currentIds: string[] = [];
    for (const r of rows) {
      const id = `trend-${r.term.replace(/\s+/g, '-')}`;
      currentIds.push(id);
      upsert.run({
        id,
        term: r.term,
        recent: r.recent,
        prior: r.prior,
        score: r.score,
        window_start: priorStart,
        window_end: nowIso,
      });
    }
    // Authoritative: anything not in this sweep's result set (stale terms, seed rows) goes.
    const placeholders = currentIds.map(() => '?').join(',');
    db.prepare(`delete from trends where id not in (${placeholders})`).run(...currentIds);
  });
  tx(ranked);

  return ranked.length;
}

/**
 * Bounded vocabulary of real n-gram terms actually present in the corpus, ranked by
 * raw frequency (not burst score -- this is a candidate list for grounded LLM
 * expansion in src/api/routes.ts, not a trend ranking). Scoped to the most recent
 * `postLimit` posts so this stays cheap on a large corpus, and capped to `termLimit`
 * terms so the resulting prompt to the LLM stays small. Every term returned is one
 * that literally occurs in real post text -- this is what keeps `?q=` related-term
 * expansion grounded instead of an LLM inventing synonyms out of thin air.
 */
export function topCorpusTerms(db: Database.Database, postLimit = 500, termLimit = 150): string[] {
  const posts = db
    .prepare(`select text from posts order by posted_at desc limit ?`)
    .all(postLimit) as { text: string }[];

  const counts = new Map<string, number>();
  for (const post of posts) {
    for (const term of new Set(ngrams(post.text))) {
      counts.set(term, (counts.get(term) ?? 0) + 1);
    }
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, termLimit)
    .map(([term]) => term);
}

export async function runDetect(db: Database.Database): Promise<number> {
  return withSpan('detect', async (span) => {
    try {
      const n = detectTrends(db);
      span.setRecordCount(n);
      if (n === 0) {
        span.setAttr('failure_reason', 'zero terms above floor');
        throw new Error('detectTrends produced zero terms above the absolute-count floor');
      }
      return n;
    } catch (err) {
      throw err;
    }
  });
}
