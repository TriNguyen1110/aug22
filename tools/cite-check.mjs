#!/usr/bin/env node
/**
 * Proves every finding is grounded. Exact substring match of findings.quote against
 * the posts.text it cites, plus a reachability check on the post URL.
 *
 *   node tools/cite-check.mjs              # quotes only, no network
 *   node tools/cite-check.mjs --urls       # also verify every URL resolves
 *
 * Run this before recording anything. A fabricated quote ends the demo.
 */
import Database from 'better-sqlite3';

const checkUrls = process.argv.includes('--urls');
const dbPath = process.env.DB_PATH ?? './data/app.db';
const db = new Database(dbPath, { fileMustExist: true });

const rows = db.prepare(`
  select f.id, f.quote, f.claim, p.id as post_id, p.text, p.url
  from findings f
  left join posts p on p.id = f.post_id
  order by f.id
`).all();
db.close();

if (rows.length === 0) {
  console.error('FAIL  no findings to check. Detection produced nothing.');
  process.exit(1);
}

const norm = (s) => (s ?? '').replace(/\s+/g, ' ').trim();
const failures = [];

for (const r of rows) {
  if (!r.post_id) {
    failures.push([r.id, 'cites a post_id that does not exist']);
    continue;
  }
  if (!norm(r.quote)) {
    failures.push([r.id, 'quote is empty']);
    continue;
  }
  if (!norm(r.text).includes(norm(r.quote))) {
    failures.push([r.id, `quote not found in post ${r.post_id}: "${norm(r.quote).slice(0, 70)}"`]);
  }
}

if (checkUrls) {
  const unique = [...new Map(rows.filter((r) => r.url).map((r) => [r.url, r])).values()];
  const batch = 6;
  for (let i = 0; i < unique.length; i += batch) {
    await Promise.all(
      unique.slice(i, i + batch).map(async (r) => {
        try {
          const res = await fetch(r.url, { method: 'HEAD', redirect: 'follow', signal: AbortSignal.timeout(10000) });
          if (res.status >= 400) failures.push([r.id, `url returned ${res.status}: ${r.url}`]);
        } catch (err) {
          failures.push([r.id, `url unreachable: ${r.url} (${err.message})`]);
        }
      }),
    );
  }
}

console.log(`checked ${rows.length} findings${checkUrls ? ' with URL resolution' : ''}`);

if (!failures.length) {
  console.log('PASS  every quote is verbatim in the post it cites');
  process.exit(0);
}

console.log('');
for (const [id, why] of failures) console.log(`FAIL  ${id}  ${why}`);
console.error(`\n${failures.length} ungrounded finding(s). BLOCKING, do not demo this.`);
process.exit(1);
