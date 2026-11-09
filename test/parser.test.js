import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePattern, splitTopLevel } from '../src/parser.js';
import { buildGraph } from '../src/graph.js';

const counts = (text) => {
  const g = buildGraph(parsePattern(text));
  assert.deepEqual(g.errors, [], JSON.stringify(g.errors));
  return g.rows.map(r => r.made);
};

test('splitTopLevel keeps brackets together', () => {
  assert.deepEqual(splitTopLevel('sc, (sc, inc) x6, dec'), ['sc', '(sc, inc) x6', 'dec']);
});

test('standard amigurumi ball counts', () => {
  const text = `
    R1: mr, 6 sc (6)
    R2: inc x6 (12)
    R3: (sc, inc) x6 (18)
    R4-R6: sc around (18)
    R7: (sc, dec) x6 (12)
    R8: dec x6 (6)
  `;
  assert.deepEqual(counts(text), [6, 12, 18, 18, 18, 18, 12, 6]);
});

test('many ways to write the same stitches', () => {
  const variants = [
    'R1: 6 sc in mr\nR2: 2 sc in each st around\nR3: *sc, inc* 6 times',
    'Rnd 1: magic ring, sc x6\nRnd 2: inc around\nRnd 3: [sc, inc] x 6',
    'Round 1: mr 6sc\nRound 2: inc 6 times\nRound 3: (1 sc, 1 inc) x6',
    '1: mr, 6 sc\n2: 6 inc\n3: (sc in next st, 2 sc in next st) x6',
  ];
  for (const v of variants) assert.deepEqual(counts(v), [6, 12, 18], v);
});

test('decrease spellings', () => {
  for (const d of ['dec', 'invdec', 'sc2tog', 'sc 2tog', 'decrease']) {
    assert.deepEqual(counts(`R1: mr, 6 sc\nR2: inc x6\nR3: ${d} x6`), [6, 12, 6], d);
  }
});

test('partial repeat around stops when stitches run out', () => {
  // 27 stitches, (sc, inc) around = 13 full repeats + 1 sc = 40
  assert.deepEqual(
    counts('R1: mr, 6 sc\nR2: inc x6\nR3: (sc, inc) x6\nR4: (sc, inc) x9\nR5: (sc, inc) around').slice(3),
    [27, 40]
  );
});

test('other stitch heights', () => {
  assert.deepEqual(counts('R1: mr, 8 hdc\nR2: hdc inc x8\nR3: (hdc, 2 hdc in next) x8'), [8, 16, 24]);
  assert.deepEqual(counts('R1: mr, 12 dc\nR2: 2 dc in each st around'), [12, 24]);
});

test('UK terms map to US stitches', () => {
  const g = buildGraph(parsePattern('terms: uk\nR1: mr, 6 dc\nR2: 2 dc in each st around'));
  assert.deepEqual(g.errors, []);
  assert.equal(g.nodes.find(n => !n.isCenter).type, 'sc');
});

test('flat rows with a foundation chain and turning chains', () => {
  const g = buildGraph(parsePattern('ch 11\nRow 1: sk 1, sc x10, turn\nRow 2-4: ch 1, sc across, turn'));
  assert.deepEqual(g.errors, []);
  assert.equal(g.mode, 'rows');
  assert.deepEqual(g.rows.map(r => r.made), [11, 10, 10, 10, 10]);
  assert.equal(g.warnings.length, 0, JSON.stringify(g.warnings));
});

test('declared count mismatch gives a warning', () => {
  const g = buildGraph(parsePattern('R1: mr, 6 sc\nR2: inc x6 (14)'));
  assert.equal(g.errors.length, 0);
  assert.match(g.warnings[0].msg, /You wrote \(14\)/);
});

test('unworked stitches give a warning', () => {
  const g = buildGraph(parsePattern('R1: mr, 6 sc\nR2: inc x6\nR3: sc x10'));
  assert.match(g.warnings[0].msg, /10 of 12/);
});

test('unknown stitch is a clear error with line number', () => {
  const g = buildGraph(parsePattern('R1: mr, 6 sc\nR2: bobble x6'));
  assert.equal(g.errors[0].line, 2);
  assert.match(g.errors[0].msg, /bobble/);
});

test('pattern must start with ring or chain', () => {
  const g = buildGraph(parsePattern('R1: sc x6'));
  assert.match(g.errors[0].msg, /magic ring/);
});

test('rows mode overrun is an error', () => {
  const g = buildGraph(parsePattern('ch 5\nRow 1: sc x8'));
  assert.match(g.errors[0].msg, /more stitches/);
});

test('color changes apply to later stitches', () => {
  const g = buildGraph(parsePattern('color: white\nR1: mr, 6 sc\ncolor: red\nR2: inc x6'));
  const r2 = g.rows[1].nodes.map(i => g.nodes[i].color);
  assert.ok(r2.every(c => c === 'red'));
  assert.equal(g.nodes[g.rows[0].nodes[0]].color, 'white');
});

test('graph shape: every non-ring stitch in round 2+ has a parent, faces exist', () => {
  const g = buildGraph(parsePattern('R1: mr, 6 sc\nR2: inc x6\nR3: (sc, dec) x4'));
  for (const id of g.rows[1].nodes) assert.ok(g.nodes[id].parents.length >= 1);
  assert.ok(g.faces.length > 20);
  for (const f of g.faces) assert.equal(new Set(f).size, 3);
});

test('closing the last round adds a closing point, not a new round', () => {
  const g = buildGraph(parsePattern('R1: mr, 6 sc\nR2: inc x6\nR3: dec x6\nFO, close the hole'));
  assert.deepEqual(g.errors, []);
  assert.equal(g.rows.length, 3);
  assert.equal(g.nodes.filter(n => n.isCap).length, 1);
  assert.equal(g.warnings.length, 0);
});

test('sc in 2nd ch from hook skips one chain', () => {
  const g = buildGraph(parsePattern('ch 11\nRow 1: sc in 2nd ch from hook, sc x9'));
  assert.deepEqual(g.errors, []);
  assert.equal(g.rows[1].made, 10);
  assert.equal(g.warnings.length, 0);
});
