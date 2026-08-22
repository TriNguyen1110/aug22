/**
 * Regression tests for the frontend's main success-path flows. No auth, no signup,
 * no signin, no session — this product has none, and one test below asserts the
 * home page never mentions any of that. Run with: node --test tests/frontend.flows.test.mjs
 *
 * Success-path only, per CLAUDE.md's hackathon scope.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const BASE = process.env.SMOKE_BASE ?? 'http://localhost:3000';
let browser;
let page;

test.before(async () => {
  browser = await chromium.launch();
  page = await browser.newPage();
});

test.after(async () => {
  await browser.close();
});

test('home page links to all three use cases with no login gate', async () => {
  const res = await page.goto(BASE, { waitUntil: 'networkidle' });
  assert.ok(res.status() < 400);
  const text = (await page.textContent('body')).toLowerCase();
  for (const word of ['sign in', 'log in', 'sign up', 'password', 'username']) {
    assert.ok(!text.includes(word), `home page must not mention "${word}"`);
  }
  assert.equal(await page.locator('a[href="/trends"]').count() > 0, true);
  assert.equal(await page.locator('a[href="/competitors"]').count() > 0, true);
  assert.equal(await page.locator('a[href="/monitoring"]').count() > 0, true);
});

test('trends flow: list renders ranked rows and links into detail', async () => {
  await page.goto(`${BASE}/trends`, { waitUntil: 'networkidle' });
  const rows = page.locator('table tbody tr');
  assert.ok((await rows.count()) > 0, 'trends table should have at least one row');
  const firstLink = page.locator('table tbody tr td a').first();
  assert.ok(await firstLink.getAttribute('href'), 'first trend should link to its detail page');
});

test('trends flow: detail page shows a finding with a clickable source citation', async () => {
  await page.goto(`${BASE}/trends`, { waitUntil: 'networkidle' });
  const href = await page.locator('table tbody tr td a').first().getAttribute('href');
  await page.goto(`${BASE}${href}`, { waitUntil: 'networkidle' });
  const citation = page.locator('main ul li a[target="_blank"]').first();
  assert.ok(await citation.count() > 0, 'trend detail should render at least one citation link');
  const citationHref = await citation.getAttribute('href');
  assert.ok(citationHref?.startsWith('http'), 'citation must link out to the source post url');
});

test('competitors flow: list renders both companies with snapshot links', async () => {
  await page.goto(`${BASE}/competitors`, { waitUntil: 'networkidle' });
  const text = await page.textContent('body');
  assert.ok(text.includes('Linear'));
  assert.ok(text.includes('Asana'));
  const snapshotLinks = page.locator('table tbody tr td a[target="_blank"]');
  assert.ok((await snapshotLinks.count()) > 0, 'at least one snapshot should link to its source');
});

test('competitors flow: detail page resolves from the list link', async () => {
  await page.goto(`${BASE}/competitors`, { waitUntil: 'networkidle' });
  const href = await page.locator('h2 a').first().getAttribute('href');
  const res = await page.goto(`${BASE}${href}`, { waitUntil: 'networkidle' });
  assert.ok(res.status() < 400);
});

test('monitoring flow: renders findings with source citations, no error boundary', async () => {
  const res = await page.goto(`${BASE}/monitoring`, { waitUntil: 'networkidle' });
  assert.ok(res.status() < 400);
  const text = (await page.textContent('body')).toLowerCase();
  assert.ok(!text.includes('application error'));
  const citation = page.locator('main ul li a[target="_blank"]').first();
  assert.ok(await citation.count() > 0, 'monitoring should render at least one citation link');
});
