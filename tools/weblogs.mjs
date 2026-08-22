#!/usr/bin/env node
/**
 * Loads routes and reports what the browser complained about: console errors,
 * uncaught exceptions, failed requests, and any response >= 400.
 *
 *   node tools/weblogs.mjs --routes /,/trends
 *
 * Exits 1 if anything was found. A frontend that renders while throwing is the
 * same class of bug as an HTTP 200 with zero records, so it fails loudly.
 */
import { chromium } from 'playwright';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};

const base = arg('url', 'http://localhost:3000');
const routes = arg('routes', '/').split(',').map((r) => r.trim()).filter(Boolean);
const settle = Number(arg('settle', '1500'));

const browser = await chromium.launch();
const ctx = await browser.newContext();
const page = await ctx.newPage();

const found = [];
const note = (kind, detail) => found.push({ route: current, kind, detail });
let current = '';

page.on('console', (msg) => {
  const t = msg.type();
  if (t === 'error' || t === 'warning') note(`console.${t}`, msg.text().slice(0, 300));
});
page.on('pageerror', (err) => note('uncaught', String(err.message).slice(0, 300)));
page.on('requestfailed', (req) =>
  note('request-failed', `${req.method()} ${req.url()} :: ${req.failure()?.errorText ?? 'unknown'}`),
);
page.on('response', (res) => {
  if (res.status() >= 400) note('http-error', `${res.status()} ${res.url()}`);
});

for (const route of routes) {
  current = route;
  const url = new URL(route, base).toString();
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 20000 });
    await page.waitForTimeout(settle);
  } catch (err) {
    note('navigation', err.message.slice(0, 300));
  }
}

await browser.close();

if (!found.length) {
  console.log(`clean: ${routes.length} route(s), no console errors, no failed requests`);
  process.exit(0);
}

const byRoute = found.reduce((acc, f) => ((acc[f.route] ??= []).push(f), acc), {});
for (const [route, items] of Object.entries(byRoute)) {
  console.log(`\n${route}`);
  for (const i of items) console.log(`  [${i.kind}] ${i.detail}`);
}
console.error(`\n${found.length} issue(s) across ${Object.keys(byRoute).length} route(s).`);
process.exit(1);
