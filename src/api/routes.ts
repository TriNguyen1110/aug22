/**
 * Route handler logic for the six routes frozen in CONTRACT.md. Pure functions over
 * a better-sqlite3 handle, no framework dependency, so app/api/**\/route.ts wrappers
 * stay a one-line pass-through. Every call is wrapped in an OTel span per CONTRACT's
 * observability rule (duration, record count, failure reason).
 */
import type Database from 'better-sqlite3';
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
