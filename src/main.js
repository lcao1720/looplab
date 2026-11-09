import { parsePattern } from './parser.js';
import { buildGraph, DEFAULT_COLOR } from './graph.js';
import { initialPositions } from './layout.js';
import { Solver, measure } from './solver.js';
import { View } from './view.js';
import { PRESETS } from './presets.js';

const $ = (id) => document.getElementById(id);
const els = {
  pattern: $('pattern'), gutter: $('gutter'), presets: $('presets'),
  messages: $('messages'), rounds: $('rounds'), roundsTitle: $('rounds-title'),
  canvas: $('stage-canvas'), status: $('status'), statusText: $('status-text'),
  stuffing: $('stuffing'), stuffingOut: $('stuffing-out'),
  lines: $('show-lines'), stripes: $('show-stripes'), fit: $('fit-view'),
  gauge: $('gauge'), size: $('size'), counts: $('counts'),
  ruler: $('ruler'), rulerLabel: $('ruler-label'), stale: $('stale'),
};

const STORE_KEY = 'looplab.draft.v1';
const css = getComputedStyle(document.documentElement);
const view = new View(els.canvas, {
  fallbackColor: DEFAULT_COLOR,
  lineColor: css.getPropertyValue('--stitch-line').trim() || '#2a2433',
  highlight: css.getPropertyValue('--accent').trim() || '#5b4bdb',
});

let solver = null;
let graph = null;
let lastText = '';
let needsFit = true;
let lastRadius = 0;

// ---------- presets ----------
for (const p of PRESETS) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'chip';
  b.textContent = p.name;
  b.dataset.id = p.id;
  b.addEventListener('click', () => loadPreset(p));
  els.presets.appendChild(b);
}

function loadPreset(p) {
  els.pattern.value = p.text;
  els.stuffing.value = p.stuffing;
  updateStuffingLabel();
  markPreset(p.id);
  needsFit = true;
  rebuild(true);
  saveDraft();
}

function markPreset(id) {
  for (const b of els.presets.children) b.setAttribute('aria-pressed', String(b.dataset.id === id));
}

// ---------- editor ----------
function renderGutter(errLines = new Set(), warnLines = new Set()) {
  const n = els.pattern.value.split('\n').length;
  let html = '';
  for (let i = 1; i <= n; i++) {
    const cls = errLines.has(i) ? ' class="err"' : warnLines.has(i) ? ' class="warn"' : '';
    html += `<span${cls}>${i}</span>`;
  }
  els.gutter.innerHTML = html;
  els.gutter.scrollTop = els.pattern.scrollTop;
}

els.pattern.addEventListener('scroll', () => { els.gutter.scrollTop = els.pattern.scrollTop; });

let timer = 0;
els.pattern.addEventListener('input', () => {
  markPreset(null);
  renderGutter();
  clearTimeout(timer);
  timer = setTimeout(() => { rebuild(false); saveDraft(); }, 350);
});

function saveDraft() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify({ text: els.pattern.value, stuffing: +els.stuffing.value })); } catch { /* storage off */ }
}
function loadDraft() {
  try { const d = JSON.parse(localStorage.getItem(STORE_KEY) || 'null'); if (d && typeof d.text === 'string' && d.text.trim()) return d; } catch { /* storage off */ }
  return null;
}

// ---------- build ----------
function rebuild(force) {
  const text = els.pattern.value;
  if (!force && text === lastText) return;
  lastText = text;
  const g = buildGraph(parsePattern(text));
  const errLines = new Set(g.errors.map(e => e.line));
  const warnLines = new Set(g.warnings.map(w => w.line));
  renderGutter(errLines, warnLines);

  if (g.errors.length || !g.nodes.length) {
    renderMessages(g, []);
    renderRounds(graph);
    els.stale.hidden = !graph;
    if (!g.nodes.length && !g.errors.length) renderMessages({ errors: [], warnings: [], notes: ['Type a pattern to see the piece.'] }, []);
    return;
  }
  if (g.nodes.length > 6000) {
    renderMessages({ ...g, errors: [{ line: 1, msg: `This pattern has ${g.nodes.length} stitches. The limit is 6000 for now.` }] }, []);
    return;
  }

  els.stale.hidden = true;
  graph = g;
  const pos = initialPositions(g);
  solver = new Solver(g, pos);
  solver.setPressure(stuffingValue());
  view.setModel(g, solver.x);
  view.recolor();
  const bad = [...view.badColors].map(c => `I do not know the color "${c}". The default yarn color is used.`);
  renderMessages(g, bad);
  renderRounds(g);

  // re-frame the camera when the piece changes size a lot
  const r = view.mesh.geometry.boundingSphere?.radius || 1;
  if (needsFit || !lastRadius || r > lastRadius * 1.6 || r < lastRadius / 1.6) { needsFit = true; }
  setStatus(false);
}

function stuffingValue() { return (+els.stuffing.value / 100) * 1.5; }

function renderMessages(g, extra) {
  const items = [];
  for (const e of g.errors) items.push(`<li class="msg err"><span class="where">Line ${e.line}</span>${esc(e.msg)}</li>`);
  for (const w of g.warnings) items.push(`<li class="msg warn"><span class="where">Line ${w.line}</span>${esc(w.msg)}</li>`);
  for (const m of extra) items.push(`<li class="msg warn">${esc(m)}</li>`);
  for (const n of g.notes || []) items.push(`<li class="msg note">${esc(n)}</li>`);
  els.messages.innerHTML = items.join('');
  els.messages.hidden = items.length === 0;
}

