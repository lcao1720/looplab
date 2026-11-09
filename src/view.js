// 3D view: draws the stitch graph as a yarn-colored surface with optional
// stitch lines, using three.js.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

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
    if (this.mesh) { this.scene.remove(this.mesh); this.mesh.geometry.dispose(); }
    if (this.lines) { this.scene.remove(this.lines); this.lines.geometry.dispose(); }
    this.graph = graph;
    this.highlightRow = -1;

    const posAttr = new THREE.BufferAttribute(positions, 3);
    posAttr.setUsage(THREE.DynamicDrawUsage);
    this.posAttr = posAttr;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', posAttr);
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(graph.nodes.length * 3), 3));
    geo.setIndex(graph.faces.flat());
    this.mesh = new THREE.Mesh(geo, this.material);

    const lgeo = new THREE.BufferGeometry();
    lgeo.setAttribute('position', posAttr);
    const idx = [];
    for (const e of graph.edges) if (e.kind === 'prev' || e.kind === 'parent' || e.kind === 'turn') idx.push(e.a, e.b);
    lgeo.setIndex(idx);
    this.lines = new THREE.LineSegments(lgeo, this.lineMaterial);
    this.lines.visible = this.showLines;

    this.scene.add(this.mesh, this.lines);
    this.recolor();
    this.update();
  }

  recolor() {
    if (!this.mesh) return;
    const g = this.graph;
    const col = this.mesh.geometry.getAttribute('color');
    const c = new THREE.Color();
    const cache = new Map();
    this.badColors.clear();
    const center = g.center >= 0 ? g.nodes[g.center] : null;
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
      if (this.stripes && row % 2 === 1) c.multiplyScalar(0.86);
      if (row === this.highlightRow) c.copy(this.highlightColor);
      col.setXYZ(i, c.r, c.g, c.b);
    });
    col.needsUpdate = true;
  }

  setShowLines(on) { this.showLines = on; if (this.lines) this.lines.visible = on; }
  setStripes(on) { this.stripes = on; this.recolor(); }
  setHighlight(row) { this.highlightRow = row; this.recolor(); }

  update() {
    if (!this.mesh) return;
    this.posAttr.needsUpdate = true;
    this.mesh.geometry.computeVertexNormals();
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
