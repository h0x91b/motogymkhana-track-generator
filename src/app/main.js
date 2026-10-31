import { ELEMENT_TYPES, GENERATOR_VERSION, parseRecipe, parseSeed, TYPE_NAMES } from '../generator/index.js';
import { buildSetupSheet, fmt } from '../sheet/setup-sheet.js';
import { createCamera, drawScene, frameBounds, hitTest, resetCamera } from '../render/scene.js';
import { renderSheetImage } from '../render/sheet-image.js';
import { createGenerator } from './generator-client.js';
import { loadForm, saveForm } from './storage.js';
import { runSelfCheck } from './selfcheck.js';

const $ = (id) => document.getElementById(id);
const DIFFICULTY_NAMES = { easy: 'лёгкая', medium: 'средняя', hard: 'сложная' };
const DEBOUNCE_MS = 300;

function randomSeed() {
  // System randomness only for the "new seed" button, never inside generation.
  return crypto.getRandomValues(new Uint32Array(1))[0];
}

const DEFAULT_FORM = {
  width: '40', length: '60', elements: '8', difficulty: 'medium', closed: true, seed: '', types: [...ELEMENT_TYPES],
};

const state = {
  form: null,
  course: null,
  sheet: null,
  stale: false,
  selected: null,
  setupStep: null,
  camera: createCamera(),
  hits: [],
  requestId: 0,
  shownId: 0,
  image: null, // { id, file } — the setup-sheet PNG, prepared ahead of a share tap
};

// ---------------------------------------------------------------- form

const form = $('form');

function buildTypeChecks() {
  const box = $('types');
  for (const t of ELEMENT_TYPES) {
    const label = document.createElement('label');
    label.className = 'check';
    label.innerHTML = `<input type="checkbox" name="types" value="${t}"> ${TYPE_NAMES[t]}`;
    box.append(label);
  }
}

function writeForm(f) {
  form.width.value = f.width;
  form.length.value = f.length;
  form.elements.value = f.elements;
  for (const r of form.querySelectorAll('[name="difficulty"]')) r.checked = r.value === f.difficulty;
  form.closed.checked = !!f.closed;
  form.seed.value = f.seed;
  for (const c of form.querySelectorAll('[name="types"]')) c.checked = f.types.includes(c.value);
}

function readForm() {
  return {
    width: form.width.value,
    length: form.length.value,
    elements: form.elements.value,
    difficulty: form.querySelector('[name="difficulty"]:checked')?.value ?? '',
    closed: form.closed.checked,
    seed: form.seed.value,
    types: [...form.querySelectorAll('[name="types"]:checked')].map((c) => c.value),
  };
}

function showErrors(errors) {
  for (const p of form.querySelectorAll('.err')) p.textContent = errors[p.dataset.for] ?? '';
  for (const name of ['width', 'length', 'elements', 'seed']) {
    form[name].setAttribute('aria-invalid', errors[name] ? 'true' : 'false');
  }
  if (errors.types) form.querySelector('details').open = true;
}

function validate(raw) {
  const recipe = parseRecipe(raw);
  const seed = parseSeed(raw.seed);
  const errors = { ...(recipe.ok ? {} : recipe.errors), ...(seed.ok ? {} : { seed: seed.error }) };
  return { ok: recipe.ok && seed.ok, recipe: recipe.recipe, seed: seed.seed, errors };
}

let debounce = 0;
function onFormChange(immediate = false) {
  clearTimeout(debounce);
  const run = () => {
    const raw = readForm();
    state.form = raw;
    saveForm(raw);
    const v = validate(raw);
    showErrors(v.errors);
    if (!v.ok) {
      state.stale = !!state.course;
      showBanner(state.course ? 'Исправьте параметры — показана предыдущая трасса' : 'Исправьте параметры трассы', 'error');
      renderSummary();
      invalidate();
      return;
    }
    generate(v.recipe, v.seed);
  };
  if (immediate) run();
  else debounce = setTimeout(run, DEBOUNCE_MS);
}

// ---------------------------------------------------------------- generation

