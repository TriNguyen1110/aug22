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

test('no main-flow route requires auth, a session, or credentials', async () => {
  for (const path of ['/api/health', '/api/trends', '/api/competitors', '/api/monitoring']) {
    const res = await fetch(new URL(path, BASE));
    assert.notEqual(res.status, 401, `${path} must not require auth`);
    assert.notEqual(res.status, 403, `${path} must not require auth`);
  }
});
