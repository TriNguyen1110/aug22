#!/usr/bin/env node
/**
 * Screenshots routes at one or more viewports so an agent can see the page.
 *
 *   node tools/screenshot.mjs --routes / ,/trends --viewports 1280x800,390x844
 *
 * Writes to .screenshots/ and prints the paths. Non-zero exit if a route
 * failed to load, because a missing screenshot must not read as a pass.
 */
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};

const base = arg('url', 'http://localhost:3000');
const routes = arg('routes', '/').split(',').map((r) => r.trim()).filter(Boolean);
const viewports = arg('viewports', '1280x800,390x844')
  .split(',')
  .map((v) => {
    const [width, height] = v.trim().split('x').map(Number);
    return { width, height, label: v.trim() };
  });
const outDir = arg('out', '.screenshots');

await mkdir(outDir, { recursive: true });
const browser = await chromium.launch();
const failures = [];

for (const vp of viewports) {
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
  const page = await ctx.newPage();
  for (const route of routes) {
    const url = new URL(route, base).toString();
    const slug = route.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'root';
    const path = `${outDir}/${slug}@${vp.label}.png`;
    try {
      const res = await page.goto(url, { waitUntil: 'networkidle', timeout: 20000 });
      if (res && res.status() >= 400) throw new Error(`HTTP ${res.status()}`);
      await page.screenshot({ path, fullPage: true });
      console.log(`ok    ${path}`);
    } catch (err) {
      failures.push(`${url} @ ${vp.label}: ${err.message}`);
      console.log(`FAIL  ${url} @ ${vp.label}: ${err.message}`);
    }
  }
  await ctx.close();
}

await browser.close();

if (failures.length) {
  console.error(`\n${failures.length} route(s) failed to render.`);
  process.exit(1);
}
console.log(`\n${routes.length * viewports.length} screenshot(s) in ${outDir}/`);
