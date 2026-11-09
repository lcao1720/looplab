// 3D view: draws the stitch graph with three.js.
// Two looks: "yarn" (every stitch drawn as yarn over a shaded fabric surface)
// and "smooth" (a plain surface with stitch lines).

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { YarnLayer, yarnMaterial, SHELL } from './yarn.js';

export class View {
  constructor(canvas, { fallbackColor = '#e9a6b8', lineColor = '#2a2433', highlight = '#5b4bdb' } = {}) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(38, 1, 0.05, 2000);
    this.camera.position.set(14, 10, 18);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;

    const hemi = new THREE.HemisphereLight(0xffffff, 0x6d6880, 1.4);
    const key = new THREE.DirectionalLight(0xffffff, 1.7);
    key.position.set(6, 12, 9);
    const rim = new THREE.DirectionalLight(0xdfe4ff, 0.6);
    rim.position.set(-8, -4, -10);
    this.scene.add(hemi, key, rim);

    this.material = new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 0.9, metalness: 0, side: THREE.DoubleSide,
    });
    this.lineMaterial = new THREE.LineBasicMaterial({ color: lineColor, transparent: true, opacity: 0.38 });
    this.yarnMaterial = yarnMaterial();
    this.yarn = null;
    this.look = 'yarn';
    this.fallbackColor = fallbackColor;
    this.highlightColor = new THREE.Color(highlight);
    this.mesh = null;
    this.lines = null;
    this.showLines = true;
    this.stripes = true;
    this.highlightRow = -1;
    this.graph = null;
    this.badColors = new Set();
    this.resize();
  }

  setTheme({ lineColor, highlight }) {
    if (lineColor) this.lineMaterial.color.set(lineColor);
    if (highlight) { this.highlightColor.set(highlight); this.recolor(); }
  }

  resize() {
    const r = this.canvas.getBoundingClientRect();
    const w = Math.max(1, Math.round(r.width)), h = Math.max(1, Math.round(r.height));
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  setModel(graph, positions) {
    if (this.mesh) { this.scene.remove(this.mesh, this.backMesh); this.mesh.geometry.dispose(); this.backMesh.geometry.dispose(); this.baseGeo.dispose(); }
    if (this.lines) { this.scene.remove(this.lines); this.lines.geometry.dispose(); }
    if (this.yarn) { this.scene.remove(this.yarn.group); this.yarn.dispose(); }
    this.graph = graph;
    this.highlightRow = -1;

    const posAttr = new THREE.BufferAttribute(positions, 3);
    posAttr.setUsage(THREE.DynamicDrawUsage);
    this.posAttr = posAttr;

    // baseGeo: the fabric's middle surface, used for normals only.
    // mesh / backMesh: the front and back faces of the fabric. In the smooth
    // look the front sits on the middle surface and the back is hidden.
    const n = graph.nodes.length;
    this.faceIndex = Uint32Array.from(graph.faces.flat());
    const index = new THREE.BufferAttribute(this.faceIndex, 1);
    this.baseGeo = new THREE.BufferGeometry();
    this.baseGeo.setAttribute('position', posAttr);
    this.baseGeo.setIndex(index);
    const color = new THREE.BufferAttribute(new Float32Array(n * 3), 3);
    const shell = () => {
      const g = new THREE.BufferGeometry();
      const p = new THREE.BufferAttribute(new Float32Array(n * 3), 3); p.setUsage(THREE.DynamicDrawUsage);
      const q = new THREE.BufferAttribute(new Float32Array(n * 3), 3); q.setUsage(THREE.DynamicDrawUsage);
      g.setAttribute('position', p); g.setAttribute('normal', q); g.setAttribute('color', color);
      g.setIndex(index);
      return g;
    };
    this.mesh = new THREE.Mesh(shell(), this.material);
    this.backMesh = new THREE.Mesh(shell(), this.material);

    const lgeo = new THREE.BufferGeometry();
    lgeo.setAttribute('position', posAttr);
    const idx = [];
    for (const e of graph.edges) if (e.kind === 'prev' || e.kind === 'parent' || e.kind === 'turn') idx.push(e.a, e.b);
    lgeo.setIndex(idx);
    this.lines = new THREE.LineSegments(lgeo, this.lineMaterial);

    this.yarn = new YarnLayer(graph, this.yarnMaterial);
    this.applyLook();
    this.scene.add(this.mesh, this.backMesh, this.lines, this.yarn.group);
    this.recolor();
    this.update();
  }

  recolor() {
    if (!this.mesh) return;
    const g = this.graph;
    const col = this.mesh.geometry.getAttribute('color');
    const colors = new Float32Array(g.nodes.length * 3);
    const c = new THREE.Color();
    const cache = new Map();
    this.badColors.clear();
    const center = g.center >= 0 ? g.nodes[g.center] : null;
    const yarn = this.look === 'yarn';
    g.nodes.forEach((nd, i) => {
      let base = cache.get(nd.color);
      if (!base) {
        const css = normalizeColor(nd.color);
        if (css) base = new THREE.Color().setStyle(css);
        else { base = new THREE.Color(this.fallbackColor); this.badColors.add(nd.color); }
        cache.set(nd.color, base);
      }
      c.copy(base);
      const row = nd === center ? 0 : nd.row;
      if (this.stripes && row % 2 === 1) c.multiplyScalar(yarn ? 0.92 : 0.86);
      if (row === this.highlightRow) c.copy(this.highlightColor);
      colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
      // under the yarn, the fabric surface is the shadow between strands
      const k = yarn ? 0.5 : 1;
      col.setXYZ(i, c.r * k, c.g * k, c.b * k);
    });
    col.needsUpdate = true;
    if (this.yarn) this.yarn.setColors(colors);
  }

  setLook(look) { this.look = look; this.applyLook(); this.recolor(); this.update(); }
  applyLook() {
    const yarn = this.look === 'yarn';
    if (this.lines) this.lines.visible = !yarn && this.showLines;
    if (this.yarn) this.yarn.group.visible = yarn;
    if (this.backMesh) this.backMesh.visible = yarn;
  }
  setShowLines(on) { this.showLines = on; this.applyLook(); }
  setStripes(on) { this.stripes = on; this.recolor(); }
  setHighlight(row) { this.highlightRow = row; this.recolor(); }

  update() {
    if (!this.mesh) return;
    this.posAttr.needsUpdate = true;
    this.baseGeo.computeVertexNormals();
    const x = this.posAttr.array, nrm = this.baseGeo.getAttribute('normal').array;
    const yarn = this.look === 'yarn' && this.yarn;
    if (yarn) this.yarn.update(x, nrm, this.faceIndex);
    const d = yarn ? SHELL * this.yarn.side : 0;
    for (const [mesh, sign] of [[this.mesh, 1], [this.backMesh, -1]]) {
      const g = mesh.geometry, p = g.getAttribute('position'), q = g.getAttribute('normal');
      const pa = p.array, k = d * sign;
      for (let i = 0; i < x.length; i++) pa[i] = x[i] + k * nrm[i];
      q.array.set(nrm);
      p.needsUpdate = true; q.needsUpdate = true;
    }
    this.mesh.geometry.computeBoundingSphere();
  }

  fit() {
    if (!this.mesh) return;
    this.mesh.geometry.computeBoundingSphere();
    const s = this.mesh.geometry.boundingSphere;
    const r = Math.max(2, s.radius);
    const dist = r / Math.sin((this.camera.fov * Math.PI) / 360) * 1.15;
    const dir = this.camera.position.clone().sub(this.controls.target).normalize();
    if (dir.lengthSq() < 0.5) dir.set(0.55, 0.42, 0.72).normalize();
    this.controls.target.copy(s.center);
    this.camera.position.copy(s.center).addScaledVector(dir, dist);
    this.camera.near = dist / 100; this.camera.far = dist * 20;
    this.camera.updateProjectionMatrix();
    this.controls.update();
  }

  render() {
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }
}

// Turn a color name or hex into a CSS color, or null if the browser does not
// know it (so a typo like "pinnk" can be reported to the user).
const probe = typeof document !== 'undefined' ? document.createElement('canvas').getContext('2d') : null;
export function normalizeColor(name) {
  if (!probe) return null;
  probe.fillStyle = '#010203';
  probe.fillStyle = name;
  const a = probe.fillStyle;
  probe.fillStyle = '#030201';
  probe.fillStyle = name;
  return a === '#010203' && probe.fillStyle === '#030201' ? null : a;
}
