#!/usr/bin/env node
/**
 * Seeds internally consistent fake data so the dashboard can be built before a
 * single real scrape succeeds. Idempotent: clears its own rows first. Creates
 * tables if they don't exist yet, so this tool never blocks on a migration step.
 *
 *   node tools/seed.mjs                # clean data, cite-check should PASS
 *   node tools/seed.mjs --with-bad     # adds one fabricated quote, cite-check MUST FAIL
 *
 * Run it both ways once. If --with-bad still passes cite-check, the checker is
 * decorative and the grounding story is worthless.
 */
import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const withBad = process.argv.includes('--with-bad');
const dbPath = process.env.DB_PATH ?? './data/app.db';
mkdirSync(dirname(dbPath), { recursive: true });
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

db.exec(`
  create table if not exists companies (
    id text primary key, name text, domain text, role text
  );
  create table if not exists posts (
    id text primary key, company_id text, source_type text, platform text,
    author text, url text, text text, posted_at text, fetched_at text
  );
  create table if not exists trends (
    id text primary key, term text, recent_count integer, prior_count integer,
    score real, window_start text, window_end text
  );
  create table if not exists findings (
    id text primary key, post_id text, trend_id text, company_id text, use_case text,
    claim text, quote text, category text, confidence real
  );
  create table if not exists competitor_snapshots (
    id text primary key, company_id text, item_type text, label text,
    value_text text, url text, captured_at text
  );
`);

const now = () => new Date().toISOString();
const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString();

const COMPANIES = [
  ['co-notion', 'Notion', 'notion.so', 'target'],
  ['co-linear', 'Linear', 'linear.app', 'competitor'],
  ['co-asana', 'Asana', 'asana.com', 'competitor'],
];

const POSTS = [
  ['seed-p1', null, 'trend', 'reddit', 'u/throwaway_pm', 'https://example.com/seed/1',
   'Been using CompetitorX for six months. The onboarding is genuinely painful and support takes four days to reply. Considering switching.'],
  ['seed-p2', null, 'trend', 'reddit', 'u/devops_tired', 'https://example.com/seed/2',
   'Nobody on my team can explain what the pipeline does anymore. The person who built it left in March and took all the context with them.'],
  ['seed-p3', null, 'trend', 'reddit', 'u/growth_hacker', 'https://example.com/seed/3',
   'Everyone is posting italianbrainrot edits this week. Seven second clips, AI animal, absurd Italian name. Views are insane.'],
  ['seed-p4', null, 'trend', 'reddit', 'u/pm_anon', 'https://example.com/seed/4',
   'We tried three agent tools last quarter and cancelled all of them. Cost was unpredictable and we could not audit what they touched.'],
  ['seed-p5', null, 'trend', 'reddit', 'u/founder_2x', 'https://example.com/seed/5',
   'italianbrainrot is everywhere. My niece explained tralalero to me and I have never felt older.'],
  ['seed-p6', 'co-linear', 'competitor', 'reddit', 'u/eng_lead_22', 'https://example.com/seed/6',
   'Linear shipped triage automation this week and it cut our backlog grooming time in half.'],
  ['seed-p7', 'co-asana', 'competitor', 'reddit', 'u/ops_manager', 'https://example.com/seed/7',
   'Asana raised prices again and the new tier removes timeline view unless you go Enterprise.'],
  ['seed-p8', 'co-notion', 'own', 'reddit', 'u/notion_fan_88', 'https://example.com/seed/8',
   'Notion calendar sync finally works with Google Calendar without the third party plugin.'],
];

const TRENDS = [
  ['seed-t1', 'italianbrainrot', 41, 3, 13.67],
  ['seed-t2', 'onboarding', 12, 9, 1.33],
  ['seed-t3', 'audit', 8, 2, 4.0],
];

