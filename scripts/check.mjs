// Headless check: load a page in Chrome, run each preset until it settles, save screenshots.
// Usage: node scripts/check.mjs <page.html> <outdir> [dark]
import { chromium } from 'playwright-core';
import { readFileSync, mkdirSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, resolve } from 'node:path';

const [page_, outDir, theme] = process.argv.slice(2);
const root = resolve('.');
mkdirSync(outDir, { recursive: true });
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const server = createServer((req, res) => {
  try {
    const p = join(root, decodeURIComponent(req.url.split('?')[0]));
    res.writeHead(200, { 'content-type': types[extname(p)] || 'application/octet-stream' });
    res.end(readFileSync(p));
  } catch { res.writeHead(404); res.end(); }
}).listen(0);
const port = server.address().port;

const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, colorScheme: theme === 'dark' ? 'dark' : 'light' });
const page = await ctx.newPage();
const logs = [];
page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`${m.type()}: ${m.text()}`); });
page.on('pageerror', e => logs.push('pageerror: ' + e.message));
await page.route('https://cdn.jsdelivr.net/npm/three@0.169.0/**', async route => {
  const rel = route.request().url().split('three@0.169.0/')[1];
  await route.fulfill({ body: readFileSync(join(root, 'node_modules/three', rel)), contentType: 'text/javascript' });
});
await page.route('https://fonts.googleapis.com/**', r => r.fulfill({ body: '', contentType: 'text/css' }));
await page.route('https://fonts.gstatic.com/**', r => r.abort());
await page.addInitScript(() => { try { localStorage.clear(); } catch {} });
await page.goto(`http://localhost:${port}/${page_}`);
await page.waitForFunction(() => window.looplab && window.looplab.solver, null, { timeout: 15000 });

const ids = await page.evaluate(() => window.looplab.PRESETS.map(p => p.id));
for (const id of ids) {
  await page.evaluate((id) => window.looplab.loadPreset(window.looplab.PRESETS.find(p => p.id === id)), id);
  await page.waitForFunction(() => window.looplab.solver.settled, null, { timeout: 60000 }).catch(() => logs.push(id + ': did not settle in 60s'));
  await page.waitForTimeout(400);
  const info = await page.evaluate(() => ({ steps: window.looplab.solver.steps, size: document.getElementById('size').textContent, counts: document.getElementById('counts').textContent, msgs: document.getElementById('messages').innerText }));
  console.log(id, JSON.stringify(info));
  await page.screenshot({ path: `${outDir}/${id}.png` });
}
await page.setViewportSize({ width: 400, height: 860 });
await page.evaluate(() => window.looplab.loadPreset(window.looplab.PRESETS[0]));
await page.waitForTimeout(2500);
await page.screenshot({ path: `${outDir}/phone.png`, fullPage: true });
const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
console.log('phone horizontal overflow:', overflow);
console.log(logs.length ? logs.join('\n') : 'no console errors');
await browser.close();
server.close();
