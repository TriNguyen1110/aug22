#!/usr/bin/env node
/**
 * Seeds internally consistent fake data so the dashboard can be built before a
 * single real scrape succeeds. Idempotent: clears its own rows first.
 *
 *   node tools/seed.mjs                # clean data, cite-check should PASS
 *   node tools/seed.mjs --with-bad     # adds one fabricated quote, cite-check MUST FAIL
 *
 * Run it both ways once. If --with-bad still passes cite-check, the checker is
 * decorative and the grounding story is worthless.
 */
import pg from 'pg';

const withBad = process.argv.includes('--with-bad');
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

const POSTS = [
  ['seed-p1', 'reddit', 'u/throwaway_pm', 'https://example.com/seed/1',
   'Been using CompetitorX for six months. The onboarding is genuinely painful and support takes four days to reply. Considering switching.'],
  ['seed-p2', 'reddit', 'u/devops_tired', 'https://example.com/seed/2',
   'Nobody on my team can explain what the pipeline does anymore. The person who built it left in March and took all the context with them.'],
  ['seed-p3', 'reddit', 'u/growth_hacker', 'https://example.com/seed/3',
   'Everyone is posting italianbrainrot edits this week. Seven second clips, AI animal, absurd Italian name. Views are insane.'],
  ['seed-p4', 'reddit', 'u/pm_anon', 'https://example.com/seed/4',
   'We tried three agent tools last quarter and cancelled all of them. Cost was unpredictable and we could not audit what they touched.'],
  ['seed-p5', 'reddit', 'u/founder_2x', 'https://example.com/seed/5',
   'italianbrainrot is everywhere. My niece explained tralalero to me and I have never felt older.'],
];

const TRENDS = [
  ['seed-t1', 'italianbrainrot', 41, 3, 13.67],
  ['seed-t2', 'onboarding', 12, 9, 1.33],
  ['seed-t3', 'audit', 8, 2, 4.0],
];

// Every quote below is a verbatim substring of its post's text.
const FINDINGS = [
  ['seed-f1', 'seed-p3', 'seed-t1', 'Format is a short AI-animal clip with an absurd Italian name',
   'Seven second clips, AI animal, absurd Italian name', 'format', 0.9],
  ['seed-f2', 'seed-p5', 'seed-t1', 'Trend has reached audiences outside the original demographic',
   'italianbrainrot is everywhere', 'reach', 0.7],
  ['seed-f3', 'seed-p1', 'seed-t2', 'Onboarding friction is a named reason for churn',
   'The onboarding is genuinely painful', 'complaint', 0.85],
  ['seed-f4', 'seed-p4', 'seed-t3', 'Agent tools get cancelled over auditability, not capability',
   'we could not audit what they touched', 'complaint', 0.88],
  ['seed-f5', 'seed-p2', 'seed-t3', 'Context loss on departure is felt as an ongoing problem',
   'took all the context with them', 'complaint', 0.8],
];

const BAD = ['seed-f-bad', 'seed-p1', 'seed-t2', 'Users say the pricing is predatory',
  'the pricing is absolutely predatory and they hide it', 'complaint', 0.95];

await client.query(`delete from findings where id like 'seed-%'`);
await client.query(`delete from trends   where id like 'seed-%'`);
await client.query(`delete from posts    where id like 'seed-%'`);

for (const [id, platform, author, url, text] of POSTS) {
  await client.query(
    `insert into posts (id, platform, author, url, text, posted_at, fetched_at)
     values ($1,$2,$3,$4,$5, now() - (random() * interval '14 days'), now())`,
    [id, platform, author, url, text],
  );
}

for (const [id, term, recent, prior, score] of TRENDS) {
  await client.query(
    `insert into trends (id, term, recent_count, prior_count, score, window_start, window_end)
     values ($1,$2,$3,$4,$5, now() - interval '17 days', now())`,
    [id, term, recent, prior, score],
  );
}

const toInsert = withBad ? [...FINDINGS, BAD] : FINDINGS;
for (const [id, postId, trendId, claim, quote, category, confidence] of toInsert) {
  await client.query(
    `insert into findings (id, post_id, trend_id, claim, quote, category, confidence)
     values ($1,$2,$3,$4,$5,$6,$7)`,
    [id, postId, trendId, claim, quote, category, confidence],
  );
}

await client.end();

console.log(`seeded ${POSTS.length} posts, ${TRENDS.length} trends, ${toInsert.length} findings`);
if (withBad) {
  console.log('\nincludes one fabricated quote (seed-f-bad).');
  console.log('cite-check MUST fail now. If it passes, the checker is broken.');
} else {
  console.log('all quotes verbatim. cite-check should pass.');
}