function renderRounds(g) {
  els.rounds.innerHTML = '';
  if (!g) return;
  els.roundsTitle.textContent = g.mode === 'rows' ? 'Rows' : 'Rounds';
  g.rows.forEach((row, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'round' + (row.issues.length ? ' has-issue' : '');
    const label = g.mode === 'rows' ? (i === 0 ? 'Chain' : `Row ${row.label}`) : `R${row.label}`;
    const delta = i === 0 ? '' : row.made - g.rows[i - 1].made;
    const deltaText = delta === '' ? (g.mode === 'rows' ? 'chain' : 'ring') : delta > 0 ? `+${delta}` : delta < 0 ? `−${-delta}` : 'even';
    b.innerHTML = `<span class="r-label">${esc(label)}</span><span class="r-count">${row.made}</span><span class="r-delta">${deltaText}</span>`;
    b.title = row.issues.length ? row.issues.join(' ') : `Highlight ${label} in the model`;
    b.setAttribute('aria-pressed', 'false');
    b.addEventListener('click', () => {
      const on = view.highlightRow !== i;
      view.setHighlight(on ? i : -1);
      for (const other of els.rounds.children) other.setAttribute('aria-pressed', 'false');
      b.setAttribute('aria-pressed', String(on));
    });
    els.rounds.appendChild(b);
  });
}

function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

// ---------- controls ----------
function updateStuffingLabel() {
  const v = +els.stuffing.value;
  els.stuffingOut.textContent = v === 0 ? 'None' : v < 40 ? 'Light' : v < 75 ? 'Firm' : 'Very firm';
}
els.stuffing.addEventListener('input', () => {
  updateStuffingLabel();
  if (solver) { solver.setPressure(stuffingValue()); setStatus(false); }
  saveDraft();
});
els.lines.addEventListener('change', () => view.setShowLines(els.lines.checked));
els.stripes.addEventListener('change', () => view.setStripes(els.stripes.checked));
els.fit.addEventListener('click', () => view.fit());
els.gauge.addEventListener('input', updateStats);

function setStatus(settled) {
  els.status.dataset.state = settled ? 'settled' : 'settling';
  els.statusText.textContent = settled ? 'Settled' : 'Settling';
}

// ---------- stats ----------
function updateStats() {
  if (!solver) return;
  const gauge = Math.max(4, Math.min(60, +els.gauge.value || 18));
  const cmPerUnit = 10 / gauge;
  const m = measure(solver.x, solver.n);
  const dims = m.size.map(v => v * cmPerUnit).sort((a, b) => b - a);
  const fmt = (v) => (v < 10 ? v.toFixed(1) : Math.round(v).toString());
  const shown = dims[2] < 0.6 ? `${fmt(dims[0])} × ${fmt(dims[1])} cm, flat` : `${fmt(dims[0])} × ${fmt(dims[1])} × ${fmt(dims[2])} cm`;
  els.size.textContent = shown;
  const stitches = graph.nodes.filter(n => n.type !== 'ring').length;
  const rowsCount = graph.mode === 'rows' ? graph.rows.length - 1 : graph.rows.length;
  els.counts.textContent = `${rowsCount} ${graph.mode === 'rows' ? 'rows' : 'rounds'} · ${stitches.toLocaleString()} stitches`;
  updateRuler(cmPerUnit);
}

function updateRuler(cmPerUnit) {
  const cam = view.camera;
  const dist = cam.position.distanceTo(view.controls.target);
  const h = els.canvas.clientHeight || 1;
  const pxPerUnit = h / (2 * dist * Math.tan((cam.fov * Math.PI) / 360));
  const pxPerCm = pxPerUnit / cmPerUnit;
  const steps = [0.5, 1, 2, 5, 10, 20, 50, 100];
  const cm = steps.find(s => s * pxPerCm >= 48) || 100;
  els.ruler.style.width = `${Math.round(cm * pxPerCm)}px`;
  els.rulerLabel.textContent = `${cm} cm`;
}

// ---------- loop ----------
let statsTick = 0;
function frame() {
  if (solver && !solver.settled) {
    const t0 = performance.now();
    let n = 0;
    while (!solver.settled && performance.now() - t0 < 9 && n < 60) { solver.step(); n++; }
    view.update();
    if (needsFit && solver.steps > 120) {
      view.fit();
      lastRadius = view.mesh.geometry.boundingSphere.radius;
      needsFit = false;
    }
    if (solver.settled) setStatus(true);
  }
  if (++statsTick % 10 === 0) updateStats();
  view.render();
  requestAnimationFrame(frame);
}

const ro = new ResizeObserver(() => { view.resize(); updateStats(); });
ro.observe(els.canvas);

// ---------- start ----------
const draft = loadDraft();
if (draft) {
  els.pattern.value = draft.text;
  if (Number.isFinite(draft.stuffing)) els.stuffing.value = draft.stuffing;
  updateStuffingLabel();
  rebuild(true);
} else {
  loadPreset(PRESETS[0]);
}
requestAnimationFrame(frame);

// For tests and the console
window.looplab = { get solver() { return solver; }, get graph() { return graph; }, view, loadPreset, PRESETS };
