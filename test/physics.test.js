// Shape checks: the physics must turn known stitch counts into known shapes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePattern } from '../src/parser.js';
import { buildGraph } from '../src/graph.js';
import { initialPositions } from '../src/layout.js';
import { Solver, measure } from '../src/solver.js';
import { PRESETS } from '../src/presets.js';

function settle(text, pressure = 0) {
  const g = buildGraph(parsePattern(text));
  assert.deepEqual(g.errors, []);
  const s = new Solver(g, initialPositions(g));
  s.setPressure(pressure);
  s.run(4000);
  const dims = measure(s.x, s.n).size.slice().sort((a, b) => b - a);
  return { g, s, dims };
}
const preset = id => PRESETS.find(p => p.id === id).text;

test('flat circle (6 sc increases per round) stays flat', () => {
  const { dims } = settle(preset('coaster'));
  assert.ok(dims[2] / dims[0] < 0.12, `thickness ratio ${dims[2] / dims[0]}`);
  // 48 stitches around -> diameter near 48 / pi
  assert.ok(Math.abs(dims[0] - 48 / Math.PI) < 2.5, `diameter ${dims[0]}`);
});

test('no increases makes a tube with the right width', () => {
  const { dims } = settle('R1: mr, 6 sc\nR2: inc x6\nR3: (sc, inc) x6\nR4-R16: sc around');
  const width = (dims[1] + dims[2]) / 2;
  assert.ok(Math.abs(width - 18 / Math.PI) < 1, `tube width ${width}`);
  assert.ok(dims[0] > 11, `tube height ${dims[0]}`);
});

test('too many increases ruffle out of plane', () => {
  const { dims } = settle(preset('ruffle'));
  assert.ok(dims[2] / dims[0] > 0.2, `ruffle depth ratio ${dims[2] / dims[0]}`);
});

test('stuffing makes the ball rounder', () => {
  const flat = settle(preset('ball'), 0).dims;
  const stuffed = settle(preset('ball'), 1.05).dims;
  assert.ok(stuffed[2] / stuffed[0] > flat[2] / flat[0], 'stuffed ball is rounder than empty ball');
  assert.ok(stuffed[2] / stuffed[0] > 0.85, `stuffed aspect ${stuffed[2] / stuffed[0]}`);
});

test('a swatch in rows is flat and the right size', () => {
  const { dims } = settle(preset('swatch'));
  assert.ok(dims[2] < 0.5, `thickness ${dims[2]}`);
  assert.ok(Math.abs(dims[1] - 9.5) < 1.2 || Math.abs(dims[0] - 9.5) < 1.2, `width ${dims}`);
});
