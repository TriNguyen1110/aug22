/**
 * Regression tests for the backend's main success-path flows. No auth, no signup,
 * no signin, no session — this product has none, and the last test below asserts
 * that stays true. Run with: node --test tests/backend.flows.test.mjs
 *
 * These are success-path only, per CLAUDE.md's hackathon scope. Failure-path and
 * auto-repair behavior is covered by scrape-doctor, not here.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

const BASE = process.env.SMOKE_BASE ?? 'http://localhost:3000';

const get = async (path) => {
  const res = await fetch(new URL(path, BASE));
  assert.equal(res.ok, true, `${path} returned ${res.status}`);
  return res.json();
};

test('health reports a successful ingest with records', async () => {
  const j = await get('/api/health');
  assert.equal(j.ok, true);
  assert.ok(j.records_extracted > 0, 'records_extracted should be > 0');
  assert.ok(j.last_ingest_at, 'last_ingest_at should be set');
});

test('trends flow: list is non-empty and ranked by score desc', async () => {
  const j = await get('/api/trends');
  assert.ok(Array.isArray(j.trends) && j.trends.length > 0, 'trends should not be empty');
  const scores = j.trends.map((t) => t.score);
  const sorted = [...scores].sort((a, b) => b - a);
  assert.deepEqual(scores, sorted, 'trends must be ranked by score desc');
});

test('trends flow: detail includes findings grounded in real posts', async () => {
  const list = await get('/api/trends');
  const id = list.trends[0].id;
  const j = await get(`/api/trends/${id}`);
  assert.equal(j.trend.id, id);
  assert.ok(j.findings.length > 0, 'trend should have at least one finding');
  for (const f of j.findings) {
    const post = j.posts.find((p) => p.id === f.post_id);
    assert.ok(post, `finding ${f.id} must cite a post present in the response`);
    assert.ok(post.text.includes(f.quote), `finding ${f.id} quote must be verbatim in the post text`);
  }
});

test('trends search: q= scopes to matching posts and grounds any findings it returns', async () => {
  const j = await get('/api/trends?q=onboarding');
  assert.equal(j.query, 'onboarding');
  assert.ok(j.matched_posts > 0, 'matched_posts should be > 0 for a term known to be in the seed corpus');
  assert.ok(Array.isArray(j.trends));
  assert.ok(Array.isArray(j.findings));
  assert.ok(Array.isArray(j.posts));
  assert.ok(j.trends.length > 0, 'a single-post match for "onboarding" must still clear the floor and return a trend (floorOn: total / minCount: 1)');
  assert.ok(
    j.trends[0].term.includes('onboarding'),
    `top-ranked scoped trend must be relevant to the query itself, got "${j.trends[0].term}" (relevanceTo tiebreak regression)`,
  );
  // Burst detection is floored on absolute recent-window count (src/detect/burst.ts);
  // seed post dates are randomized per `npm run seed` run, so whether any term clears
  // the floor for a narrow, single-term-match query varies run to run. Assert the
  // grounding invariant unconditionally: whatever findings *are* returned, every quote
  // must be a verbatim substring of the post it cites, and every cited post must be
  // present in the response's posts array.
  for (const f of j.findings) {
    const post = j.posts.find((p) => p.id === f.post_id);
    assert.ok(post, `finding ${f.id} must cite a post present in the response`);
    assert.ok(post.text.includes(f.quote), `finding ${f.id} quote must be verbatim in the post text`);
  }
});

test('trends search: a term shared by two seed posts scores independently of the global top-3', async () => {
  const j = await get('/api/trends?q=italianbrainrot');
  assert.equal(j.matched_posts, 2, 'exactly two seed posts mention italianbrainrot, independent of date randomization');
  if (j.trends.length > 0) {
    const global = await get('/api/trends');
    const globalTerm = global.trends.find((t) => t.term === 'italianbrainrot');
    const scoped = j.trends.find((t) => t.term === 'italianbrainrot');
    assert.ok(scoped, 'scoped trends should include the searched term when it clears the floor');
    if (globalTerm) {
      assert.notEqual(scoped.recent_count, globalTerm.recent_count, 'scoped count is computed fresh, not copied from the seeded global trends table');
    }
    for (const f of j.findings) {
      const post = j.posts.find((p) => p.id === f.post_id);
      assert.ok(post, `finding ${f.id} must cite a post present in the response`);
      assert.ok(post.text.includes(f.quote), `finding ${f.id} quote must be verbatim in the post text`);
    }
  }
});

test('trends search: a term with no matches returns an honest empty result, not an error', async () => {
  const j = await get('/api/trends?q=zzz_no_such_term_xyz123');
  assert.equal(j.matched_posts, 0);
  assert.deepEqual(j.trends, []);
  assert.deepEqual(j.findings, []);
  assert.deepEqual(j.posts, []);
});

test('trends flow with no q param is unchanged: reads the global trends table', async () => {
  const j = await get('/api/trends');
  assert.ok(!('query' in j) && !('matched_posts' in j), 'unscoped /api/trends must not carry search-response keys');
  assert.ok(Array.isArray(j.trends) && j.trends.length > 0);
});

test('trends flow reflects a real ingest+detect sweep, not just the 3 original seed trends', async () => {
  const j = await get('/api/trends');
  const seedIds = new Set(['seed-t1', 'seed-t2', 'seed-t3']);
  assert.ok(j.trends.length > 3, 'global trends table should hold more than the 3 original seed rows once a real ingest+detect run has happened');
  const nonSeed = j.trends.filter((t) => !seedIds.has(t.id));
  assert.ok(nonSeed.length > 0, 'at least one trend row must come from a real detect run, not only seed-t1/t2/t3');
  for (const t of nonSeed) {
    assert.ok(t.recent_count >= 0 && t.prior_count >= 0, `trend ${t.id} must carry real counts, not placeholders`);
  }
});

test('competitors flow: list includes both tracked competitors with snapshots', async () => {
  const j = await get('/api/competitors');
  const names = j.companies.map((c) => c.name);
  assert.ok(names.includes('Linear'), 'Linear should be tracked');
  assert.ok(names.includes('Asana'), 'Asana should be tracked');
  assert.ok(j.snapshots.length > 0, 'at least one competitor snapshot should exist');
});

test('competitors flow: detail resolves for a real company id', async () => {
  const list = await get('/api/competitors');
  const id = list.companies[0].id;
  const j = await get(`/api/competitors/${id}`);
  assert.equal(j.company.id, id);
});

test('monitoring flow: returns the target company\'s own posts and findings', async () => {
  const j = await get('/api/monitoring');
  assert.ok(j.posts.length > 0, 'monitoring should have at least one post');
  assert.ok(j.findings.length > 0, 'monitoring should have at least one finding');
});

test('pipeline-health flow: reports both naive and brightdata comparison keys', async () => {
  const j = await get('/api/pipeline-health');
  assert.ok(j.naive && typeof j.naive === 'object', 'naive key should be present');
  assert.ok('url' in j.naive && 'status' in j.naive && 'bytes' in j.naive && 'records_found' in j.naive && 'note' in j.naive);
  assert.ok(j.brightdata && typeof j.brightdata === 'object', 'brightdata key should be present');
  assert.ok('attempted' in j.brightdata && 'ok' in j.brightdata && 'records_extracted' in j.brightdata);
  assert.ok(j.brightdata.records_extracted > 0, 'brightdata records_extracted should reflect real ingested rows');
  const health = await get('/api/health');
  assert.equal(j.brightdata.records_extracted, health.records_extracted, 'brightdata.records_extracted must match /api/health');
  assert.ok(typeof j.naive.status === 'number' || j.naive.status === null, 'naive.status must be a real HTTP status or null on fetch failure, not hardcoded');
  assert.ok(typeof j.naive.bytes === 'number', 'naive.bytes must be a real byte count');
});

test('pipeline-health flow: naive fetch is cached for ~60s, second rapid call is fast and consistent', async () => {
  const t0 = Date.now();
  const first = await get('/api/pipeline-health');
  const firstMs = Date.now() - t0;

  const t1 = Date.now();
  const second = await get('/api/pipeline-health');
  const secondMs = Date.now() - t1;

  assert.deepEqual(second.naive, first.naive, 'second call within the TTL window must return the identical cached naive object');
  assert.ok(secondMs < 200, `cached second call should be fast (<200ms), took ${secondMs}ms (first call took ${firstMs}ms)`);
});

test('competitors flow: industry filter narrows the result set to that industry', async () => {
  const filtered = await get('/api/competitors?industry=fintech-infra');
  assert.ok(filtered.companies.length > 0, 'fintech-infra should match at least one seeded company');
  for (const c of filtered.companies) {
    assert.equal(c.industry, 'fintech-infra', `company ${c.name} should belong to the filtered industry`);
  }
  const unfiltered = await get('/api/competitors');
  assert.ok(filtered.companies.length < unfiltered.companies.length, 'filtered set must be a proper subset');
});

test('competitors flow: sort=market_share orders companies by descending market share', async () => {
  const j = await get('/api/competitors?sort=market_share');
  const shares = j.companies.map((c) => c.market_share);
  const sorted = [...shares].sort((a, b) => b - a);
  assert.deepEqual(shares, sorted, 'companies must be ranked by market_share desc');
});

test('competitors flow: no params leaves behavior unchanged from before industry/sort existed', async () => {
  const j = await get('/api/competitors');
  assert.ok(Array.isArray(j.companies) && j.companies.length > 0);
  assert.ok(Array.isArray(j.snapshots));
});

test('chat flow: a question matching real data returns a grounded, verified answer', async () => {
  const res = await fetch(new URL('/api/chat', BASE), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question: 'What are people saying about onboarding?' }),
  });
  assert.equal(res.ok, true, `chat request failed: ${res.status}`);
  const j = await res.json();
  assert.ok(typeof j.answer === 'string' && j.answer.length > 0, 'answer must be a non-empty string');
  assert.ok(Array.isArray(j.citations), 'citations must be an array');
  assert.ok(j.citations.length > 0, 'a matching question should produce at least one citation');

  const posts = await get('/api/health'); // sanity: DB is reachable for the cross-check below
  assert.ok(posts.ok);
  const db = await import('better-sqlite3');
  const Database = db.default;
  const conn = new Database(process.env.DB_PATH ?? './data/app.db', { readonly: true });
  for (const c of j.citations) {
    const post = conn.prepare('select text from posts where id = ?').get(c.post_id);
    assert.ok(post, `citation cites a real post_id (${c.post_id})`);
    assert.ok(post.text.includes(c.quote), `citation quote must be verbatim in post ${c.post_id}`);
  }
  conn.close();

  assert.ok(j.brightdata && typeof j.brightdata.attempted === 'boolean', 'brightdata.attempted must be present');
  assert.ok(typeof j.brightdata.ok === 'boolean', 'brightdata.ok must be present');
});

test('chat flow: a question with no matching data returns an honest empty answer, no fabrication', async () => {
  const res = await fetch(new URL('/api/chat', BASE), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question: 'zzz_totally_unrelated_nonexistent_topic_xyz' }),
  });
  assert.equal(res.ok, true);
  const j = await res.json();
  assert.equal(j.citations.length, 0, 'no matching posts means no citations, not a fabricated one');
});

test('chat flow: answer text never asserts a claim whose citation was dropped for failing verification', async () => {
  // Regression for item 19: a real dogfooding run against OpenAI Codex/AI-agent posts
  // showed the model narrating 5 distinct claims each tagged with a POST_ID in the
  // free-text `answer`, while server-side verification dropped 4 of the 5 citations
  // as ungrounded. The `citations` array was correctly cleaned but the prose was not,
  // so a reader saw 5 confidently-stated claims backed by only 1 real citation. This
  // test asserts every post-id-shaped token that appears anywhere in the final
  // `answer` string is also present as a `post_id` in the final `citations` array —
  // no orphaned references, regardless of how many the model originally claimed.
  const db = await import('better-sqlite3');
  const Database = db.default;
  const conn = new Database(process.env.DB_PATH ?? './data/app.db', { readonly: true });
  const allPostIds = conn.prepare('select id from posts').all().map((r) => r.id);
  conn.close();

  const questions = [
    'What are people saying about OpenAI Codex?',
    'What are people saying about Claude Code and AI agents?',
  ];

  let checked = false;
  for (const question of questions) {
    const res = await fetch(new URL('/api/chat', BASE), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question }),
    });
    assert.equal(res.ok, true, `chat request failed: ${res.status}`);
    const j = await res.json();
    assert.ok(typeof j.answer === 'string', 'answer must be a string');
    assert.ok(Array.isArray(j.citations), 'citations must be an array');

    const verifiedIds = new Set(j.citations.map((c) => c.post_id));
    for (const id of allPostIds) {
      if (j.answer.includes(id)) {
        assert.ok(
          verifiedIds.has(id),
          `answer references post_id "${id}" but it is not present in the final citations array — orphaned/hallucinated reference leaked into user-facing text`,
        );
      }
    }
    checked = true;
  }
  assert.ok(checked, 'at least one question must have been exercised');
});

test('no main-flow route requires auth, a session, or credentials', async () => {
  for (const path of ['/api/health', '/api/trends', '/api/competitors', '/api/monitoring']) {
    const res = await fetch(new URL(path, BASE));
    assert.notEqual(res.status, 401, `${path} must not require auth`);
    assert.notEqual(res.status, 403, `${path} must not require auth`);
  }
});
