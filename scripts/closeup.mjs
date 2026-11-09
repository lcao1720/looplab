// Close-up screenshots of examples, to judge the yarn look.
// Usage: node scripts/closeup.mjs <outdir> <presetId> [zoom]
import { chromium } from 'playwright-core';
import { readFileSync, mkdirSync } from 'node:fs';
import { createServer } from 'node:http';
import { join, extname } from 'node:path';

const [outDir, id = 'ball', zoom = '2.2'] = process.argv.slice(2);
const root = process.cwd();
mkdirSync(outDir, { recursive: true });
const server = createServer((req, res) => {
  try { const p = join(root, req.url.split('?')[0]); res.writeHead(200, { 'content-type': extname(p) === '.js' ? 'text/javascript' : 'text/html' }); res.end(readFileSync(p)); }
  catch { res.writeHead(404); res.end(); }
}).listen(0);
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1100, height: 760 } });
const logs = []; page.on('pageerror', e => logs.push(e.message));
await page.route('https://cdn.jsdelivr.net/npm/three@0.169.0/**', r => r.fulfill({ body: readFileSync(join(root, 'node_modules/three', r.request().url().split('three@0.169.0/')[1])), contentType: 'text/javascript' }));
await page.route('https://fonts.**/**', r => r.abort());
await page.goto(`http://localhost:${server.address().port}/dist/looplab.html#${id}`);
await page.waitForFunction(() => window.looplab && window.looplab.solver);
// Finish the physics in one go (the software renderer here is slow).
await page.evaluate(() => { const s = window.looplab.solver; s.run(6000); window.looplab.view.update(); });
await page.evaluate((z) => {
  const v = window.looplab.view;
  v.fit();
  const t = v.controls.target, c = v.camera.position;
  c.sub(t).multiplyScalar(1 / z).add(t);
  v.controls.update();
}, +zoom);
await page.waitForTimeout(600);
const box = await page.locator('#stage-canvas').boundingBox();
await page.screenshot({ path: `${outDir}/${id}-close.png`, clip: box });
console.log(id, logs.join(' | ') || 'ok');
await browser.close(); server.close();
