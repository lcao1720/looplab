// Physics: position-based dynamics.
// Each step: move every stitch by its velocity (Verlet), add stuffing pressure,
// then pull every edge back toward its rest length several times, and push
// apart stitches that come too close. The fabric settles into the shape where
// all stitch sizes fit together.

export class Solver {
  constructor(graph, positions) {
    this.n = graph.nodes.length;
    this.x = Float32Array.from(positions);
    this.xp = Float32Array.from(positions);
    const m = graph.edges.length;
    this.ea = new Int32Array(m); this.eb = new Int32Array(m);
    this.rest = new Float32Array(m); this.stiff = new Float32Array(m); this.uni = new Uint8Array(m);
    this.connected = new Set();
    graph.edges.forEach((e, i) => {
      this.ea[i] = e.a; this.eb[i] = e.b; this.rest[i] = e.rest; this.stiff[i] = e.stiff; this.uni[i] = e.kind === 'bend' ? 1 : 0;
      this.connected.add(e.a < e.b ? e.a * 1e6 + e.b : e.b * 1e6 + e.a);
    });
    this.faces = Int32Array.from(graph.faces.flat());
    this.force = new Float32Array(this.n * 3);
    this.lambda = new Float32Array(m);
    this.compliance = 0.35;
    this.pressure = 0;      // 0..1 stuffing
    this.damping = 0.85;
    this.iterations = 12;
    this.repelRadius = 0.7;
    this.steps = 0;
    this.quiet = 0;
    this.snapshot = Float32Array.from(positions);
    this.drift = 1;
    this.minSteps = 300;
    this.maxSteps = 4000;
    this.settled = false;
    this.movement = 1;
  }

  setPressure(p) {
    if (p !== this.pressure) { this.pressure = p; this.wake(); }
  }

  wake() { this.settled = false; this.quiet = 0; this.steps = 0; }

  // Settled = the shape changes very little over a window of 50 steps.
  // (Step-to-step movement is a poor test: the constraints keep a tiny
  // back-and-forth even when the shape is final.)
  checkSettled() {
    if (this.steps % 50 !== 0) return;
    const { x, snapshot, n } = this;
    let d = 0;
    for (let v = 0; v < n; v++) {
      const dx = x[v * 3] - snapshot[v * 3], dy = x[v * 3 + 1] - snapshot[v * 3 + 1], dz = x[v * 3 + 2] - snapshot[v * 3 + 2];
      d += Math.sqrt(dx * dx + dy * dy + dz * dz);
    }
    this.drift = d / Math.max(1, n);
    snapshot.set(x);
    if (this.drift < 0.004) this.quiet++; else this.quiet = 0;
    if (this.quiet >= 3 && this.steps >= this.minSteps) this.settled = true;
  }

  volumeSign() {
    const { x, faces } = this;
    let v = 0;
    for (let f = 0; f < faces.length; f += 3) {
      const a = faces[f] * 3, b = faces[f + 1] * 3, c = faces[f + 2] * 3;
      // triple product a . (b x c)
      v += x[a] * (x[b + 1] * x[c + 2] - x[b + 2] * x[c + 1])
         - x[a + 1] * (x[b] * x[c + 2] - x[b + 2] * x[c])
         + x[a + 2] * (x[b] * x[c + 1] - x[b + 1] * x[c]);
    }
    return v >= 0 ? 1 : -1;
  }

  applyPressure() {
    const { x, faces, force } = this;
    force.fill(0);
    if (this.pressure <= 0) return;
    const k = this.pressure * 0.006 * this.volumeSign();
    for (let f = 0; f < faces.length; f += 3) {
      const a = faces[f] * 3, b = faces[f + 1] * 3, c = faces[f + 2] * 3;
      const e1x = x[b] - x[a], e1y = x[b + 1] - x[a + 1], e1z = x[b + 2] - x[a + 2];
      const e2x = x[c] - x[a], e2y = x[c + 1] - x[a + 1], e2z = x[c + 2] - x[a + 2];
      const nx = (e1y * e2z - e1z * e2y) * k, ny = (e1z * e2x - e1x * e2z) * k, nz = (e1x * e2y - e1y * e2x) * k;
      for (const v of [a, b, c]) { force[v] += nx; force[v + 1] += ny; force[v + 2] += nz; }
    }
  }