const generator = createGenerator(({ id, result }) => {
  if (id !== state.requestId) return; // a newer request is on its way
  state.shownId = id;
  if (!result.ok) {
    if (result.error.code === 'invalid-input') {
      showErrors(result.error.fields);
      showBanner('Исправьте параметры трассы', 'error');
    } else {
      state.course = null;
      state.sheet = null;
      showBanner(result.error.message, 'error');
    }
    state.image = null;
    renderSummary();
    invalidate();
    return;
  }
  const course = result.course;
  state.course = course;
  state.sheet = buildSetupSheet(course);
  state.stale = false;
  state.selected = null;
  state.image = null;
  hideElementCard();
  if (state.setupStep !== null) exitSetup();
  resetCamera(state.camera);
  if (course.placed < course.requested) showBanner(`Влезло ${course.placed} из ${course.requested} элементов`, 'warn');
  else hideBanner();
  renderSummary();
  invalidate();
  prepareImageSoon();
});

function generate(recipe, seed) {
  state.generatorMode = generator.mode;
  state.requestId++;
  generator.run({ id: state.requestId, recipe, seed });
}

function newSeed() {
  form.seed.value = String(randomSeed());
  onFormChange(true);
}

// ---------------------------------------------------------------- banner, summary, toast

function showBanner(text, kind) {
  const b = $('banner');
  b.textContent = text;
  b.className = `banner ${kind === 'error' ? 'error' : ''}`;
  b.hidden = false;
}
function hideBanner() {
  $('banner').hidden = true;
}

function renderSummary() {
  const f = state.form;
  const c = state.course;
  const parts = [`${f.width || '?'} × ${f.length || '?'} м`];
  if (c && !state.stale) parts.push(`${c.placed} из ${c.requested} эл.`);
  parts.push(DIFFICULTY_NAMES[f.difficulty] ?? '');
  parts.push(f.closed ? 'замкнутая' : 'открытая');
  parts.push(`seed ${f.seed || '—'}`);
  $('summary').textContent = parts.filter(Boolean).join(' · ');
}

let toastTimer = 0;
function toast(text) {
  const t = $('toast');
  t.textContent = text;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 2800);
}

// ---------------------------------------------------------------- canvas

const canvas = $('scene');
const ctx = canvas.getContext('2d');
let dirty = false;

function invalidate() {
  if (dirty) return;
  dirty = true;
  requestAnimationFrame(draw);
}

function draw() {
  dirty = false;
  const W = canvas.clientWidth;
  const H = canvas.clientHeight;
  if (!W || !H) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.globalAlpha = state.stale ? 0.45 : 1;
  const { hits } = drawScene(ctx, state.course, state.camera, W, H, { selected: state.selected });
  ctx.globalAlpha = 1;
  state.hits = hits;
}

new ResizeObserver(() => invalidate()).observe(canvas);

function setView(mode) {
  resetCamera(state.camera, mode);
  for (const b of document.querySelectorAll('[data-view]')) b.setAttribute('aria-pressed', String(b.dataset.view === mode));
  if (state.selected) focusElement(state.selected);
  invalidate();
}

function zoomBy(k, cx = canvas.clientWidth / 2, cy = canvas.clientHeight / 2) {
  const cam = state.camera;
  const next = Math.max(0.6, Math.min(8, cam.zoom * k));
  const r = next / cam.zoom;
  const W = canvas.clientWidth;
  const H = canvas.clientHeight;
  // Keep the point under (cx, cy) in place.
  cam.panX = cx - W / 2 - (cx - W / 2 - cam.panX) * r;
  cam.panY = cy - H / 2 - (cy - H / 2 - cam.panY) * r;
  cam.zoom = next;
  invalidate();
}

