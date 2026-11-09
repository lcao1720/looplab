// Yarn layer: draws every stitch as real yarn on top of the fabric surface.
//
// One small stitch model is built once and repeated for every stitch with an
// InstancedMesh. Each copy is placed in the stitch's own frame:
//   x = along the round (stitch width)
//   y = from the stitch it is worked into (base) up to its top loops
//   z = out of the fabric (right side)
// The front of the stitch is a "V" of two yarn legs. The back has a bar, the
// way the wrong side of crochet fabric looks. Tall stitches (hdc, dc, tr) also
// get the diagonal "yarn over" wraps across their posts.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const RADIUS = 0.165;       // yarn radius, in stitch widths
export const SHELL = 0.19;  // half the fabric thickness: more than RADIUS, so strand ends stay inside
const WRAPS = { hdc: [0.5], dc: [0.4], tr: [0.3, 0.58] };

// Twisted-ply bump texture. Tube UVs run u = along the yarn, v = around it,
// so diagonal stripes look like the twist of a plied yarn.
function plyTexture() {
  const W = 128, H = 32;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(W, H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const u = x / W, v = y / H;
    const ply = 0.5 + 0.5 * Math.sin(2 * Math.PI * (4 * u + 2 * v));
    const fuzz = 0.12 * Math.sin(2 * Math.PI * (23 * u + 7 * v)) * Math.sin(2 * Math.PI * 5 * v);
    const g = Math.max(0, Math.min(255, Math.round(255 * (0.15 + 0.75 * ply * ply + fuzz))));
    const i = (y * W + x) * 4;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = g; img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

// A tube along a smooth curve, with a baked shade (darker where the yarn dips
// into the fabric) so stitches read as separate bumps.
function tube(points, segs, radial, shade) {
  const curve = new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p)));
  const g = new THREE.TubeGeometry(curve, segs, RADIUS, radial, false);
  const pos = g.getAttribute('position');
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const s = shade(pos.getX(i), pos.getY(i), pos.getZ(i));
    col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = s;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

const legShade = (x, y, z) => 0.6 + 0.4 * Math.min(1, Math.max(0, y / 0.45)) * Math.min(1, Math.max(0.2, 0.15 + z * 2.4));
// Back bars overlap their neighbours, so the wrong side reads as ridges.
function backBar(segs, radial) {
  return tube([[-0.62, 0.93, 0], [-0.25, 0.86, -0.27], [0.25, 0.86, -0.27], [0.62, 0.93, 0]], segs, radial,
    (x) => 0.72 + 0.28 * (1 - Math.abs(x) * 1.2));
}

// Short stitches (sc, hdc, sl st, chain): a "V".
// Every strand ends at z = 0, the middle of the fabric. The fabric is drawn as
// two layers (front at +SHELL, back at -SHELL), so strand ends stay hidden
// between them and only the bumps show.
function vGeometry(detail) {
  const segs = detail ? 10 : 6, radial = detail ? 7 : 5;
  const left = tube([[-0.05, -0.02, 0], [-0.17, 0.3, 0.29], [-0.31, 0.7, 0.3], [-0.45, 1.02, 0]], segs, radial, legShade);
  const right = tube([[0.05, -0.02, 0], [0.17, 0.3, 0.29], [0.31, 0.7, 0.3], [0.45, 1.02, 0]], segs, radial, legShade);
  return mergeGeometries([left, right, backBar(segs, radial)]);
}

// Tall stitches (dc, tr): two strands run up close together as a post, then
// open into the top "V".
function postGeometry(detail) {
  const segs = detail ? 14 : 8, radial = detail ? 7 : 5;
  const leg = (sx) => tube([[sx * 0.05, -0.02, 0], [sx * 0.1, 0.18, 0.26], [sx * 0.12, 0.5, 0.29], [sx * 0.2, 0.76, 0.3], [sx * 0.45, 1.02, 0]], segs, radial, legShade);
  return mergeGeometries([leg(-1), leg(1), backBar(segs, radial)]);
}

