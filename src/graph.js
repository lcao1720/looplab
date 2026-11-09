// Stitch graph builder.
//
// A crochet piece is a graph:
//   node  = one stitch (its top loops)
//   edge  = "prev"   : the stitch made just before it (yarn runs along the row)
//           "parent" : the stitch it is worked into (one row below)
//           "bend"   : soft second-neighbour links that resist folding
// Faces (triangles) fill the space between a row and the row below. They are
// used for drawing the surface and for the stuffing pressure.

export const STITCH_WIDTH = 1.0;
export const STITCH_HEIGHT = { sc: 0.95, hdc: 1.25, dc: 1.9, tr: 2.5, slst: 0.4, ch: 0.9, ring: 0 };
export const DEFAULT_COLOR = '#e9a6b8';

const STOP = Symbol('stop');

export function detectMode(rows) {
  if (!rows.length) return null;
  const first = rows[0].items;
  const flat = flatten(first);
  if (flat.some(i => i.k === 'mr')) return 'rounds';
  const real = flat.filter(i => i.k !== 'color');
  if (real.length && real.every(i => i.k === 'ch')) return 'rows';
  return null;
}

function flatten(items) {
  const out = [];
  for (const it of items) {
    if (it.k === 'group' || it.k === 'fill') out.push(...flatten(it.items));
    else out.push(it);
  }
  return out;
}

// Remove turning chains in row mode: chains before "turn", at the end of a row,
// or at the start of a row (before the first real stitch).
function stripTurningChains(items) {
  const out = items.slice();
  let removed = false;
  const isCh = i => i && i.k === 'ch';
  // leading
  while (out.length && (isCh(out[0]) || out[0].k === 'color' && isCh(out[1]))) {
    if (isCh(out[0])) { out.shift(); removed = true; } else { const c = out.shift(); out.shift(); out.unshift(c); removed = true; }
  }
  // trailing (ignoring turn / fo markers)
  let j = out.length - 1;
  while (j >= 0 && (out[j].k === 'turn' || out[j].k === 'fo')) j--;
  if (j >= 0 && isCh(out[j])) { out.splice(j, 1); removed = true; }
  return { items: out, removed };
}

