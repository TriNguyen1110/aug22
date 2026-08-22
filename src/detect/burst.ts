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
  'the', 'a', 'an', 'and', 'or', 'but', 'is', 'are', 'was', 'were', 'be', 'been',
  'to', 'of', 'in', 'on', 'for', 'with', 'at', 'by', 'this', 'that', 'it', 'we',
  'i', 'you', 'my', 'our', 'their', 'have', 'has', 'had', 'not', 'do', 'does',
  'did', 'so', 'as', 'if', 'from', 'about', 'they', 'them', 'he', 'she', 'his',
  'her', 'its', 'us', 'am', 'just', 'can', 'will', 'would', 'could', 'should',
]);

function ngrams(text: string): string[] {
  const words = text
    .toLowerCase()
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

/**
 * Computes burst scores from posts and upserts the ranked result into `trends`.
 * Returns the number of trend rows written. Throws if it finds zero terms above the
 * absolute-count floor (fail loud, not a silent empty table).
 */
export function detectTrends(db: Database.Database): number {
  const now = Date.now();
  const recentStart = new Date(now - RECENT_DAYS * 86400000).toISOString();
  const priorStart = new Date(now - PRIOR_DAYS * 86400000).toISOString();
  const nowIso = new Date(now).toISOString();

  const posts = db
    .prepare(`select text, posted_at from posts where source_type = 'trend' and posted_at >= ?`)
    .all(priorStart) as { text: string; posted_at: string }[];

  const counts = new Map<string, TermCounts>();
  for (const post of posts) {
    const isRecent = post.posted_at >= recentStart;
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
    .filter((r) => r.recent >= MIN_ABS_COUNT)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_TERMS);

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
    for (const r of rows) {
      upsert.run({
        id: `trend-${r.term.replace(/\s+/g, '-')}`,
        term: r.term,
        recent: r.recent,
        prior: r.prior,
        score: r.score,
        window_start: priorStart,
        window_end: nowIso,
      });
    }
  });
  tx(ranked);

  return ranked.length;
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