// The diagonal "yarn over" strand across the post of hdc, dc and tr.
function wrapGeometry(detail) {
  const segs = detail ? 8 : 5, radial = detail ? 7 : 5;
  return tube([[-0.34, -0.11, 0], [-0.12, -0.04, 0.43], [0.12, 0.04, 0.43], [0.34, 0.11, 0]], segs, radial,
    (x) => 0.66 + 0.34 * (1 - Math.abs(x) * 2));
}

const TALL = new Set(['dc', 'tr']);

export class YarnLayer {
  constructor(graph, material) {
    this.graph = graph;
    this.group = new THREE.Group();
    const detail = graph.nodes.length < 2500;

    // which nodes get a stitch, which shape, and how many wraps
    this.ids = [];
    this.kind = [];          // 0 = V, 1 = post
    this.slot = [];          // index inside its own InstancedMesh
    this.wrapOf = [];
    let nv = 0, np = 0;
    graph.nodes.forEach((nd, i) => {
      if (nd.type === 'ring') return;
      const tall = TALL.has(nd.type);
      this.ids.push(i);
      this.kind.push(tall ? 1 : 0);
      this.slot.push(tall ? np++ : nv++);
      for (const t of WRAPS[nd.type] || []) this.wrapOf.push([this.ids.length - 1, t]);
    });

    this.vs = new THREE.InstancedMesh(vGeometry(detail), material, Math.max(1, nv));
    this.posts = new THREE.InstancedMesh(postGeometry(detail), material, Math.max(1, np));
    this.wraps = new THREE.InstancedMesh(wrapGeometry(detail), material, Math.max(1, this.wrapOf.length));
    this.vs.count = nv;
    this.posts.count = np;
    this.wraps.count = this.wrapOf.length;
    this.meshes = [this.vs, this.posts, this.wraps];
    for (const m of this.meshes) {
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.frustumCulled = false;
      m.setColorAt(0, new THREE.Color(1, 1, 1));
    }
    this.group.add(this.vs, this.posts, this.wraps);
    this.frames = new Float32Array(this.ids.length * 16);
    this.side = 1;
  }