// Touch: one finger pans the plan (rotates in 3D), two fingers pinch and pan, a tap selects.
const pointers = new Map();
let gesture = null;
canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pointers.size === 1) gesture = { kind: 'one', x: e.clientX, y: e.clientY, ox: e.clientX, oy: e.clientY, moved: false };
  else if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    gesture = { kind: 'two', dist: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
  }
});
canvas.addEventListener('pointermove', (e) => {
  if (!pointers.has(e.pointerId) || !gesture) return;
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  const cam = state.camera;
  if (gesture.kind === 'one') {
    const dx = e.clientX - gesture.x;
    const dy = e.clientY - gesture.y;
    if (Math.hypot(e.clientX - gesture.ox, e.clientY - gesture.oy) > 6) gesture.moved = true;
    if (!gesture.moved) return;
    if (cam.mode === 'angle') {
      cam.yaw += dx * 0.006;
      cam.tilt = Math.max(0.15, Math.min((70 * Math.PI) / 180, cam.tilt + dy * 0.006));
    } else {
      cam.panX += dx;
      cam.panY += dy;
    }
    gesture.x = e.clientX;
    gesture.y = e.clientY;
    invalidate();
  } else if (gesture.kind === 'two' && pointers.size >= 2) {
    const [a, b] = [...pointers.values()];
    const dist = Math.hypot(a.x - b.x, a.y - b.y);
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    const rect = canvas.getBoundingClientRect();
    cam.panX += mx - gesture.mx;
    cam.panY += my - gesture.my;
    if (gesture.dist > 10) zoomBy(dist / gesture.dist, mx - rect.left, my - rect.top);
    gesture.dist = dist;
    gesture.mx = mx;
    gesture.my = my;
    invalidate();
  }
});
const endPointer = (e) => {
  if (!pointers.has(e.pointerId)) return;
  pointers.delete(e.pointerId);
  if (gesture?.kind === 'one' && !gesture.moved && e.type === 'pointerup') {
    const rect = canvas.getBoundingClientRect();
    onTap(e.clientX - rect.left, e.clientY - rect.top);
  }
  if (pointers.size === 1) {
    const [p] = [...pointers.values()];
    gesture = { kind: 'one', x: p.x, y: p.y, ox: p.x, oy: p.y, moved: true };
  } else if (!pointers.size) gesture = null;
};
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  const rect = canvas.getBoundingClientRect();
  zoomBy(Math.exp(-e.deltaY * 0.0015), e.clientX - rect.left, e.clientY - rect.top);
}, { passive: false });

function onTap(x, y) {
  if (!state.course || state.setupStep !== null) return;
  const id = hitTest(state.hits, x, y);
  if (id && id !== state.selected) selectElement(id);
  else {
    state.selected = null;
    hideElementCard();
  }
  invalidate();
}

// ---------------------------------------------------------------- element card and setup mode

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

function coneDot(cone) {
  const letter = cone.height === 'tall' ? (cone.color === 'blue' ? 'Л' : 'П') : '';
  const title = cone.height === 'tall' ? `${cone.color === 'blue' ? 'синий' : 'красный'} высокий` : 'низкий';
  return `<span class="dot ${cone.color}" title="${title}" aria-label="${title}">${letter}</span>`;
}

function coneTable(card, big = false) {
  const diag = card.axis.diagonal;
  const head = diag ? '<th>№</th><th>конус</th><th>ΔX</th><th>ΔY</th>' : '<th>№</th><th>конус</th><th>вдоль</th><th>поперёк</th>';
  const rows = card.cones.map((c) => {
    const a = diag ? c.dx : c.along;
    const b = diag ? c.dy : c.across;
    return `<tr><td>${c.n}</td><td>${coneDot(c)}</td><td>${fmt(a)} м</td><td>${fmt(b)} м</td></tr>`;
  }).join('');
  const note = diag ? '' : '<p class="muted">поперёк: «+» — влево от направления оси</p>';
  return `<table class="cones${big ? ' big' : ''}"><tr>${head}</tr>${rows}</table>${note}`;
}

function cardHtml(card, big = false) {
  return `<h3>${card.number}. ${esc(card.name)}</h3>
    <p class="anchor${big ? ' big' : ''}">Якорь: X ${fmt(card.anchor.x)} м · Y ${fmt(card.anchor.y)} м</p>
    <p class="muted">Ось: ${esc(card.axis.label)} · проезд ${esc(card.travel)}</p>
    ${card.notes.map((n) => `<p>${esc(n)}</p>`).join('')}
    ${coneTable(card, big)}`;
}

