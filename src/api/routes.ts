/**
 * Route handler logic for the six routes frozen in CONTRACT.md. Pure functions over
 * a better-sqlite3 handle, no framework dependency, so app/api/**\/route.ts wrappers
 * stay a one-line pass-through. Every call is wrapped in an OTel span per CONTRACT's
 * observability rule (duration, record count, failure reason).
 */
import type Database from 'better-sqlite3';
import { readdirSync } from 'node:fs';
import { withSpan } from '../otel';

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

export async function getTrendById(db: Database.Database, id: string) {
  return withSpan('api.trends.byId', async (span) => {
    const trend = db.prepare('select * from trends where id = ?').get(id);
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
    span.setRecordCount(findings.length);
    return { trend, findings, posts };
  });
}

export async function getCompetitors(db: Database.Database) {
  return withSpan('api.competitors', async (span) => {
    const companies = db.prepare(`select * from companies where role = 'competitor'`).all();
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
