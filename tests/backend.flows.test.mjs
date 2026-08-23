/**
 * Regression tests for the backend's main success-path flows. No auth, no signup,
 * no signin, no session — this product has none, and the last test below asserts
 * that stays true. Run with: node --test tests/backend.flows.test.mjs
 *
 * These are success-path only, per CLAUDE.md's hackathon scope, with one deliberate
 * exception: the auto-repair drill below, which is itself the demoed success path
 * (detect the break loudly, then repair and recover records) called out in CLAUDE.md
 * as never-cut. Ad hoc scrape-doctor investigation is a separate concern from this
 * standing regression test.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import Database from 'better-sqlite3';

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

test('trends search: burst ranking prefers real multi-word phrases over single stopword-adjacent words', async () => {
  const j = await get('/api/trends');
  // Not asserting specific terms (corpus-dependent, would be flaky) -- asserting the
  // shape of the fix: among the top few ranked global trends, at least one is a real
  // 2-3 word phrase, not just single words winning on raw frequency alone.
  const top = j.trends.slice(0, 10);
  assert.ok(top.length > 0, 'global trends should not be empty');
  const hasPhrase = top.some((t) => t.term.includes(' '));
  assert.ok(hasPhrase, `expected at least one multi-word phrase in the top 10 trends, got: ${top.map((t) => t.term).join(', ')}`);
});

test('trends search: q= includes a related array, grounded when non-empty', async () => {
  const j = await get('/api/trends?q=notion');
  assert.ok(Array.isArray(j.related), 'related must always be an array, even when empty (missing key / LLM failure)');
  for (const r of j.related) {
    assert.equal(typeof r.term, 'string');
    assert.equal(typeof r.recent_count, 'number');
    assert.equal(typeof r.prior_count, 'number');
    assert.equal(typeof r.score, 'number');
  }
  // Any finding grounded by a related term follows the exact same verbatim-quote
  // rule as every other finding -- check every finding returned by this request,
  // not just the ones tied to the direct-match trends.
  for (const f of j.findings) {
    const post = j.posts.find((p) => p.id === f.post_id);
    assert.ok(post, `finding ${f.id} must cite a post present in the response`);
    assert.ok(post.text.includes(f.quote), `finding ${f.id} quote must be verbatim in the post text`);
  }
});

test('trends search: related expansion still returns an array (possibly non-empty) even when matched_posts is 0', async () => {
  const j = await get('/api/trends?q=zzz_no_such_term_xyz123');
  assert.equal(j.matched_posts, 0);
  assert.deepEqual(j.trends, []);
  assert.ok(Array.isArray(j.related), 'related must be present as an array even on a zero-match query');
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
  assert.ok(names.includes('OpenAI'), 'OpenAI should be tracked as the demo-target competitor (Anthropic/OpenAI pivot)');
  assert.ok(j.snapshots.length > 0, 'at least one competitor snapshot should exist');
});

test('Anthropic/OpenAI data pivot: companies table has the real demo-target rows with correct roles', async () => {
  const j = await get('/api/competitors');
  const openai = j.companies.find((c) => c.id === 'co-openai');
  assert.ok(openai, 'co-openai must exist in companies');
  assert.equal(openai.role, 'competitor');
  // co-anthropic is role='target', so it is deliberately absent from /api/competitors
  // (which only lists role='competitor' rows) -- confirmed instead via /api/monitoring below.
  const anthropicSnapshot = j.snapshots.find((s) => s.company_id === 'co-anthropic' && s.item_type === 'profile');
  const openaiSnapshot = j.snapshots.find((s) => s.company_id === 'co-openai' && s.item_type === 'profile');
  assert.ok(anthropicSnapshot, 'a real LinkedIn profile snapshot for co-anthropic must exist');
  assert.ok(openaiSnapshot, 'a real LinkedIn profile snapshot for co-openai must exist');
  assert.ok(anthropicSnapshot.value_text.length > 20, 'co-anthropic profile must be substantive, not a placeholder');
  assert.ok(openaiSnapshot.value_text.length > 20, 'co-openai profile must be substantive, not a placeholder');
});

test('Anthropic/OpenAI data pivot: monitoring surfaces real r/ClaudeAI posts for the target company', async () => {
  const j = await get('/api/monitoring');
  assert.ok(j.posts.length > 0, 'monitoring should have at least one post');
  // Seed data (id starting with 'seed-') legitimately coexists with real ingested
  // data -- item 24 shipped a visual "SEEDED / DEMO DATA" divider in the dashboard to
  // distinguish them, rather than requiring 100% purity of company_id here. Enforce
  // the real-provenance invariants only on non-seed posts, and separately confirm at
  // least one real co-anthropic post actually exists so this test still proves real
  // data is present.
  const realPosts = j.posts.filter((p) => !p.id.startsWith('seed-'));
  for (const p of realPosts) {
    assert.equal(p.source_type, 'own');
    assert.equal(p.company_id, 'co-anthropic', 'real monitoring posts must be keyed to the real target company co-anthropic');
    // company_id/source_type (checked above) is the real provenance guarantee -- it's
    // set from the subreddit map at ingest time, not derived from the URL. Checking
    // the URL for the literal subreddit path is unreliable for image/link posts,
    // where the URL is the raw media link (e.g. i.redd.it/*.png) rather than the
    // subreddit permalink -- that's a real, separate concern (citation quality for
    // media posts), not a data-integrity one. Just confirm it's a real reddit.com URL.
    assert.ok(p.url.includes('redd.it') || p.url.includes('reddit.com'), `monitoring post ${p.id} should have a real Reddit URL, got ${p.url}`);
  }
  assert.ok(
    j.posts.some((p) => p.company_id === 'co-anthropic'),
    'at least one real co-anthropic monitoring post must exist',
  );
});

test('Anthropic/OpenAI data pivot: health record count reflects the new SUBREDDIT_MAP (singularity/chatgptcoding/claudeai)', async () => {
  const j = await get('/api/health');
  assert.ok(j.records_extracted > 0, 'records_extracted must be > 0');
  const monitoring = await get('/api/monitoring');
  const competitors = await get('/api/competitors');
  assert.ok(monitoring.posts.length > 0, 'r/ClaudeAI-derived own posts must exist');
  assert.ok(competitors.companies.some((c) => c.id === 'co-openai'), 'co-openai must be represented');
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

test('competitor expansion (item 28): every listed competitor has real backing data, not just a bare company row', async () => {
  const j = await get('/api/competitors');
  const expanded = ['co-google', 'co-meta', 'co-xai'];
  for (const id of expanded) {
    const company = j.companies.find((c) => c.id === id);
    assert.ok(company, `${id} must exist in /api/competitors companies`);
    const snaps = j.snapshots.filter((s) => s.company_id === id);
    const detail = await get(`/api/competitors/${id}`);
    const hasBacking = snaps.length > 0 || detail.posts.length > 0;
    assert.ok(
      hasBacking,
      `${id} must have at least one real competitor_snapshots row or post -- a company listed with zero backing data is a bare/unpopulated row, not a real tracked competitor`,
    );
  }
});

test('competitor insight (item 28): GET /api/competitors/:id insight, when present, cites only real verifiable sources', async () => {
  const j = await get('/api/competitors');
  const openai = j.companies.find((c) => c.id === 'co-openai');
  assert.ok(openai, 'co-openai must exist for this check');
  const detail = await get('/api/competitors/co-openai');
  assert.ok(detail.insight, 'co-openai has enough real source material that insight should not be null');
  assert.ok(Array.isArray(detail.insight.pros) && detail.insight.pros.length > 0, 'insight.pros should be non-empty');
  assert.ok(Array.isArray(detail.insight.cons) && detail.insight.cons.length > 0, 'insight.cons should be non-empty');
  assert.ok(Array.isArray(detail.insight.sources) && detail.insight.sources.length > 0, 'insight.sources should be non-empty');
  const postSources = detail.insight.sources.filter((s) => s.kind === 'post');
  assert.ok(postSources.length > 0, 'at least one insight source must be a real Reddit post, not only LinkedIn snapshots');
  const db = new Database(process.env.DB_PATH ?? './data/app.db', { readonly: true });
  try {
    for (const src of postSources) {
      const row = db.prepare('select id from posts where id = ?').get(src.id);
      assert.ok(row, `insight source post_id ${src.id} must exist in posts (no fabricated source ids)`);
    }
  } finally {
    db.close();
  }
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

test('trends flow: /:id timeline is zero-filled daily across the window, not omitted', async () => {
  // Use whatever real trend currently tops the sweep, not a hardcoded seed id -- the
  // trends table is authoritative over the current sweep (src/detect/burst.ts) and
  // seed-t1/t2/t3 are designed to be ephemeral, not to persist forever.
  const list = await get('/api/trends');
  const realId = list.trends[0].id;
  const j = await get(`/api/trends/${realId}`);
  assert.ok(Array.isArray(j.timeline) && j.timeline.length > 0, 'timeline should be present and non-empty');
  const start = new Date(j.trend.window_start);
  const end = new Date(j.trend.window_end);
  const expectedDays = Math.floor((end - start) / 86400000) + 1;
  assert.equal(j.timeline.length, expectedDays, 'timeline must have one entry per day across the window, zero-filled');
  for (const point of j.timeline) {
    assert.ok('date' in point && 'count' in point, 'each timeline point needs date and count');
    assert.ok(typeof point.count === 'number' && point.count >= 0, 'count must be a non-negative number');
  }
  const total = j.timeline.reduce((sum, p) => sum + p.count, 0);
  assert.ok(total > 0, 'at least one day should have a non-zero count for a real trend');
});

test('competitors flow: q= scopes to matching companies/snapshots, honest empty on no match', async () => {
  const j = await get('/api/competitors?q=enterprise');
  assert.equal(j.query, 'enterprise');
  assert.ok(j.matched_companies > 0, 'enterprise should match at least one real company');
  assert.equal(j.companies.length, j.matched_companies);
  const empty = await get('/api/competitors?q=zzzznonexistentxyz');
  assert.equal(empty.matched_companies, 0, 'an unmatched term must return an honest empty result, not an error');
  assert.deepEqual(empty.companies, []);
  assert.deepEqual(empty.snapshots, []);
});

test('competitors flow: LinkedIn profile snapshots are real, grounded company descriptions', async () => {
  const j = await get('/api/competitors');
  const profiles = j.snapshots.filter((s) => s.item_type === 'profile');
  assert.ok(profiles.length > 0, 'at least one real LinkedIn profile snapshot should exist');
  for (const p of profiles) {
    assert.ok(p.value_text && p.value_text.length > 20, `profile ${p.id} should have a substantive description, not a placeholder`);
    assert.ok(p.url && p.url.includes('linkedin.com'), `profile ${p.id} should cite a real LinkedIn url`);
  }
});

test('chat flow: scope=competitor restricts retrieval away from trend/own posts', async () => {
  // "What about price?" alone is ambiguous now that the demo has multiple competitors
  // (Asana as illustrative seed data, OpenAI as the real live one) -- the agentic
  // tool-selection step can reasonably infer either. Name the competitor explicitly so
  // the test verifies the actual invariant (scope restricts retrieval to source_type=
  // 'competitor', excluding trend/own posts) without depending on which competitor the
  // model infers from a vague question.
  const scoped = await fetch(new URL('/api/chat', BASE), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question: "What about Asana's price increase?", scope: 'competitor' }),
  }).then((r) => r.json());
  assert.ok(scoped.citations.length > 0, 'scoped competitor question naming Asana should find the real Asana price-increase post');
  assert.equal(scoped.citations[0].post_id, 'seed-p7', 'scope=competitor should surface the competitor-sourced pricing post');
  // Test the actual invariant directly (every cited post's source_type is
  // 'competitor') rather than asserting scoped vs. unscoped results must differ --
  // with a large enough corpus, the single most relevant post can legitimately be
  // the same regardless of scope (nothing else is topically closer), so "results
  // differ" is not a reliable proxy for "scope filtering works."
  const db = new Database(process.env.DB_PATH ?? './data/app.db', { readonly: true });
  for (const c of scoped.citations) {
    const post = db.prepare('select source_type from posts where id = ?').get(c.post_id);
    assert.ok(post, `citation ${c.post_id} must reference a real post`);
    assert.equal(post.source_type, 'competitor', `scope=competitor must only cite source_type='competitor' posts, got '${post.source_type}' for ${c.post_id}`);
  }
  db.close();
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

test('chat flow: agentic tool-selection picks the real subject of the question, not a decoy stopword-adjacent word', async () => {
  // Regression for item 26: extractChatTerm's "longest word" heuristic picked
  // "think" instead of "codex"/"openai" for "what do people think of Open AI's
  // Codex", so retrieval ran against the wrong term entirely. getChat now asks
  // Claude to choose the search term via a forced tool call (search_data) instead.
  // We can't assert the exact term chosen (that's an internal implementation
  // detail we deliberately don't leak into the response), but we CAN assert the
  // downstream effect: retrieval actually finds and cites posts that are
  // genuinely about the question's real subject, not an empty/wrong result.
  const questions = [
    "what do people think of Open AI's Codex",
    'What are people saying about Notion?',
    'Any news on Stripe pricing?',
  ];

  for (const question of questions) {
    const res = await fetch(new URL('/api/chat', BASE), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question }),
    });
    assert.equal(res.ok, true, `chat request failed for "${question}": ${res.status}`);
    const j = await res.json();
    assert.ok(typeof j.answer === 'string' && j.answer.length > 0, `answer must be non-empty for "${question}"`);
    assert.ok(Array.isArray(j.citations), `citations must be an array for "${question}"`);
    // Every citation's quote must be verbatim in its post (existing invariant),
    // re-asserted here as a cheap sanity check that the new tool-call path did
    // not regress grounding while changing what drives retrieval.
    const db = await import('better-sqlite3');
    const Database = db.default;
    const conn = new Database(process.env.DB_PATH ?? './data/app.db', { readonly: true });
    for (const c of j.citations) {
      const post = conn.prepare('select text from posts where id = ?').get(c.post_id);
      assert.ok(post, `citation cites a real post_id (${c.post_id}) for "${question}"`);
      assert.ok(post.text.includes(c.quote), `citation quote must be verbatim in post ${c.post_id} for "${question}"`);
    }
    conn.close();
  }
});

test('agentic chat: each scope offers a distinctly-named, distinctly-described tool, not one generic tool with a scope filter', async () => {
  // Item 26 regression: SCOPED_TOOLS in src/api/routes.ts must define a real,
  // separately-named tool per page scope, not a single generic tool with the scope
  // value spliced into a shared description.
  const src = await import('node:fs/promises').then((fs) => fs.readFile('src/api/routes.ts', 'utf-8'));
  const names = ['search_trends', 'search_competitors', 'search_own_reception'];
  for (const name of names) {
    assert.ok(src.includes(`name: '${name}'`), `SCOPED_TOOLS must define a tool literally named '${name}'`);
  }
  const uniqueNames = new Set(names);
  assert.equal(uniqueNames.size, names.length, 'all scoped tool names must be distinct');
  // Each tool's description block must exist and differ from the others (not the
  // same string reused across scopes).
  const descMatches = [...src.matchAll(/description:\s*\n?\s*"([^"]+)"/g)].map((m) => m[1]);
  const scopedDescs = descMatches.filter((d) =>
    d.includes('trend/topic') || d.includes('named competitors') || d.includes('being received'),
  );
  assert.ok(scopedDescs.length >= 3, 'expected at least 3 distinct scoped tool descriptions in source');
  assert.equal(new Set(scopedDescs).size, scopedDescs.length, 'scoped tool descriptions must all be distinct, not copy-pasted');
});

test('chat flow: tool input schema accepts a "terms" array (1-5 synonyms), not a single "term" string', async () => {
  // Item 27 regression: the tool-selection input_schema used to require a single
  // `term` string, which couldn't carry synonyms. It must now require `terms` as
  // an array with 1-5 entries.
  const src = await import('node:fs/promises').then((fs) => fs.readFile('src/api/routes.ts', 'utf-8'));
  assert.match(src, /terms:\s*\{\s*type:\s*'array'/, 'input_schema must define terms as an array');
  assert.match(src, /minItems:\s*1/, 'terms array must allow as few as 1 entry');
  assert.match(src, /maxItems:\s*5/, 'terms array must cap at 5 entries');
  assert.match(src, /required:\s*\['terms'\]/, 'input_schema must require terms, not a legacy single term field');
  assert.doesNotMatch(src, /required:\s*\['term'\]/, 'must not still require a single legacy "term" field');
});

test('grounding fix regression: findVerbatimQuote and buildTimeline tolerate a bounded word gap, but every finding quote stays a real, contiguous substring', async () => {
  // Pick the current top trend live rather than hardcoding an id, since the trends
  // table reflects whatever the current detect sweep produced.
  const list = await get('/api/trends');
  assert.ok(list.trends.length > 0, 'there must be a current top trend to check');
  const top = list.trends[0];
  assert.ok(top.recent_count > 0, 'top trend must have a non-zero recent_count');
  const detail = await get(`/api/trends/${top.id}`);
  assert.ok(detail.findings.length > 0, `trend ${top.id} (recent_count=${top.recent_count}) must not regress to an empty findings array`);
  assert.ok(
    detail.timeline.some((p) => p.count > 0),
    `trend ${top.id} (recent_count=${top.recent_count}) must not regress to an all-zero timeline`,
  );
  for (const f of detail.findings) {
    const post = detail.posts.find((p) => p.id === f.post_id);
    assert.ok(post, `finding ${f.id} must cite a post present in the response`);
    assert.ok(post.text.includes(f.quote), `finding ${f.id} quote "${f.quote}" must be an exact, verbatim, contiguous substring of the real post text, never reconstructed`);
  }
});

test('auto-repair drill: simulate-break fails loudly with 0 records, --repair recovers all of them, DB untouched throughout', () => {
  const dbPath = process.env.DB_PATH ?? './data/app.db';
  const countPosts = () => new Database(dbPath, { readonly: true }).prepare('select count(*) as n from posts').get().n;

  const before = countPosts();

  // Stage 1: break, no repair -> non-zero exit, records_extracted 0, loud diagnostic.
  let brokeLoudly = false;
  let brokenOutput = '';
  try {
    execFileSync('node', ['--env-file=.env.local', '--import', 'tsx', 'src/ingest/reddit.ts', '--simulate-break'], {
      encoding: 'utf-8',
      stdio: 'pipe',
    });
  } catch (err) {
    brokeLoudly = true;
    brokenOutput = (err.stderr || '') + (err.stdout || '');
  }
  assert.ok(brokeLoudly, '--simulate-break without --repair must exit non-zero');
  assert.match(brokenOutput, /records_extracted is 0/, 'failure must name the zero-record symptom');
  assert.match(brokenOutput, /field mapping changed shape/i, 'failure must name the likely cause (field mapping change)');
  assert.equal(countPosts(), before, 'a failed ingest must not modify posts');

  // Stage 2: same broken cache, with --repair -> succeeds, recovers every record the
  // break simulation touched. Don't hardcode a specific count -- the source cache
  // file's real size grows as the corpus grows (it's whatever the most recent live
  // ingest cached), so assert "some positive number of records recovered" via the
  // real summary object, not a magic number that goes stale every time ingest runs.
  const repairedOutput = execFileSync(
    'node',
    ['--env-file=.env.local', '--import', 'tsx', 'src/ingest/reddit.ts', '--simulate-break', '--repair'],
    { encoding: 'utf-8', stdio: 'pipe' },
  );
  const recoveredMatch = repairedOutput.match(/(\d+) records from .*simulate-break/);
  assert.ok(recoveredMatch, `--repair output must report a record count from the simulate-break cache, got: ${repairedOutput}`);
  assert.ok(Number(recoveredMatch[1]) > 0, '--repair must recover more than 0 records');
  assert.equal(countPosts(), before, 'repair upserts the same real post ids/text, post count must be unchanged');
});

test('no main-flow route requires auth, a session, or credentials', async () => {
  for (const path of ['/api/health', '/api/trends', '/api/competitors', '/api/monitoring']) {
    const res = await fetch(new URL(path, BASE));
    assert.notEqual(res.status, 401, `${path} must not require auth`);
    assert.notEqual(res.status, 403, `${path} must not require auth`);
  }
});

test('item 29: burst trends do not surface generic courtesy/filler phrases as "trends"', async () => {
  // Regression for a live qualitative audit: "happy answer" (from "happy to answer
  // [questions]" -- a Reddit sign-off, not topical content) previously ranked #1,
  // and fragments of other boilerplate phrases ("solve real", "real problem",
  // "especially interested", "long first") polluted the top ranks. None of these
  // carry topical signal regardless of how many unrelated posts happen to use them.
  const j = await get('/api/trends');
  const banned = [
    'happy answer',
    'happy to answer',
    'solve real',
    'real problem',
    'solve real problem',
    'especially interested',
    'long first',
    'let know',
    'feel free',
  ];
  const terms = j.trends.map((t) => t.term);
  for (const b of banned) {
    assert.ok(!terms.includes(b), `boilerplate term "${b}" must not appear in /api/trends output, got: ${terms.join(', ')}`);
  }
});

test('item 29: chat retrieval biases toward real (non-seed) posts over seed placeholders when both match', async () => {
  // Regression: asking a trends-scope sentiment question about AI agents previously
  // retrieved and cited seed-p4 (a synthetic seed post at https://example.com/seed/4)
  // ahead of real, on-topic live posts sitting in the same corpus (e.g. the real
  // NVIDIA/ARC-AGI-3 post, id t3_1vuhlhn). Seed data should only win when it is the
  // best (or only) match, not merely because it happens to phrase things closer to
  // the query than a real post that is a comparably good answer.
  const res = await fetch(new URL('/api/chat', BASE), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question: 'What is the sentiment around AI agents right now?', scope: 'trends' }),
  });
  assert.equal(res.ok, true, `chat request failed: ${res.status}`);
  const j = await res.json();
  assert.ok(Array.isArray(j.citations), 'citations must be an array');
  if (j.citations.length > 0) {
    const db = await import('better-sqlite3');
    const Database = db.default;
    const conn = new Database(process.env.DB_PATH ?? './data/app.db', { readonly: true });
    const hasRealAiAgentPost = conn
      .prepare(`select 1 from posts where source_type = 'trend' and id not like 'seed-%' and (text like '%agent%' or text like '%AI%') limit 1`)
      .get();
    conn.close();
    if (hasRealAiAgentPost) {
      const citedIds = j.citations.map((c) => c.post_id);
      assert.ok(
        citedIds.some((id) => !id.startsWith('seed-')),
        `expected at least one non-seed citation when real AI/agent posts exist in the corpus, got: ${citedIds.join(', ')}`,
      );
    }
  }
});