  // Signed volume tells which side of the surface is the outside. Flat pieces
  // have almost no volume, so the last answer is kept for them.
  updateSide(x, faces) {
    let v = 0, n = x.length / 3;
    let cx = 0, cy = 0, cz = 0;
    for (let i = 0; i < n; i++) { cx += x[i * 3]; cy += x[i * 3 + 1]; cz += x[i * 3 + 2]; }
    cx /= n; cy /= n; cz /= n;
    let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < n; i++) for (let a = 0; a < 3; a++) { lo[a] = Math.min(lo[a], x[i * 3 + a]); hi[a] = Math.max(hi[a], x[i * 3 + a]); }
    for (let f = 0; f < faces.length; f += 3) {
      const a = faces[f] * 3, b = faces[f + 1] * 3, c = faces[f + 2] * 3;
      const ax = x[a] - cx, ay = x[a + 1] - cy, az = x[a + 2] - cz;
      const bx = x[b] - cx, by = x[b + 1] - cy, bz = x[b + 2] - cz;
      const qx = x[c] - cx, qy = x[c + 1] - cy, qz = x[c + 2] - cz;
      v += ax * (by * qz - bz * qy) - ay * (bx * qz - bz * qx) + az * (bx * qy - by * qx);
    }
    const d = Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) || 1;
    if (Math.abs(v / 6) > 0.004 * d * d * d) this.side = v > 0 ? 1 : -1;
  }

  update(x, normals, faces) {
    const g = this.graph, nodes = g.nodes;
    this.updateSide(x, faces);
    const outs = [this.vs.instanceMatrix.array, this.posts.instanceMatrix.array];
    const up = new THREE.Vector3(), nrm = new THREE.Vector3(), side = new THREE.Vector3(), base = new THREE.Vector3();
    for (let k = 0; k < this.ids.length; k++) {
      const i = this.ids[k], nd = nodes[i];
      const tx = x[i * 3], ty = x[i * 3 + 1], tz = x[i * 3 + 2];
      let width = 1;
      if (nd.parents.length) {
        base.set(0, 0, 0);
        for (const p of nd.parents) base.x += x[p * 3], base.y += x[p * 3 + 1], base.z += x[p * 3 + 2];
        base.multiplyScalar(1 / nd.parents.length);
      } else if (nd.prev >= 0) {
        base.set(x[nd.prev * 3], x[nd.prev * 3 + 1], x[nd.prev * 3 + 2]);   // chain: lie along the chain
        width = 0.62;
      } else {
        base.set(tx - 0.6, ty, tz); width = 0.62;
      }
      up.set(tx - base.x, ty - base.y, tz - base.z);
      const h = up.length();
      const o = k * 16, out = outs[this.kind[k]], so = this.slot[k] * 16;
      if (h < 1e-4) { out.fill(0, so, so + 16); this.frames.fill(0, o, o + 16); continue; }
      if (nd.parents.length && nd.prev >= 0 && nodes[nd.prev].row === nd.row) {
        const p = nd.prev * 3;
        width = Math.min(1.5, Math.max(0.5, Math.hypot(tx - x[p], ty - x[p + 1], tz - x[p + 2])));
      }
      nrm.set(normals[i * 3], normals[i * 3 + 1], normals[i * 3 + 2]).multiplyScalar(this.side);
      side.crossVectors(up, nrm);
      if (side.lengthSq() < 1e-8) side.set(up.y, -up.x, 0).add(new THREE.Vector3(0, up.z, -up.y));
      side.normalize();
      nrm.crossVectors(side, up).normalize();
      const sx = side.x * width, sy = side.y * width, sz = side.z * width;
      const f = this.frames;
      f[o] = sx; f[o + 1] = sy; f[o + 2] = sz; f[o + 3] = 0;
      f[o + 4] = up.x; f[o + 5] = up.y; f[o + 6] = up.z; f[o + 7] = 0;
      f[o + 8] = nrm.x; f[o + 9] = nrm.y; f[o + 10] = nrm.z; f[o + 11] = 0;
      f[o + 12] = base.x; f[o + 13] = base.y; f[o + 14] = base.z; f[o + 15] = 1;
      for (let j = 0; j < 16; j++) out[so + j] = f[o + j];
    }
    this.vs.instanceMatrix.needsUpdate = true;
    this.posts.instanceMatrix.needsUpdate = true;

    const w = this.wraps.instanceMatrix.array, f = this.frames;
    for (let q = 0; q < this.wrapOf.length; q++) {
      const [k, t] = this.wrapOf[q];
      const o = k * 16, d = q * 16;
      for (let j = 0; j < 12; j++) w[d + j] = f[o + j];
      w[d + 12] = f[o + 12] + f[o + 4] * t;
      w[d + 13] = f[o + 13] + f[o + 5] * t;
      w[d + 14] = f[o + 14] + f[o + 6] * t;
      w[d + 15] = f[o + 15];
    }
    this.wraps.instanceMatrix.needsUpdate = true;
  }

  // colors: Float32Array of r,g,b per node
  setColors(colors) {
    const c = new THREE.Color();
    const meshes = [this.vs, this.posts];
    this.ids.forEach((i, k) => meshes[this.kind[k]].setColorAt(this.slot[k], c.setRGB(colors[i * 3], colors[i * 3 + 1], colors[i * 3 + 2])));
    this.wrapOf.forEach(([k], q) => {
      const i = this.ids[k];
      this.wraps.setColorAt(q, c.setRGB(colors[i * 3], colors[i * 3 + 1], colors[i * 3 + 2]));
    });
    for (const m of this.meshes) m.instanceColor.needsUpdate = true;
  }

  dispose() {
    for (const m of this.meshes) { m.geometry.dispose(); m.dispose?.(); }
  }
}

let sharedPly = null;
export function yarnMaterial() {
  if (!sharedPly) sharedPly = plyTexture();
  return new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.86, metalness: 0,
    bumpMap: sharedPly, bumpScale: 2.2,
  });
}
