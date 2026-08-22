#!/usr/bin/env node
/**
 * Walks the whole pipeline and prints one line per check.
 * Exit 0 only if every check passed. Run after any change to ingest, detect, or the API.
 *
 *   node tools/smoke.mjs                 # db + api
 *   node tools/smoke.mjs --skip-api      # db only, before the server exists
 */
import Database from 'better-sqlite3';

const BASE = process.env.SMOKE_BASE ?? 'http://localhost:3000';
const dbPath = process.env.DB_PATH ?? './data/app.db';
const skipApi = process.argv.includes('--skip-api');
const results = [];

const check = async (name, fn) => {
  try {
    const detail = await fn();
    results.push({ name, ok: true, detail });
    console.log(`PASS  ${name}${detail ? `  (${detail})` : ''}`);
  } catch (err) {
    results.push({ name, ok: false, detail: err.message });
    console.log(`FAIL  ${name}  ${err.message}`);
  }
};

let db;
await check('db connects', async () => {
  db = new Database(dbPath, { fileMustExist: true });
  return dbPath;
});

if (db) {
  for (const t of ['companies', 'posts', 'trends', 'findings', 'competitor_snapshots']) {
    await check(`table ${t} exists`, async () => {
      const row = db.prepare(`select name from sqlite_master where type='table' and name=?`).get(t);
      if (!row) throw new Error('missing');
      return 'ok';
    });
  }

  await check('posts has rows', async () => {
    const { n } = db.prepare('select count(*) as n from posts').get();
    if (n === 0) throw new Error('0 rows, ingest produced nothing');
    return `${n} rows`;
  });

  await check('findings has rows', async () => {
    const { n } = db.prepare('select count(*) as n from findings').get();
    if (n === 0) throw new Error('0 rows, detection produced nothing');
    return `${n} rows`;
  });

  await check('no orphan findings', async () => {
    const { n } = db.prepare(`
      select count(*) as n from findings f left join posts p on p.id = f.post_id where p.id is null
    `).get();
    if (n > 0) throw new Error(`${n} findings cite a missing post`);
    return 'all cite real posts';
  });

  db.close();
}

if (!skipApi) {
  const get = async (path) => {
    const res = await fetch(new URL(path, BASE), { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  };

  await check('GET /api/health', async () => {
    const j = await get('/api/health');
    if (!j.ok) throw new Error('health reports not ok');
    if (!(j.records_extracted > 0)) throw new Error('records_extracted is 0');
    return `${j.records_extracted} records`;
  });

  let firstTrend;
  await check('GET /api/trends', async () => {
    const j = await get('/api/trends');
    if (!Array.isArray(j.trends)) throw new Error('trends is not an array');
    if (j.trends.length === 0) throw new Error('empty, detection returned nothing');
    firstTrend = j.trends[0]?.id;
    return `${j.trends.length} trends`;
  });

  if (firstTrend) {
    await check('GET /api/trends/:id', async () => {
      const j = await get(`/api/trends/${firstTrend}`);
      if (!j.findings?.length) throw new Error('trend has no findings');
      return `${j.findings.length} findings`;
    });
  }

  await check('GET /api/competitors', async () => {
    const j = await get('/api/competitors');
    if (!Array.isArray(j.companies)) throw new Error('companies is not an array');
    if (j.companies.length === 0) throw new Error('empty, no competitors loaded');
    return `${j.companies.length} companies`;
  });

  await check('GET /api/monitoring', async () => {
    const j = await get('/api/monitoring');
    if (!Array.isArray(j.posts)) throw new Error('posts is not an array');
    if (j.posts.length === 0) throw new Error('empty, no own-company posts loaded');
    return `${j.posts.length} posts`;
  });
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exit(1);