function selectElement(id) {
  state.selected = id;
  const card = state.sheet.cards.find((c) => c.element === id);
  const box = $('element-card');
  box.innerHTML = `<button type="button" class="close-x" aria-label="Закрыть">×</button>${cardHtml(card)}`;
  box.querySelector('.close-x').addEventListener('click', () => {
    state.selected = null;
    hideElementCard();
    invalidate();
  });
  box.hidden = false;
  // Frame the element in the part of the stage the card leaves free.
  const free = canvas.clientHeight - box.offsetHeight - 10;
  frameBounds(state.camera, canvas.clientWidth, Math.max(120, free), state.course.site, elementBounds(id));
  state.camera.panY -= (canvas.clientHeight - Math.max(120, free)) / 2;
  invalidate();
}

function hideElementCard() {
  $('element-card').hidden = true;
}

function elementBounds(id) {
  const e = state.course.elements.find((x) => x.id === id);
  const xs = e.zone.map((p) => p[0]);
  const ys = e.zone.map((p) => p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

function focusElement(id) {
  frameBounds(state.camera, canvas.clientWidth, canvas.clientHeight, state.course.site, elementBounds(id));
}

function setupSteps() {
  const steps = [{ kind: 'start' }, ...state.sheet.cards.map((card) => ({ kind: 'element', card }))];
  if (!state.sheet.closed) steps.push({ kind: 'finish' });
  return steps;
}

function terminalHtml(t, title) {
  const cones = t.cones.map((c) => `<tr><td>${coneDot({ height: 'low', color: 'neutral' })}</td><td>X ${fmt(c.x)} м</td><td>Y ${fmt(c.y)} м</td></tr>`).join('');
  return `<h3>${title}</h3><p class="muted">Два низких конуса, линия поперёк проезда (${esc(t.travel)})</p>
    <table class="cones big"><tr><th></th><th>X от угла A</th><th>Y от угла A</th></tr>${cones}</table>`;
}

function renderSetup() {
  const steps = setupSteps();
  const step = steps[state.setupStep];
  const body = $('setup-body');
  const counter = `<p class="muted">Шаг ${state.setupStep + 1} из ${steps.length} · ведомость: синих ${state.sheet.coneList.tallBlue}, красных ${state.sheet.coneList.tallRed}, низких ${state.sheet.coneList.low}</p>`;
  if (step.kind === 'element') {
    body.innerHTML = counter + cardHtml(step.card, true);
    state.selected = step.card.element;
    focusElement(step.card.element);
  } else {
    const t = step.kind === 'start' ? state.sheet.start : state.sheet.finish;
    body.innerHTML = counter + terminalHtml(t, step.kind === 'start' ? (state.sheet.closed ? 'Старт и финиш' : 'Старт') : 'Финиш');
    state.selected = null;
    const xs = t.cones.map((c) => c.x);
    const ys = t.cones.map((c) => c.y);
    frameBounds(state.camera, canvas.clientWidth, canvas.clientHeight, state.course.site, [Math.min(...xs) - 4, Math.min(...ys) - 4, Math.max(...xs) + 4, Math.max(...ys) + 4]);
  }
  $('setup-prev').disabled = state.setupStep === 0;
  $('setup-next').textContent = state.setupStep === steps.length - 1 ? 'Готово' : 'Дальше';
  invalidate();
}

function enterSetup() {
  if (!state.course || state.stale) return;
  hideElementCard();
  state.setupStep = 0;
  $('dock').hidden = true;
  $('setup-panel').hidden = false;
  requestAnimationFrame(renderSetup);
}

function exitSetup() {
  state.setupStep = null;
  state.selected = null;
  $('dock').hidden = false;
  $('setup-panel').hidden = true;
  resetCamera(state.camera);
  invalidate();
}

// ---------------------------------------------------------------- picture

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

async function buildImageFile() {
  const canvasImg = renderSheetImage(state.course, state.sheet, makeCanvas);
  const blob = await new Promise((resolve) => canvasImg.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('png');
  return new File([blob], 'motogymkhana-skhema.png', { type: 'image/png' });
}

let imageTimer = 0;
function prepareImageSoon() {
  // Prepared ahead so a share tap can open the system sheet straight away:
  // Safari only allows navigator.share() close to the user's tap.
  clearTimeout(imageTimer);
  const id = state.shownId;
  imageTimer = setTimeout(async () => {
    try {
      const file = await buildImageFile();
      if (state.shownId === id && state.course) state.image = { id, file };
    } catch {
      // Built on demand at tap time instead.
    }
  }, 500);
}

function download(file) {
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  toast('Картинка сохранена в загрузки');
}

async function share() {
  if (!state.course || state.stale) {
    toast('Сначала нужна трасса');
    return;
  }
  let file = state.image?.id === state.shownId ? state.image.file : null;
  if (!file) {
    try {
      file = await buildImageFile();
    } catch {
      toast('Не удалось нарисовать картинку');
      return;
    }
  }
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
    } catch (e) {
      // Cancelling the share sheet is not an error; a refused share falls back to a download.
      if (e && e.name !== 'AbortError') download(file);
    }
    return;
  }
  download(file);
}

// ---------------------------------------------------------------- sheet (form panel)

function openForm() {
  $('backdrop').hidden = false;
  $('form-sheet').hidden = false;
}
function closeForm() {
  document.activeElement?.blur?.();
  $('backdrop').hidden = true;
  $('form-sheet').hidden = true;
  onFormChange(true);
}

// Keep the form above the on-screen keyboard (iOS does not resize the layout viewport).
if (window.visualViewport) {
  const vv = window.visualViewport;
  const onViewport = () => {
    const kb = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
    document.documentElement.style.setProperty('--kb', `${Math.round(kb)}px`);
  };
  vv.addEventListener('resize', onViewport);
  vv.addEventListener('scroll', onViewport);
}
form.addEventListener('focusin', (e) => {
  if (e.target.matches('input')) setTimeout(() => e.target.scrollIntoView({ block: 'center', behavior: 'smooth' }), 250);
});

// ---------------------------------------------------------------- wiring

function start() {
  $('version').textContent = String(GENERATOR_VERSION);
  buildTypeChecks();
  const saved = loadForm();
  const initial = { ...DEFAULT_FORM, ...(saved ?? {}) };
  if (!Array.isArray(initial.types)) initial.types = [...ELEMENT_TYPES];
  if (initial.seed === '' || initial.seed === undefined) initial.seed = String(randomSeed());
  writeForm(initial);
  state.form = readForm();

  form.addEventListener('input', () => onFormChange());
  form.addEventListener('change', () => onFormChange());
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    closeForm();
  });
  form.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.matches('input')) {
      e.preventDefault();
      e.target.blur();
      onFormChange(true);
    }
  });
  for (const b of form.querySelectorAll('[data-step]')) {
    b.addEventListener('click', () => {
      const n = Number.parseInt(form.elements.value, 10);
      const next = Math.max(1, Math.min(15, (Number.isFinite(n) ? n : 8) + Number(b.dataset.step)));
      form.elements.value = String(next);
      onFormChange();
    });
  }
  $('form-new-seed').addEventListener('click', newSeed);
  $('close-form').addEventListener('click', closeForm);
  $('backdrop').addEventListener('click', closeForm);
  $('open-form').addEventListener('click', openForm);
  $('summary').addEventListener('click', openForm);
  $('new-seed').addEventListener('click', newSeed);
  $('setup-mode').addEventListener('click', enterSetup);
  $('setup-close').addEventListener('click', exitSetup);
  $('setup-prev').addEventListener('click', () => {
    if (state.setupStep > 0) {
      state.setupStep--;
      renderSetup();
    }
  });
  $('setup-next').addEventListener('click', () => {
    if (state.setupStep < setupSteps().length - 1) {
      state.setupStep++;
      renderSetup();
    } else exitSetup();
  });
  $('share').addEventListener('click', share);
  for (const b of document.querySelectorAll('[data-view]')) b.addEventListener('click', () => setView(b.dataset.view));
  $('zoom-in').addEventListener('click', () => zoomBy(1.25));
  $('zoom-out').addEventListener('click', () => zoomBy(1 / 1.25));
  $('zoom-fit').addEventListener('click', () => {
    state.selected = null;
    hideElementCard();
    resetCamera(state.camera);
    invalidate();
  });

  renderSummary();
  onFormChange(true);
}

if (location.hash === '#selfcheck') runSelfCheck(document.getElementById('app'));
else start();

// Exposed for inspection from the browser console and automated UI checks.
window.__motogymkhana = state;