// Every quote below is a verbatim substring of its post's text.
const FINDINGS = [
  ['seed-f1', 'seed-p3', 'seed-t1', null, 'trends', 'Format is a short AI-animal clip with an absurd Italian name',
   'Seven second clips, AI animal, absurd Italian name', 'format', 0.9],
  ['seed-f2', 'seed-p5', 'seed-t1', null, 'trends', 'Trend has reached audiences outside the original demographic',
   'italianbrainrot is everywhere', 'reach', 0.7],
  ['seed-f3', 'seed-p1', 'seed-t2', null, 'trends', 'Onboarding friction is a named reason for churn',
   'The onboarding is genuinely painful', 'complaint', 0.85],
  ['seed-f4', 'seed-p4', 'seed-t3', null, 'trends', 'Agent tools get cancelled over auditability, not capability',
   'we could not audit what they touched', 'complaint', 0.88],
  ['seed-f5', 'seed-p2', 'seed-t3', null, 'trends', 'Context loss on departure is felt as an ongoing problem',
   'took all the context with them', 'complaint', 0.8],
  ['seed-f6', 'seed-p6', null, 'co-linear', 'competitor', 'Linear\'s triage automation is landing well with engineering leads',
   'cut our backlog grooming time in half', 'product', 0.8],
  ['seed-f7', 'seed-p7', null, 'co-asana', 'competitor', 'Asana\'s pricing change is gating timeline view behind Enterprise',
   'removes timeline view unless you go Enterprise', 'pricing', 0.85],
  ['seed-f8', 'seed-p8', null, 'co-notion', 'monitoring', 'Notion Calendar now syncs with Google Calendar natively',
   'Notion calendar sync finally works with Google Calendar', 'product', 0.9],
];

const SNAPSHOTS = [
  ['seed-s1', 'co-linear', 'price', 'Business plan', '$14/user/mo', 'https://linear.app/pricing'],
  ['seed-s2', 'co-asana', 'price', 'Advanced plan', '$13.49/user/mo', 'https://asana.com/pricing'],
  ['seed-s3', 'co-linear', 'update', 'Triage automation', 'Auto-routes incoming issues to the right team', 'https://linear.app/changelog'],
];

const BAD = ['seed-f-bad', 'seed-p1', 'seed-t2', null, 'trends', 'Users say the pricing is predatory',
  'the pricing is absolutely predatory and they hide it', 'complaint', 0.95];

db.prepare(`delete from findings where id like 'seed-%'`).run();
db.prepare(`delete from competitor_snapshots where id like 'seed-%'`).run();
db.prepare(`delete from trends where id like 'seed-%'`).run();
db.prepare(`delete from posts where id like 'seed-%'`).run();
db.prepare(`delete from companies where id like 'co-%'`).run();

const insertCompany = db.prepare(`insert into companies (id, name, domain, role) values (?,?,?,?)`);
for (const row of COMPANIES) insertCompany.run(...row);

const insertPost = db.prepare(`
  insert into posts (id, company_id, source_type, platform, author, url, text, posted_at, fetched_at)
  values (?,?,?,?,?,?,?,?,?)
`);
for (const [id, companyId, sourceType, platform, author, url, text] of POSTS) {
  insertPost.run(id, companyId, sourceType, platform, author, url, text, daysAgo(Math.random() * 14), now());
}

const insertTrend = db.prepare(`
  insert into trends (id, term, recent_count, prior_count, score, window_start, window_end)
  values (?,?,?,?,?,?,?)
`);
for (const [id, term, recent, prior, score] of TRENDS) {
  insertTrend.run(id, term, recent, prior, score, daysAgo(17), now());
}

const insertFinding = db.prepare(`
  insert into findings (id, post_id, trend_id, company_id, use_case, claim, quote, category, confidence)
  values (?,?,?,?,?,?,?,?,?)
`);
const findingsToInsert = withBad ? [...FINDINGS, BAD] : FINDINGS;
for (const row of findingsToInsert) insertFinding.run(...row);

const insertSnapshot = db.prepare(`
  insert into competitor_snapshots (id, company_id, item_type, label, value_text, url, captured_at)
  values (?,?,?,?,?,?,?)
`);
for (const [id, companyId, itemType, label, valueText, url] of SNAPSHOTS) {
  insertSnapshot.run(id, companyId, itemType, label, valueText, url, now());
}

db.close();

console.log(`seeded ${COMPANIES.length} companies, ${POSTS.length} posts, ${TRENDS.length} trends, ${findingsToInsert.length} findings, ${SNAPSHOTS.length} snapshots`);
if (withBad) {
  console.log('\nincludes one fabricated quote (seed-f-bad).');
  console.log('cite-check MUST fail now. If it passes, the checker is broken.');
} else {
  console.log('all quotes verbatim. cite-check should pass.');
}
