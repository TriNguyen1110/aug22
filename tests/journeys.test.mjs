/**
 * Realistic end-to-end user journeys, not isolated route checks. Each journey is
 * what an actual person does with this product in one sitting, timed end to end.
 * A journey that's "correct" but takes 8 seconds to click through three pages is
 * still a fail — smooth and fast is part of the bar, not just non-broken.
 *
 * Run with: node --test tests/journeys.test.mjs
 * No auth anywhere in any journey, per CLAUDE.md's hackathon scope.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const BASE = process.env.SMOKE_BASE ?? 'http://localhost:3000';

// Generous for a hackathon demo laptop, tight enough to catch a real regression
// (an accidental blocking loop, an uncached external fetch, an N+1 query).
const BUDGET = {
  page: 2500, // any single page nav, including SSR + hydration
  externalFetch: 4000, // a page that itself makes a live external network call
  journey: 9000, // a full multi-page click-through
};

let browser;
let page;

test.before(async () => {
  browser = await chromium.launch();
  page = await browser.newPage();
});

test.after(async () => {
  await browser.close();
});

async function timed(fn) {
  const start = Date.now();
  await fn();
  return Date.now() - start;
}

test('journey: a market researcher scans trends and checks the source of the top one', async () => {
  const elapsed = await timed(async () => {
    await page.goto(`${BASE}/trends`, { waitUntil: 'networkidle' });
    const topRow = page.locator('table tbody tr').first();
    assert.ok(await topRow.count() > 0, 'trends list should have a top row to click');
    const href = await topRow.locator('a').first().getAttribute('href');
    await page.goto(`${BASE}${href}`, { waitUntil: 'networkidle' });
    const citation = page.locator('main a[target="_blank"]').first();
    assert.ok(await citation.count() > 0, 'trend detail should show a clickable source citation');
    assert.ok((await citation.getAttribute('href'))?.startsWith('http'), 'citation must link to a real source');
  });
  assert.ok(elapsed < BUDGET.journey, `trend-scan journey took ${elapsed}ms, budget is ${BUDGET.journey}ms`);
});

test('journey: a PM checks whether a specific competitor changed price recently', async () => {
  const elapsed = await timed(async () => {
    await page.goto(`${BASE}/competitors`, { waitUntil: 'networkidle' });
    const text = await page.textContent('body');
    assert.ok(text.includes('Linear') && text.includes('Asana'), 'both tracked competitors should be visible without searching');
    const priceLink = page.locator('a[href*="pricing"]').first();
    assert.ok(await priceLink.count() > 0, 'a pricing snapshot should be visible and linked to its real source');
  });
  assert.ok(elapsed < BUDGET.journey, `competitor-check journey took ${elapsed}ms, budget is ${BUDGET.journey}ms`);
});

test('journey: someone monitors how their own last post landed', async () => {
  const elapsed = await timed(async () => {
    await page.goto(`${BASE}/monitoring`, { waitUntil: 'networkidle' });
    const text = (await page.textContent('body')).toLowerCase();
    assert.ok(!text.includes('application error'), 'monitoring must not show an error boundary');
    const citation = page.locator('main a[target="_blank"]').first();
    assert.ok(await citation.count() > 0, 'monitoring should show at least one grounded reaction with a real source link');
  });
  assert.ok(elapsed < BUDGET.page, `monitoring page took ${elapsed}ms, budget is ${BUDGET.page}ms`);
});

test('journey: a skeptical visitor lands on the homepage to see why Bright Data matters', async () => {
  const elapsed = await timed(async () => {
    const res = await page.goto(BASE, { waitUntil: 'networkidle' });
    assert.ok(res.status() < 400);
    const text = await page.textContent('body');
    assert.ok(text.includes('Naive fetch') && text.includes('Bright Data'), 'the naive-vs-Bright-Data comparison must be visible without clicking anything');
  });
  // This page makes a live external network call (the naive comparison fetch), so it
  // gets the wider externalFetch budget, not the plain page budget.
  assert.ok(elapsed < BUDGET.externalFetch, `homepage (with live external fetch) took ${elapsed}ms, budget is ${BUDGET.externalFetch}ms`);
});

test('journey: someone clicks through all three use cases from the homepage in one sitting', async () => {
  const elapsed = await timed(async () => {
    await page.goto(BASE, { waitUntil: 'networkidle' });
    for (const path of ['/trends', '/competitors', '/monitoring']) {
      await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle' });
      const text = (await page.textContent('body')).toLowerCase();
      assert.ok(!text.includes('application error'), `${path} must not error while click-through browsing`);
    }
  });
  assert.ok(elapsed < BUDGET.journey, `full click-through took ${elapsed}ms, budget is ${BUDGET.journey}ms`);
});