export function buildGraph(parsed, opts = {}) {
  const nodes = [];
  const edges = [];
  const faces = [];
  const rows = [];
  const warnings = [];
  const errors = parsed.errors ? parsed.errors.map(e => ({ ...e })) : [];
  const edgeKeys = new Set();
  const notes = [];

  const mode = detectMode(parsed.rows);
  if (!parsed.rows.length) {
    return { mode, nodes, edges, faces, rows, warnings, errors, notes, center: -1 };
  }
  if (!mode) {
    errors.push({ line: parsed.rows[0].line, msg: 'Start with a magic ring (for example "R1: mr, 6 sc") or a foundation chain (for example "ch 11").' });
    return { mode, nodes, edges, faces, rows, warnings, errors, notes, center: -1 };
  }

  let color = opts.color || DEFAULT_COLOR;
  let center = -1;
  let prev = -1;           // last stitch made
  let lastParent = -1;     // last parent used (for "in same st")
  const work = [];         // rounds mode: every stitch in the order made
  let cursor = 0;          // rounds mode: next stitch to work into
  let pool = [];           // rows mode: stitches of the row below, in working order
  let pc = 0;
  let prevRowNodes = [];
  let turnedNotice = false;

  function addEdge(a, b, rest, stiff, kind) {
    if (a === b) return;
    const key = a < b ? a * 1e6 + b : b * 1e6 + a;
    if (edgeKeys.has(key)) return;
    edgeKeys.add(key);
    edges.push({ a, b, rest, stiff, kind });
  }

  function addTri(a, b, c, flip) {
    if (a === b || b === c || a === c) return;
    faces.push(flip ? [a, c, b] : [a, b, c]);
  }

  parsed.rows.forEach((row, r) => {
    const meta = {
      label: row.label ?? (mode === 'rows' && r === 0 ? 'Ch' : String(r + 1)), line: row.line, src: row.src,
      made: 0, consumed: 0, available: 0, declared: row.declared, nodes: [], issues: [], ok: true,
    };
    rows.push(meta);
    let items = row.items;
    let ringActive = false;
    let stop = false;
    const flip = mode === 'rows' && r % 2 === 0;
    let rowStartWork = work.length;

    if (mode === 'rows') {
      if (r === 0) {
        const real = flatten(items).filter(i => i.k !== 'color');
        if (!real.every(i => i.k === 'ch')) {
          errors.push({ line: row.line, msg: 'The foundation row can only contain chains.' });
          meta.ok = false; return;
        }
      } else {
        const s = stripTurningChains(items);
        items = s.items;
        if (s.removed && !turnedNotice) {
          notes.push('Turning chains are not drawn. Each row starts in the first stitch.');
          turnedNotice = true;
        }
      }
      pool = prevRowNodes.slice().reverse();
      pc = 0;
      meta.available = pool.length;
    } else {
      meta.available = r === 0 ? 0 : work.length - cursor;
      rowStartWork = work.length;
    }

    const remaining = () => (mode === 'rows' ? pool.length - pc : rowStartWork - cursor);

    function takeParent(inFill) {
      if (mode === 'rows') {
        if (pc >= pool.length) return -1;
        return pool[pc++];
      }
      if (inFill && cursor >= rowStartWork) return -1;
      if (cursor >= work.length) return -1;
      return work[cursor++];
    }

    function makeStitch(type, parents) {
      const id = nodes.length;
      nodes.push({ row: r, type, color, parents });
      const h = STITCH_HEIGHT[type];
      for (const p of parents) addEdge(id, p, p === center ? Math.max(h, 0.6) : h, 1, 'parent');
      const turnBoundary = mode === 'rows' && meta.made === 0 && r > 0;
      if (prev >= 0 && !parents.includes(prev)) {
        const rest = turnBoundary ? h : STITCH_WIDTH;
        addEdge(id, prev, rest, 1, turnBoundary ? 'turn' : 'prev');
      }
      // bending: skip-one along the row
      if (prev >= 0 && !turnBoundary) {
        const pp = nodes[prev].prev;
        const sameRun = pp >= 0 && (mode === 'rounds' || (nodes[pp].row === r && nodes[prev].row === r));
        if (sameRun) addEdge(id, pp, 2 * STITCH_WIDTH * 0.95, 0.2, 'bend');
      }
      // bending: up-down through a single parent and its single parent
      if (parents.length === 1 && parents[0] !== center) {
        const p = nodes[parents[0]];
        if (p.parents.length === 1 && p.parents[0] !== center) {
          addEdge(id, p.parents[0], (h + STITCH_HEIGHT[p.type]) * 0.9, 0.15, 'bend');
        }
      }
      // faces between this stitch, the one before it and the row below
      if (prev >= 0 && !turnBoundary && parents.length) {
        const A = parents[0];
        const bp = nodes[prev].parents;
        if (bp.length) {
          const B = bp[bp.length - 1];
          if (A === B) addTri(A, id, prev, flip);
          else { addTri(B, A, id, flip); addTri(B, id, prev, flip); }
        }
      }
      for (let t = 0; t + 1 < parents.length; t++) addTri(parents[t], parents[t + 1], id, flip);

      nodes[id].prev = prev;
      if (mode === 'rounds' && type !== 'ring') work.push(id);
      prev = id;
      meta.nodes.push(id);
      meta.made++;
      return id;
    }

    function exec(it, inFill) {
      if (stop) return STOP;
      switch (it.k) {
        case 'color': color = it.value; return;
        case 'turn': case 'fo': return;
        case 'close': {
          // Pull the last round closed: one hidden point that every stitch of
          // this round is drawn tight to (like weaving the tail through and pulling).
          const ring = meta.nodes.length ? meta.nodes : (rows[r - 1] ? rows[r - 1].nodes : []);
          if (ring.length < 3) return fail('There is no open round to close.');
          const cap = nodes.length;
          nodes.push({ row: nodes[ring[ring.length - 1]].row, type: 'ring', color: nodes[ring[ring.length - 1]].color, parents: [], prev: -1, isCap: true });
          for (const id of ring) addEdge(id, cap, 0.35, 1, 'parent');
          for (let j = 0; j < ring.length; j++) addTri(ring[j], ring[(j + 1) % ring.length], cap, flip);
          return;
        }
        case 'mr': {
          if (mode !== 'rounds' || r !== 0) {
            errors.push({ line: row.line, msg: 'A magic ring can only start round 1.' });
            stop = true; return STOP;
          }
          if (center < 0) {
            center = nodes.length;
            nodes.push({ row: r, type: 'ring', color, parents: [], prev: -1, isCenter: true });
          }
          ringActive = true;
          return;
        }
        case 'ch': {
          for (let i = 0; i < it.n; i++) makeStitch('ch', []);
          return;
        }
        case 'sk': {
          for (let i = 0; i < it.n; i++) {
            const q = takeParent(inFill);
            if (q < 0) { if (inFill) return STOP; return fail('There is no stitch left to skip.'); }
            meta.consumed++;
          }
          return;
        }
        case 'st': {
          if (ringActive) { lastParent = center; makeStitch(it.type, [center]); return; }
          if (it.same) {
            if (lastParent < 0) return fail('There is no stitch to work into yet.');
            makeStitch(it.type, [lastParent]);
            return;
          }
          const parents = [];
          for (let t = 0; t < it.take; t++) {
            const q = takeParent(inFill);
            if (q < 0) {
              if (inFill && t === 0) return STOP;
              return fail(mode === 'rows'
                ? `Row ${meta.label} needs more stitches than the row below has.`
                : `Round ${meta.label} needs a stitch that is not made yet.`);
            }
            parents.push(q);
          }
          meta.consumed += parents.length;
          lastParent = parents[parents.length - 1];
          makeStitch(it.type, parents);
          return;
        }
        case 'group': {
          for (let i = 0; i < it.times; i++) {
            for (const sub of it.items) if (exec(sub, inFill) === STOP) return STOP;
          }
          return;
        }
        case 'fill': {
          if (ringActive) return fail('"Around" needs a round below it. In round 1, give a number, for example "6 sc".');
          let guard = 0;
          while (remaining() > 0 && guard++ < 2000) {
            const before = meta.consumed;
            let stopped = false;
            for (const sub of it.items) {
              if (remaining() <= 0 && sub.k === 'st' && !sub.same) { stopped = true; break; }
              if (exec(sub, true) === STOP) { stopped = true; break; }
            }
            if (stop) return STOP;
            if (meta.consumed === before) return fail('This repeat never works into a stitch, so it cannot go "around".');
            if (stopped) break;
          }
          return;
        }
      }
    }

    function fail(msg) {
      errors.push({ line: row.line, msg });
      meta.ok = false;
      stop = true;
      return STOP;
    }

    for (const it of items) if (exec(it, false) === STOP) break;

    // Row checks
    if (meta.ok && r > 0) {
      if (meta.consumed < meta.available) {
        const left = meta.available - meta.consumed;
        meta.issues.push(mode === 'rows'
          ? `${left} stitch${left > 1 ? 'es' : ''} at the end of the row below stay unworked.`
          : `Works into ${meta.consumed} of ${meta.available} stitches. The next round starts ${left} stitch${left > 1 ? 'es' : ''} early.`);
      } else if (mode === 'rounds' && meta.consumed > meta.available) {
        meta.issues.push(`Works into ${meta.consumed} stitches, but only ${meta.available} are ready. It continues into its own stitches.`);
      }
    }
    if (meta.ok && meta.declared != null && meta.declared !== meta.made) {
      meta.issues.push(`You wrote (${meta.declared}). The instructions make ${meta.made}.`);
    }
    if (meta.ok && meta.made === 0 && !(mode === 'rows' && r === 0)) {
      meta.issues.push('This row makes no stitches.');
    }
    for (const msg of meta.issues) warnings.push({ line: row.line, msg: `${mode === 'rows' ? 'Row' : 'Round'} ${meta.label}: ${msg}` });
    prevRowNodes = meta.nodes;
  });

  // Stitches in an increase fan out from one stitch, and a decrease pulls two
  // stitches together. Those stitches lean sideways by about half a stitch, so
  // their link to the row below is a little longer than the stitch height.
  // Without this, a flat circle (6 sc increases per round) comes out ruffled.
  const children = new Int32Array(nodes.length);
  for (const nd of nodes) for (const p of nd.parents) children[p]++;
  for (const e of edges) {
    if (e.kind !== 'parent' || e.b === center) continue;
    const child = nodes[e.a];
    const spread = Math.max(children[e.b], child.parents.length);
    if (spread > 1) {
      const d = Math.min(1, 0.5 * (spread - 1)) * STITCH_WIDTH;
      const h = STITCH_HEIGHT[child.type];
      e.rest = Math.sqrt(h * h + d * d);
    }
  }

  return { mode, nodes, edges, faces, rows, warnings, errors, notes, center };
}