  // Alternate the sweep direction so the order of edges does not push the
  // whole piece into a slow spin.
  satisfyEdges(backward) {
    const { x, ea, eb, rest, stiff, uni, lambda } = this;
    const alpha = this.compliance;
    const m = ea.length;
    for (let k = 0; k < m; k++) {
      const i = backward ? m - 1 - k : k;
      const a = ea[i] * 3, b = eb[i] * 3;
      const dx = x[b] - x[a], dy = x[b + 1] - x[a + 1], dz = x[b + 2] - x[a + 2];
      const L = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-6;
      // bend links only push apart (they stop folding, they do not pull)
      if (uni[i] && L >= rest[i]) continue;
      let s;
      if (uni[i]) {
        s = (stiff[i] * 0.5 * (L - rest[i])) / L;
      } else {
        // XPBD: yarn links stretch a little under load (stuffing), set by compliance
        const dl = (L - rest[i] + alpha * lambda[i]) / (2 + alpha);
        lambda[i] -= dl;
        s = dl / L;
      }
      x[a] += dx * s; x[a + 1] += dy * s; x[a + 2] += dz * s;
      x[b] -= dx * s; x[b + 1] -= dy * s; x[b + 2] -= dz * s;
    }
  }

  repel() {
    const { x, n, connected } = this;
    const R = this.repelRadius, R2 = R * R, inv = 1 / R;
    const grid = new Map();
    const key = (i, j, k) => ((i * 73856093) ^ (j * 19349663) ^ (k * 83492791));
    for (let v = 0; v < n; v++) {
      const kk = key(Math.floor(x[v * 3] * inv), Math.floor(x[v * 3 + 1] * inv), Math.floor(x[v * 3 + 2] * inv));
      let cell = grid.get(kk);
      if (!cell) grid.set(kk, (cell = []));
      cell.push(v);
    }
    for (let v = 0; v < n; v++) {
      const ci = Math.floor(x[v * 3] * inv), cj = Math.floor(x[v * 3 + 1] * inv), ck = Math.floor(x[v * 3 + 2] * inv);
      for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) for (let dk = -1; dk <= 1; dk++) {
        const cell = grid.get(key(ci + di, cj + dj, ck + dk));
        if (!cell) continue;
        for (const u of cell) {
          if (u <= v) continue;
          const dx = x[u * 3] - x[v * 3], dy = x[u * 3 + 1] - x[v * 3 + 1], dz = x[u * 3 + 2] - x[v * 3 + 2];
          const d2 = dx * dx + dy * dy + dz * dz;
          if (d2 >= R2 || d2 < 1e-12) continue;
          if (connected.has(v < u ? v * 1e6 + u : u * 1e6 + v)) continue;
          const d = Math.sqrt(d2);
          const s = (0.25 * (R - d)) / d;
          x[v * 3] -= dx * s; x[v * 3 + 1] -= dy * s; x[v * 3 + 2] -= dz * s;
          x[u * 3] += dx * s; x[u * 3 + 1] += dy * s; x[u * 3 + 2] += dz * s;
        }
      }
    }
  }

  recenter() {
    const { x, n } = this;
    let cx = 0, cy = 0, cz = 0;
    for (let v = 0; v < n; v++) { cx += x[v * 3]; cy += x[v * 3 + 1]; cz += x[v * 3 + 2]; }
    cx /= n; cy /= n; cz /= n;
    for (let v = 0; v < n; v++) {
      x[v * 3] -= cx; x[v * 3 + 1] -= cy; x[v * 3 + 2] -= cz;
      this.xp[v * 3] -= cx; this.xp[v * 3 + 1] -= cy; this.xp[v * 3 + 2] -= cz;
    }
  }

  // Remove drift: the solver can slowly build up a spin or a slide that is not
  // part of the shape. Take it out so the model sits still when it is done.
  removeRigidMotion() {
    const { x, xp, n } = this;
    let vx = 0, vy = 0, vz = 0;
    for (let v = 0; v < n; v++) { vx += x[v * 3] - xp[v * 3]; vy += x[v * 3 + 1] - xp[v * 3 + 1]; vz += x[v * 3 + 2] - xp[v * 3 + 2]; }
    vx /= n; vy /= n; vz /= n;
    const L = [0, 0, 0];
    const I = [0, 0, 0, 0, 0, 0, 0, 0, 0];
    for (let v = 0; v < n; v++) {
      const rx = x[v * 3], ry = x[v * 3 + 1], rz = x[v * 3 + 2];
      const ux = rx - xp[v * 3] - vx, uy = ry - xp[v * 3 + 1] - vy, uz = rz - xp[v * 3 + 2] - vz;
      L[0] += ry * uz - rz * uy; L[1] += rz * ux - rx * uz; L[2] += rx * uy - ry * ux;
      const r2 = rx * rx + ry * ry + rz * rz;
      I[0] += r2 - rx * rx; I[4] += r2 - ry * ry; I[8] += r2 - rz * rz;
      I[1] -= rx * ry; I[2] -= rx * rz; I[5] -= ry * rz;
    }
    I[3] = I[1]; I[6] = I[2]; I[7] = I[5];
    const w = solve3(I, L);
    for (let v = 0; v < n; v++) {
      const rx = x[v * 3], ry = x[v * 3 + 1], rz = x[v * 3 + 2];
      xp[v * 3] += vx + (w[1] * rz - w[2] * ry);
      xp[v * 3 + 1] += vy + (w[2] * rx - w[0] * rz);
      xp[v * 3 + 2] += vz + (w[0] * ry - w[1] * rx);
    }
  }

  step() {
    const { x, xp, force, n } = this;
    this.applyPressure();
    const damp = this.damping;
    for (let i = 0; i < n * 3; i++) {
      const v = (x[i] - xp[i]) * damp;
      xp[i] = x[i];
      x[i] += v + force[i];
    }
    this.lambda.fill(0);
    for (let it = 0; it < this.iterations; it++) this.satisfyEdges(it % 2 === 1);
    this.repel();
    this.recenter();
    this.removeRigidMotion();
    let move = 0;
    for (let i = 0; i < n * 3; i++) move += Math.abs(x[i] - xp[i]);
    this.movement = move / Math.max(1, n);
    this.steps++;
    this.checkSettled();
    if (this.steps > this.maxSteps) this.settled = true;
    return this.movement;
  }

  run(maxSteps) {
    for (let i = 0; i < maxSteps && !this.settled; i++) this.step();
    return this;
  }
}

function solve3(m, b) {
  const [a, bb, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + bb * B + c * C;
  if (Math.abs(det) < 1e-9) return [0, 0, 0];
  const inv = [
    A, -(bb * i - c * h), bb * f - c * e,
    B, a * i - c * g, -(a * f - c * d),
    C, -(a * h - bb * g), a * e - bb * d,
  ];
  return [
    (inv[0] * b[0] + inv[1] * b[1] + inv[2] * b[2]) / det,
    (inv[3] * b[0] + inv[4] * b[1] + inv[5] * b[2]) / det,
    (inv[6] * b[0] + inv[7] * b[1] + inv[8] * b[2]) / det,
  ];
}

// Measurements of the current shape, in stitch-width units.
export function measure(x, n) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let v = 0; v < n; v++) for (let a = 0; a < 3; a++) {
    min[a] = Math.min(min[a], x[v * 3 + a]); max[a] = Math.max(max[a], x[v * 3 + a]);
  }
  return { size: [max[0] - min[0], max[1] - min[1], max[2] - min[2]], min, max };
}
