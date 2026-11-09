// Initial positions for the physics.
// A good start makes the physics fast and stops it from getting stuck in a
// twisted shape. Rounds start from the "ring model": each round is a ring
// whose size is (stitch count x stitch width) and whose distance from the
// round below is one stitch height. Rows start as a flat sheet.

import { STITCH_HEIGHT, STITCH_WIDTH } from './graph.js';

function rowHeight(graph, meta) {
  let sum = 0, n = 0;
  for (const id of meta.nodes) { sum += STITCH_HEIGHT[graph.nodes[id].type]; n++; }
  return n ? sum / n : STITCH_HEIGHT.sc;
}

function jitter() { return (Math.random() - 0.5) * 0.02; }

export function initialPositions(graph) {
  const n = graph.nodes.length;
  const pos = new Float32Array(n * 3);
  if (graph.mode === 'rounds') layoutRounds(graph, pos);
  else layoutRows(graph, pos);
  // A closing point starts in the middle of the stitches it pulls together.
  graph.nodes.forEach((nd, i) => {
    if (!nd.isCap) return;
    const ring = graph.edges.filter(e => e.b === i).map(e => e.a);
    for (let a = 0; a < 3; a++) pos[i * 3 + a] = ring.reduce((s, id) => s + pos[id * 3 + a], 0) / ring.length;
  });
  // center on origin
  const c = [0, 0, 0];
  for (let i = 0; i < n; i++) for (let a = 0; a < 3; a++) c[a] += pos[i * 3 + a] / n;
  for (let i = 0; i < n; i++) for (let a = 0; a < 3; a++) pos[i * 3 + a] -= c[a];
  return pos;
}

function layoutRounds(graph, pos) {
  const theta = new Float32Array(graph.nodes.length);
  let r = 0, z = 0;
  const w = STITCH_WIDTH;
  if (graph.center >= 0) pos.set([0, 0, 0], graph.center * 3);

  graph.rows.forEach((meta, k) => {
    const cnt = meta.nodes.length;
    if (!cnt) return;
    const h = rowHeight(graph, meta);
    const target = (cnt * w) / (2 * Math.PI);
    let amp = 0;
    if (k === 0) {
      r = target;
      z = Math.sqrt(Math.max(0, h * h - r * r));
    } else {
      const dr = target - r;
      if (dr > h) { r += h; amp = target - r; }
      else if (dr < -h) { r -= h; }
      else { z += Math.sqrt(Math.max(0, h * h - dr * dr)); r = target; }
    }
    const first = graph.nodes[meta.nodes[0]];
    let start = 0;
    if (k > 0) {
      const p = first.parents.find(q => q !== graph.center);
      start = p !== undefined ? theta[p] : (first.prev >= 0 ? theta[first.prev] : 0);
    }
    const A = Math.min(amp, 2.5 * h) * 0.6;
    const waves = Math.max(4, Math.round(cnt / 4));
    meta.nodes.forEach((id, j) => {
      const th = start + (2 * Math.PI * j) / cnt;
      theta[id] = th;
      const R = Math.max(0.05, r + A * Math.sin(waves * th));
      const y = z + A * 0.6 * Math.cos(waves * th);
      pos[id * 3] = R * Math.cos(th) + jitter();
      pos[id * 3 + 1] = y + jitter();
      pos[id * 3 + 2] = R * Math.sin(th) + jitter();
    });
  });
}

function layoutRows(graph, pos) {
  const x = new Float32Array(graph.nodes.length);
  let y = 0;
  let dir = 1;
  graph.rows.forEach((meta, k) => {
    const cnt = meta.nodes.length;
    if (!cnt) return;
    const h = k === 0 ? 0 : rowHeight(graph, meta);
    y += h;
    if (k > 0) dir = -dir;
    const grows = k > 0 && meta.available > 0 && cnt > meta.available * 1.2;
    meta.nodes.forEach((id, j) => {
      const node = graph.nodes[id];
      let xi;
      if (k === 0) xi = j * STITCH_WIDTH;
      else if (node.parents.length) xi = node.parents.reduce((s, p) => s + x[p], 0) / node.parents.length;
      else xi = j > 0 ? x[meta.nodes[j - 1]] + dir : 0;
      if (j > 0) {
        const px = x[meta.nodes[j - 1]];
        if ((xi - px) * dir < 0.5) xi = px + 0.5 * dir;
      }
      x[id] = xi;
      pos[id * 3] = xi + jitter();
      pos[id * 3 + 1] = y + jitter();
      pos[id * 3 + 2] = (grows ? 0.4 * Math.sin(j * 1.3) : 0) + jitter();
    });
  });
}
