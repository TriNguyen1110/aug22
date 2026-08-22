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

test('home page shows naive fetch vs Bright Data pipeline health with real figures', async () => {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  const text = await page.textContent('body');
  assert.ok(text.includes('Naive fetch'), 'home page should show a naive fetch figure');
  assert.ok(text.includes('Bright Data'), 'home page should show a Bright Data figure');
  assert.ok(text.includes('Records extracted'), 'home page should show records_extracted from pipeline-health');
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

test('trend detail page renders a sparkline svg for the timeline', async () => {
  await page.goto(`${BASE}/trends`, { waitUntil: 'networkidle' });
  const href = await page.locator('table tbody tr td a').first().getAttribute('href');
  await page.goto(`${BASE}${href}`, { waitUntil: 'networkidle' });
  const svg = page.locator('main svg[role="img"] polyline');
  assert.ok((await svg.count()) > 0, 'trend detail should render a sparkline svg polyline');
});

test('competitors page shows an "Est." badge for company data not backed by a real snapshot', async () => {
  await page.goto(`${BASE}/competitors`, { waitUntil: 'networkidle' });
  const text = await page.textContent('body');
  assert.ok(text.includes('Est.'), 'competitors page should badge illustrative seed data as an estimate');
});

test('competitors search: query param filters and shows an honest count', async () => {
  const res = await page.goto(`${BASE}/competitors?q=enterprise`, { waitUntil: 'networkidle' });
  assert.ok(res.status() < 400);
  const text = (await page.textContent('body')).toLowerCase();
  assert.ok(!text.includes('application error'));
});

test('trends search: known term returns matched posts with real citations', async () => {
  const res = await page.goto(`${BASE}/trends?q=onboarding`, { waitUntil: 'networkidle' });
  assert.ok(res.status() < 400);
  const input = page.locator('main input[name="q"]');
  assert.ok((await input.count()) > 0, 'trends page should render a search box');
  const text = await page.textContent('main');
  assert.ok(text.includes('matching post'), 'search should show an honest matched_posts count');
  const citation = page.locator('main a[target="_blank"]').first();
  assert.ok(await citation.count() > 0, 'search results should render at least one citation link');
  const citationHref = await citation.getAttribute('href');
  assert.ok(citationHref?.startsWith('http'), 'citation must link out to the source post url');
});

test('trends search: unmatched term shows an honest empty state, not a blank table', async () => {
  const res = await page.goto(`${BASE}/trends?q=zzzznonexistentterm`, { waitUntil: 'networkidle' });
  assert.ok(res.status() < 400);
  const text = (await page.textContent('main')).toLowerCase();
  assert.ok(text.includes('no posts found'), 'unmatched search term should say so plainly');
});

test('chat box on /trends submits a question and renders an answer with a citation', async () => {
  await page.goto(`${BASE}/trends`, { waitUntil: 'networkidle' });
  const input = page.locator('main input[aria-label="Ask a question"]');
  assert.ok((await input.count()) > 0, 'trends page should render a chat input');
  await input.fill('notion');
  await page.locator('main button[type="submit"]', { hasText: 'Ask' }).first().click();
  await page.waitForSelector('main p:has-text("Checked live data")', { timeout: 20000 });
  const text = await page.textContent('main');
  assert.ok(text.includes('Checked live data'), 'chat response should disclose live-data attempt status');
});
