import { register } from 'node:module';
register('data:text/javascript,' + encodeURIComponent(`
export async function resolve(spec, ctx, next) {
  if (spec === 'three') return next(new URL('../node_modules/three/build/three.module.js', ${JSON.stringify(import.meta.url)}).href, ctx);
  if (spec.startsWith('three/addons/')) return next(new URL('../node_modules/three/examples/jsm/' + spec.slice(13), ${JSON.stringify(import.meta.url)}).href, ctx);
  return next(spec, ctx);
}`));
