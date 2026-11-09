// Build two pages from app.html:
//   index.html        - for GitHub Pages and local use; loads src/*.js as modules
//   dist/looplab.html - one self-contained page (app code inlined), three.js from the CDN
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { build } from 'esbuild';

const app = readFileSync('app.html', 'utf8');
const split = app.indexOf('<div class="app">');
const head = app.slice(0, split).trim();
const body = app.slice(split).trim();

const index = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
${head}
</head>
<body>
${body.replace('<!--APP_SCRIPT-->', '<script type="module" src="./src/main.js"></script>')}
</body>
</html>
`;
writeFileSync('index.html', index);

const result = await build({
  entryPoints: ['src/main.js'],
  bundle: true,
  format: 'esm',
  minify: true,
  write: false,
  external: ['three', 'three/addons/*'],
  target: 'es2020',
  legalComments: 'none',
});
const js = result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
mkdirSync('dist', { recursive: true });
writeFileSync('dist/looplab.html', app.replace('<!--APP_SCRIPT-->', () => `<script type="module">\n${js}</script>`));
console.log('index.html and dist/looplab.html written,', Math.round(js.length / 1024), 'KB of app code');
