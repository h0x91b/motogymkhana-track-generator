import {
  BIG_ELEMENT_AREA, canonicalJSON, ELEMENT_TYPES, LOOPED_TYPES, parseRecipe, parseSeed, SHAPE_NAMES, SIZE_OPTIONS, sizeDefault, sizeMinimum, sizeValues,
  TYPE_LEVELS, TYPE_NAMES,
} from '../generator/index.js';
import { buildSetupSheet, fmt } from '../sheet/setup-sheet.js';
import { centreOn, createCamera, drawScene, frameBounds, hitTest, resetCamera } from '../render/scene.js';
import { buildRide, RIDE_SPEED, rideAt } from '../render/ride.js';
import { renderSheetImages } from '../render/sheet-image.js';
import { createGenerator } from './generator-client.js';
import { loadForm, loadRideSpeed, loadZones, saveForm, saveRideSpeed, saveZones } from './storage.js';

const $ = (id) => document.getElementById(id);
const DIFFICULTY_NAMES = { easy: 'лёгкая', medium: 'средняя', hard: 'сложная' };
const BIKE_NAMES = { sport: 'спорт', cruiser: 'крузер' };
const DEBOUNCE_MS = 300;

// A laptop, a desktop or a landscape tablet: the recipe stays docked beside the
// stage instead of opening as a sheet. Keep in step with the media query in styles.css.
const wide = matchMedia('(min-width: 900px) and (min-height: 560px)');

function randomSeed() {
  // System randomness only for the "new seed" button, never inside generation.
  return crypto.getRandomValues(new Uint32Array(1))[0];
}

const DEFAULT_FORM = {
  width: '40', length: '60', elements: '8', difficulty: 'hard', bike: 'cruiser', shape: 'closed', train: true, seed: '1', types: [...ELEMENT_TYPES], sizes: {},
};

// The types a form saved before `knownTypes` was stored had to choose from.
const FIRST_TYPES = ELEMENT_TYPES.slice(0, 8);

/** The saved type ticks, with every type added since that form was saved ticked. */
function savedTypes(saved) {
  if (!Array.isArray(saved?.types)) return [...ELEMENT_TYPES];
  const known = Array.isArray(saved.knownTypes) ? saved.knownTypes : FIRST_TYPES;
  return ELEMENT_TYPES.filter((t) => saved.types.includes(t) || !known.includes(t));
}

const state = {
  form: null,
  course: null,
  courseKey: null, // recipe and seed of the shown course
  sheet: null,
  stale: false,
  selected: null,
  setupStep: null,
  setupWanted: false, // «Расстановка» tapped while a course was still being generated
  ride: null, // { track, riders, s, poses, playing, last } while schematic riders are on the course
  camera: createCamera(),
  hits: [],
  requestId: 0,
  shownId: 0,
  image: null, // { id, files } — the setup-sheet frames, prepared ahead of a share tap
  seedHistory: [], // seeds «Новый seed» replaced, newest last: «↶» brings them back
};

const SEED_HISTORY = 30;

// ---------------------------------------------------------------- form

const form = $('form');

const sizeName = (type, key) => `size:${type}:${key}`;
const range = ([lo, hi]) => (lo === hi ? `${fmt(lo)} м` : `${fmt(lo)}–${fmt(hi)} м`);

/** Size options of a type, folded under its row: «авто» or a fixed value in 0.5 m steps. */
function sizePanel(type) {
  const panel = document.createElement('div');
  panel.className = 'sizes';
  panel.id = `sizes-${type}`;
  panel.hidden = true;
  panel.innerHTML = SIZE_OPTIONS[type].map((o) => `<fieldset class="size-option">
      <legend>${o.name}</legend>
      <div class="chips">
        <label><input type="radio" name="${sizeName(type, o.key)}" value="" checked><span class="auto">авто</span></label>
        ${sizeValues(o).map((v) => `<label><input type="radio" name="${sizeName(type, o.key)}" value="${v}"><span>${fmt(v)}</span></label>`).join('')}
      </div>
      <p class="muted size-note" data-type="${type}" data-key="${o.key}"></p>
    </fieldset>`).join('');
  return panel;
}

function buildTypeChecks() {
  const box = $('types');
  for (const t of ELEMENT_TYPES) {
    const row = document.createElement('div');
    row.className = 'type-row';
    const label = document.createElement('label');
    label.className = 'check';
    // Name and hints in one span: the label is a flex row, so loose text would wrap as a separate column.
    label.innerHTML = `<input type="checkbox" name="types" value="${t}"> <span>${TYPE_NAMES[t]}`
      + `${LOOPED_TYPES.includes(t) ? '<span class="train-off"> — не в паровозике</span>' : ''}`
      + `${TYPE_LEVELS[t] ? '<span class="level-off"> — со средней сложности</span>' : ''}</span>`;
    row.append(label);
    box.append(row);
    if (!SIZE_OPTIONS[t]) continue;
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'size-toggle';
    toggle.dataset.type = t;
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-controls', `sizes-${t}`);
    toggle.addEventListener('click', () => {
      const panel = $(`sizes-${t}`);
      panel.hidden = !panel.hidden;
      toggle.setAttribute('aria-expanded', String(!panel.hidden));
    });
    row.append(toggle);
    box.append(sizePanel(t));
  }
}

/** The value fixed for a size option in the form, or '' for «авто». */
const sizeChoice = (type, key) => form.querySelector(`[name="${sizeName(type, key)}"]:checked`)?.value ?? '';

/**
 * Size options follow the difficulty and the class: «авто» says what the
 * generator takes then, and a value the class raises says so.
 */
function syncSizes() {
  const difficulty = form.querySelector('[name="difficulty"]:checked')?.value;
  const bike = form.querySelector('[name="bike"]:checked')?.value;
  if (!difficulty || !bike) return;
  for (const note of form.querySelectorAll('.size-note')) {
    const { type, key } = note.dataset;
    const chosen = sizeChoice(type, key);
    const min = sizeMinimum(type, key, difficulty, bike);
    const auto = sizeDefault(type, key, difficulty, bike);
    note.closest('.size-option').querySelector('.auto').textContent = `авто ${range(auto)}`;
    const raised = chosen !== '' && min !== null && Number(chosen) < min;
    note.textContent = raised
      ? `Для мотоцикла «${BIKE_NAMES[bike]}» мало: будет не меньше ${fmt(min)} м`
      : chosen === '' ? `По сложности: ${range(auto)}` : '';
    note.classList.toggle('warn', raised);
    // Values the class raises stay choosable, but look it.
    for (const input of note.closest('.size-option').querySelectorAll('input[value]:not([value=""])')) {
      input.nextElementSibling.classList.toggle('below', min !== null && Number(input.value) < min);
    }
  }
  for (const toggle of form.querySelectorAll('.size-toggle')) {
    const type = toggle.dataset.type;
    const values = SIZE_OPTIONS[type].map((o) => sizeChoice(type, o.key)).filter((v) => v !== '');
    toggle.textContent = values.length ? `${values.map((v) => fmt(Number(v))).join(' · ')} м` : 'Размер';
    toggle.classList.toggle('set', values.length > 0);
    toggle.setAttribute('aria-label', `${TYPE_NAMES[type]}: размер ${values.length ? `${values.map((v) => fmt(Number(v))).join(' и ')} м` : 'авто'}`);
  }
}

/**
 * Types the generator leaves out whatever is ticked — looped ones in
 * «паровозик», the medium-and-up ones at easy: say so on the boxes.
 */
function syncTypes() {
  const train = form.train.checked;
  const difficulty = form.querySelector('[name="difficulty"]:checked')?.value;
  $('train-hint').hidden = !train;
  for (const t of ELEMENT_TYPES) {
    const level = TYPE_LEVELS[t] && !TYPE_LEVELS[t].includes(difficulty);
    form.querySelector(`[name="types"][value="${t}"]`).disabled = (train && LOOPED_TYPES.includes(t)) || !!level;
  }
  for (const s of form.querySelectorAll('.train-off')) s.hidden = !train;
  for (const s of form.querySelectorAll('.level-off')) s.hidden = difficulty !== 'easy';
  syncSizes();
}

const SHAPE_HINTS = {
  open: 'Старт и финиш генератор ставит где угодно на площадке.',
  closed: 'Одна линия — и старт, и финиш: последняя связка ведёт обратно на старт, трассу можно ехать по кругу.',
  return: 'Две линии рядом: финиш не дальше 8 м от старта, заканчивают там же, где начали, но не заезжают на старт.',
};

function syncShapeHint() {
  $('shape-hint').textContent = SHAPE_HINTS[form.querySelector('[name="shape"]:checked')?.value] ?? '';
}

/** The saved course shape; a form saved before shapes had only the «Замкнутая» tick. */
function savedShape(saved) {
  if (typeof saved?.shape === 'string') return saved.shape;
  if (typeof saved?.closed === 'boolean') return saved.closed ? 'closed' : 'open';
  return DEFAULT_FORM.shape;
}

function writeForm(f) {
  form.width.value = f.width;
  form.length.value = f.length;
  form.elements.value = f.elements;
  for (const r of form.querySelectorAll('[name="difficulty"]')) r.checked = r.value === f.difficulty;
  for (const r of form.querySelectorAll('[name="bike"]')) r.checked = r.value === f.bike;
  for (const r of form.querySelectorAll('[name="shape"]')) r.checked = r.value === f.shape;
  syncShapeHint();
  form.train.checked = !!f.train;
  form.seed.value = f.seed;
  for (const c of form.querySelectorAll('[name="types"]')) c.checked = f.types.includes(c.value);
  for (const [type, options] of Object.entries(SIZE_OPTIONS)) {
    for (const o of options) {
      const value = f.sizes?.[type]?.[o.key];
      const input = form.querySelector(`[name="${sizeName(type, o.key)}"][value="${value ?? ''}"]`)
        ?? form.querySelector(`[name="${sizeName(type, o.key)}"][value=""]`);
      input.checked = true;
    }
  }
  syncTypes();
}

function readForm() {
  return {
    width: form.width.value,
    length: form.length.value,
    elements: form.elements.value,
    difficulty: form.querySelector('[name="difficulty"]:checked')?.value ?? '',
    bike: form.querySelector('[name="bike"]:checked')?.value ?? '',
    shape: form.querySelector('[name="shape"]:checked')?.value ?? '',
    train: form.train.checked,
    seed: form.seed.value,
    types: [...form.querySelectorAll('[name="types"]:checked')].map((c) => c.value),
    sizes: readSizes(),
  };
}

/** Fixed sizes from the form, numbers in metres; unticked types keep theirs here, the recipe drops them. */
function readSizes() {
  const sizes = {};
  for (const [type, options] of Object.entries(SIZE_OPTIONS)) {
    for (const o of options) {
      const v = sizeChoice(type, o.key);
      if (v !== '') (sizes[type] ??= {})[o.key] = Number(v);
    }
  }
  return sizes;
}

function showErrors(errors) {
  for (const p of form.querySelectorAll('.err')) p.textContent = errors[p.dataset.for] ?? '';
  for (const name of ['width', 'length', 'elements', 'seed']) {
    form[name].setAttribute('aria-invalid', errors[name] ? 'true' : 'false');
  }
  if (errors.types || errors.sizes) form.querySelector('details').open = true;
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
    saveForm({ ...raw, knownTypes: ELEMENT_TYPES });
    const v = validate(raw);
    showErrors(v.errors);
    if (!v.ok) {
      state.stale = !!state.course;
      showBanner(state.course ? 'Исправьте ошибки в форме — показана предыдущая трасса' : 'Исправьте ошибки в форме', 'error');
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
  const wanted = state.setupWanted;
  state.setupWanted = false;
  if (!result.ok) {
    if (result.error.code === 'invalid-input') {
      showErrors(result.error.fields);
      showBanner('Исправьте ошибки в форме', 'error');
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
  // Same recipe and seed is the same course: keep the view, selection and setup step.
  const key = canonicalJSON({ recipe: course.recipe, seed: course.seed });
  if (state.course && !state.stale && key === state.courseKey) {
    renderSummary();
    if (wanted) enterSetup();
    return;
  }
  state.courseKey = key;
  stopRide();
  state.course = course;
  state.sheet = buildSetupSheet(course);
  state.stale = false;
  state.selected = null;
  state.image = null;
  hideElementCard();
  if (state.setupStep !== null) exitSetup();
  resetCamera(state.camera);
  // The count stays in the summary; the hint only needs to be seen once.
  hideBanner();
  // Not over the open form: the form says it in its own status line.
  if (course.placed < course.requested && $('form-sheet').hidden) toast(shortfallText(course), 6000);
  renderSummary();
  invalidate();
  prepareImageSoon();
  if (wanted) enterSetup();
});

/** Why the course has fewer elements than asked for, and what to change. */
function shortfallText(course) {
  return course.limitedBy === 'big-elements'
    ? `Один элемент из ${course.requested}: отмеченные типы на этой сложности всегда большие (от ${BIG_ELEMENT_AREA} м²), а большой элемент на трассе может быть только один. Отметьте и другие типы`
    : `Влезло ${course.placed} из ${course.requested} элементов. Уменьшите число элементов или сложность либо увеличьте площадку`;
}

function generate(recipe, seed) {
  state.generatorMode = generator.mode;
  state.requestId++;
  generator.run({ id: state.requestId, recipe, seed });
  // Only if it takes a moment: a quick course replaces the status before anyone sees «собираю».
  const id = state.requestId;
  setTimeout(() => {
    if (state.requestId === id && state.shownId !== id) renderFormStatus();
  }, 250);
}

function newSeed() {
  const previous = form.seed.value;
  if (parseSeed(previous).ok && state.seedHistory.at(-1) !== previous) {
    state.seedHistory.push(previous);
    if (state.seedHistory.length > SEED_HISTORY) state.seedHistory.shift();
  }
  form.seed.value = String(randomSeed());
  renderSeedBack();
  onFormChange(true);
}

/** «↶»: the course before the last «Новый seed», so a good one is never lost to a curious tap. */
function previousSeed() {
  const seed = state.seedHistory.pop();
  if (seed === undefined) return;
  form.seed.value = seed;
  renderSeedBack();
  onFormChange(true);
}

function renderSeedBack() {
  $('prev-seed').disabled = !state.seedHistory.length;
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

const SUMMARY_SIZES = 2;

/** Fixed sizes of the ticked types, briefly: the first two by name, then how many more. */
function sizesSummary(f) {
  const items = [];
  for (const [type, options] of Object.entries(SIZE_OPTIONS)) {
    if (!f.types.includes(type)) continue;
    for (const o of options) {
      const v = f.sizes?.[type]?.[o.key];
      if (v !== undefined) items.push(`${o.short} ${fmt(v)} м`);
    }
  }
  if (items.length <= SUMMARY_SIZES) return items.join(' · ');
  return `${items.slice(0, SUMMARY_SIZES).join(' · ')} · ещё ${items.length - SUMMARY_SIZES} разм.`;
}

function renderSummary() {
  const f = state.form;
  const c = state.course;
  const short = c && !state.stale && c.placed < c.requested;
  const parts = [`${f.width || '?'} × ${f.length || '?'} м`];
  if (c && !state.stale) {
    const count = c.limitedBy === 'big-elements' ? `${c.placed} из ${c.requested} эл.: большой один` : `влезло ${c.placed} из ${c.requested} эл.`;
    parts.push(short ? count : `${c.placed} из ${c.requested} эл.`);
  }
  parts.push(DIFFICULTY_NAMES[f.difficulty] ?? '');
  parts.push(BIKE_NAMES[f.bike] ?? '');
  parts.push(SHAPE_NAMES[f.shape] ?? '');
  if (f.train) parts.push('паровозик');
  parts.push(sizesSummary(f));
  parts.push(`seed ${f.seed || '—'}`);
  const shown = parts.filter(Boolean);
  const summary = $('summary');
  summary.replaceChildren(...shown.flatMap((text, i) => {
    const node = short && i === 1 ? Object.assign(document.createElement('span'), { className: 'warn', textContent: text }) : document.createTextNode(text);
    return i ? [document.createTextNode(' · '), node] : [node];
  }));
  summary.setAttribute('aria-label', `${shown.join(' · ')}. Открыть рецепт`);
  renderFormStatus();
}

const elementsWord = (n) => (n % 10 === 1 && n % 100 !== 11 ? 'элемент' : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100) ? 'элемента' : 'элементов');

/** The open form says what its recipe gives, since the course itself is behind it. */
function renderFormStatus() {
  const p = $('form-status');
  const c = state.course;
  let text = '';
  let kind = '';
  if (!validate(state.form).ok) {
    text = 'Исправьте ошибки в форме';
    kind = 'error';
  } else if (state.requestId !== state.shownId) text = 'Собираю трассу…';
  else if (!c) {
    text = $('banner').hidden ? '' : $('banner').textContent;
    kind = 'error';
  } else if (c.placed < c.requested) {
    text = shortfallText(c);
    kind = 'warn';
  } else text = `Трасса готова: ${c.placed} ${elementsWord(c.placed)}`;
  p.textContent = text;
  p.className = `form-status ${kind}`;
}

let toastTimer = 0;
function toast(text, ms = 2800) {
  const t = $('toast');
  t.textContent = text;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), ms);
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
  const { hits } = drawScene(ctx, state.course, state.camera, W, H, { selected: state.selected, sheet: state.sheet, riders: state.ride?.poses ?? [], zones: showZones });
  ctx.globalAlpha = 1;
  state.hits = hits;
}

new ResizeObserver(() => invalidate()).observe(canvas);

// Reserved zones on the plan and in 3D: on by default, remembered per viewer.
let showZones = loadZones();

function renderZonesButton() {
  $('zones').setAttribute('aria-pressed', String(showZones));
}

function toggleZones() {
  showZones = !showZones;
  saveZones(showZones);
  renderZonesButton();
  invalidate();
}

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
// Mouse: the left button drags like one finger; the right or middle button, or
// Shift with the left, pans in either view; the wheel or a trackpad pinch zooms.
canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  const panButton = e.pointerType === 'mouse' && (e.button === 1 || e.button === 2 || e.shiftKey);
  if (panButton) e.preventDefault();
  if (pointers.size === 1) gesture = { kind: panButton ? 'pan' : 'one', x: e.clientX, y: e.clientY, ox: e.clientX, oy: e.clientY, moved: false };
  else if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    gesture = { kind: 'two', dist: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
  }
});
canvas.addEventListener('pointermove', (e) => {
  if (!pointers.has(e.pointerId) || !gesture) {
    if (e.pointerType === 'mouse') updateCursor(e);
    return;
  }
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  const cam = state.camera;
  if (gesture.kind === 'pan') {
    canvas.style.cursor = 'grabbing';
    cam.panX += e.clientX - gesture.x;
    cam.panY += e.clientY - gesture.y;
    gesture.x = e.clientX;
    gesture.y = e.clientY;
    invalidate();
  } else if (gesture.kind === 'one') {
    const dx = e.clientX - gesture.x;
    const dy = e.clientY - gesture.y;
    if (Math.hypot(e.clientX - gesture.ox, e.clientY - gesture.oy) > 6) gesture.moved = true;
    if (!gesture.moved) return;
    if (e.pointerType === 'mouse') canvas.style.cursor = 'grabbing';
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
  if (e.pointerType === 'mouse') updateCursor(e);
};
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  const rect = canvas.getBoundingClientRect();
  // Firefox reports a mouse wheel in lines; a trackpad pinch arrives as a wheel with ctrlKey.
  const dy = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? rect.height : 1);
  zoomBy(Math.exp(-dy * (e.ctrlKey ? 0.01 : 0.0015)), e.clientX - rect.left, e.clientY - rect.top);
}, { passive: false });
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('pointerleave', () => (canvas.style.cursor = ''));

/** Under a mouse: a pointer over an element that a click would open, else a hand. */
function updateCursor(e) {
  const rect = canvas.getBoundingClientRect();
  const clickable = state.course && state.setupStep === null && !state.ride?.playing && hitTest(state.hits, e.clientX - rect.left, e.clientY - rect.top);
  canvas.style.cursor = clickable ? 'pointer' : 'grab';
}

function onTap(x, y) {
  if (!state.course || state.setupStep !== null || state.ride?.playing) return;
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
  return `<span class="dot ${cone.color}" title="${title}" aria-hidden="true">${letter}</span><span class="sr-only">${title}</span>`;
}

const LONG_TABLE = 16;

function coneTable(card, big = false) {
  const diag = card.axis.diagonal;
  const head = diag ? '<th>№</th><th>конус</th><th>ΔX</th><th>ΔY</th>' : '<th>№</th><th>конус</th><th>вдоль</th><th>поперёк</th>';
  const rows = card.cones.map((c) => {
    const a = diag ? c.dx : c.along;
    const b = diag ? c.dy : c.across;
    return `<tr><td>${c.n}</td><td>${coneDot(c)}</td><td>${fmt(a)} м</td><td>${fmt(b)} м</td></tr>`;
  }).join('');
  const note = diag ? '' : '<p class="muted">поперёк: «+» — влево от направления оси</p>';
  const table = `<table class="cones${big ? ' big' : ''}"><tr>${head}</tr>${rows}</table>${note}`;
  // A snail has some eighty cones: the table is there, but folded.
  return card.cones.length > LONG_TABLE ? `<details class="cones-fold"><summary>Таблица конусов: ${card.cones.length} шт.</summary>${table}</details>` : table;
}

function cardHtml(card, big = false) {
  return `<h3>${card.number}. ${esc(card.name)}</h3>
    <p class="anchor${big ? ' big' : ''}">Якорь: X ${fmt(card.anchor.x)} м · Y ${fmt(card.anchor.y)} м</p>
    ${card.fromPrevious ? `<p class="from-previous">${esc(card.fromPrevious.label)}</p>` : ''}
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
  // Frame the element in the part of the stage the card leaves free: beside it on
  // a wide screen, above it on a phone.
  if (wide.matches) {
    frameBounds(state.camera, canvas.clientWidth, canvas.clientHeight, state.course.site, elementBounds(id), { top: 60, bottom: 60, left: 80, right: box.offsetWidth + 16 });
  } else {
    const free = Math.max(120, canvas.clientHeight - box.offsetHeight - 10);
    frameBounds(state.camera, canvas.clientWidth, canvas.clientHeight, state.course.site, elementBounds(id), { top: 60, bottom: canvas.clientHeight - free + 16 });
  }
  invalidate();
}

function hideElementCard() {
  $('element-card').hidden = true;
}

/** The element's zone, and the previous anchor its own is measured from. */
function elementBounds(id) {
  const e = state.course.elements.find((x) => x.id === id);
  const points = [...e.zone];
  const step = state.sheet.cards.find((c) => c.element === id).fromPrevious;
  if (step) {
    // With room for the chain's labels, which sit on the outside of the L.
    const { anchor } = state.sheet.cards.find((c) => c.number === step.from);
    points.push([anchor.x - 2, anchor.y - 2], [anchor.x + 2, anchor.y + 2]);
  }
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

/** Frames bounds in the part of the stage the view controls at the top leave free. */
function frameInSetup(bounds) {
  const top = document.querySelector('.view-toggle').getBoundingClientRect().bottom - canvas.getBoundingClientRect().top;
  frameBounds(state.camera, canvas.clientWidth, canvas.clientHeight, state.course.site, bounds, { top: top + 8, bottom: 16 });
}

function focusElement(id) {
  frameInSetup(elementBounds(id));
}

function setupSteps() {
  const steps = [{ kind: 'start' }, ...state.sheet.cards.map((card) => ({ kind: 'element', card }))];
  if (state.sheet.shape !== 'closed') steps.push({ kind: 'finish' });
  return steps;
}

function terminalHtml(t, title) {
  const cones = t.cones.map((c) => `<tr><td>${coneDot({ height: 'low', color: 'neutral' })}</td><td>X ${fmt(c.x)} м</td><td>Y ${fmt(c.y)} м</td></tr>`).join('');
  const near = t.fromStart ? `<p><b>Финиш у старта:</b> ${esc(t.fromStart.label.replace('От', 'от'))}</p>` : '';
  return `<h3>${title}</h3><p class="muted">Два низких конуса, линия поперёк проезда (${esc(t.travel)})</p>${near}
    <table class="cones big"><tr><th></th><th>X от опорного угла A</th><th>Y от опорного угла A</th></tr>${cones}</table>`;
}

function renderSetup() {
  const steps = setupSteps();
  const step = steps[state.setupStep];
  const body = $('setup-body');
  const counter = `<p class="step-counter"><b>Шаг ${state.setupStep + 1} из ${steps.length}</b><span class="muted"> · конусов: синих ${state.sheet.coneList.tallBlue}, красных ${state.sheet.coneList.tallRed}, низких ${state.sheet.coneList.low}</span></p>`;
  if (step.kind === 'element') {
    body.innerHTML = counter + cardHtml(step.card, true);
    state.selected = step.card.element;
    focusElement(step.card.element);
  } else {
    const t = step.kind === 'start' ? state.sheet.start : state.sheet.finish;
    body.innerHTML = counter + terminalHtml(t, step.kind === 'start' ? (state.sheet.shape === 'closed' ? 'Старт и финиш' : 'Старт') : 'Финиш');
    state.selected = null;
    const xs = t.cones.map((c) => c.x);
    const ys = t.cones.map((c) => c.y);
    frameInSetup([Math.min(...xs) - 4, Math.min(...ys) - 4, Math.max(...xs) + 4, Math.max(...ys) + 4]);
  }
  $('setup-prev').disabled = state.setupStep === 0;
  $('setup-next').textContent = state.setupStep === steps.length - 1 ? 'Готово' : 'Дальше';
  invalidate();
}

function setupPrev() {
  if (state.setupStep !== null && state.setupStep > 0) {
    state.setupStep--;
    renderSetup();
  }
}

function setupNext() {
  if (state.setupStep === null) return;
  if (state.setupStep < setupSteps().length - 1) {
    state.setupStep++;
    renderSetup();
  } else exitSetup();
}

function enterSetup() {
  if (state.requestId !== state.shownId) {
    state.setupWanted = true; // enter once the course being generated is shown
    return;
  }
  if (!state.course || state.stale) return;
  stopRide();
  hideElementCard();
  $('toast').hidden = true; // it would cover the step's anchor
  state.setupStep = 0;
  $('stage').classList.add('in-setup');
  $('dock').hidden = true;
  $('setup-panel').hidden = false;
  applyLayout();
  requestAnimationFrame(renderSetup);
}

function exitSetup() {
  state.setupStep = null;
  state.selected = null;
  $('stage').classList.remove('in-setup');
  $('dock').hidden = false;
  $('setup-panel').hidden = true;
  applyLayout();
  resetCamera(state.camera);
  invalidate();
}

// ---------------------------------------------------------------- ride

// In «паровозик» a column of riders this far apart rides the route.
const TRAIN_RIDERS = 3;
const TRAIN_SPACING = 8; // metres of route

// Playback speeds of the ride, cycled by the speed button. Only time runs
// faster: the riders still lean as they would at RIDE_SPEED.
const RIDE_SPEEDS = [1, 2, 4];
let rideSpeed = RIDE_SPEEDS.includes(loadRideSpeed()) ? loadRideSpeed() : 1;

function cycleRideSpeed() {
  rideSpeed = RIDE_SPEEDS[(RIDE_SPEEDS.indexOf(rideSpeed) + 1) % RIDE_SPEEDS.length];
  saveRideSpeed(rideSpeed);
  renderSpeedButton();
}

/** Shown only while a ride is on, when the camera is close in and the button covers nothing of the plan. */
function renderSpeedButton() {
  const b = $('ride-speed');
  b.hidden = !state.ride;
  b.textContent = `${rideSpeed}×`;
  b.setAttribute('aria-label', `Скорость проезда ${rideSpeed}×`);
}

/** The riders on the course when the leader is s metres along: only those between start and finish. */
function ridePoses(r) {
  const poses = [];
  for (let k = 0; k < r.riders; k++) {
    const s = r.s - k * TRAIN_SPACING;
    if (s >= 0 && s <= r.track.length) poses.push({ ...rideAt(r.track, s), rider: k });
  }
  return poses;
}

/** The camera follows the middle of the column, clamped to the route. */
const rideFocus = (r) => rideAt(r.track, Math.max(0, Math.min(r.track.length, r.s - ((r.riders - 1) / 2) * TRAIN_SPACING)));

/**
 * «Проезд»: a schematic motorcycle (in «паровозик», a column of three) rides the
 * route at a set speed in the 3D view, the camera following it a little zoomed
 * in. Pause keeps its place; after the finish the next tap starts over.
 */
function toggleRide() {
  if (!state.course || state.stale) return;
  if (state.ride?.playing) return pauseRide();
  if (state.setupStep !== null) exitSetup();
  state.selected = null;
  hideElementCard();
  if (state.camera.mode !== 'angle') setView('angle');
  if (!state.ride || state.ride.s >= rideEnd(state.ride)) {
    const track = buildRide(state.course);
    state.ride = { track, riders: state.course.recipe.train ? TRAIN_RIDERS : 1, s: 0 };
    state.ride.poses = ridePoses(state.ride);
    // About 18 m of the course around the rider fills the stage.
    const { x, y } = rideFocus(state.ride);
    frameBounds(state.camera, canvas.clientWidth, canvas.clientHeight, state.course.site, [x - 9, y - 9, x + 9, y + 9]);
  }
  state.ride.playing = true;
  state.ride.last = performance.now();
  renderRideButton();
  requestAnimationFrame(rideFrame);
}

/** The leader's distance at which the last rider of the column has finished. */
const rideEnd = (r) => r.track.length + (r.riders - 1) * TRAIN_SPACING;

function rideFrame(now) {
  const r = state.ride;
  if (!r?.playing) return;
  r.s = Math.min(rideEnd(r), r.s + RIDE_SPEED * rideSpeed * Math.min(0.1, (now - r.last) / 1000));
  r.last = now;
  r.poses = ridePoses(r);
  const focus = rideFocus(r);
  centreOn(state.camera, canvas.clientWidth, canvas.clientHeight, state.course.site, focus.x, focus.y);
  if (r.s >= rideEnd(r)) {
    r.playing = false;
    renderRideButton();
  } else requestAnimationFrame(rideFrame);
  invalidate();
}

function pauseRide() {
  if (!state.ride?.playing) return;
  state.ride.playing = false;
  renderRideButton();
}

function stopRide() {
  if (!state.ride) return;
  state.ride = null;
  renderRideButton();
  invalidate();
}

function renderRideButton() {
  const r = state.ride;
  const b = $('ride');
  b.setAttribute('aria-pressed', String(!!r?.playing));
  b.textContent = r?.playing ? '❚❚ Пауза' : r && r.s > 0 && r.s < rideEnd(r) ? '▶ Дальше' : '▶ Проезд';
  renderSpeedButton();
}

// ---------------------------------------------------------------- picture

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

/** The setup sheet as numbered 9:16 PNG files, in the order they are read. */
async function buildImageFiles() {
  const canvases = renderSheetImages(state.course, state.sheet, makeCanvas);
  return Promise.all(canvases.map(async (c, i) => {
    const blob = await new Promise((resolve) => c.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('png');
    return new File([blob], `motogymkhana-skhema-${i + 1}-iz-${canvases.length}.png`, { type: 'image/png' });
  }));
}

let imageTimer = 0;
function prepareImageSoon() {
  // Prepared ahead so «Картинка» shows its frames straight away.
  clearTimeout(imageTimer);
  const id = state.shownId;
  imageTimer = setTimeout(async () => {
    try {
      const files = await buildImageFiles();
      if (state.shownId === id && state.course) state.image = { id, files };
    } catch {
      // Built on demand at tap time instead.
    }
  }, 500);
}

function download(files) {
  // One after another: browsers drop several downloads started in the same instant.
  files.forEach((file, i) => setTimeout(() => {
    const url = URL.createObjectURL(file);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.name;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }, i * 400));
}

const framesWord = (n) => (n % 10 === 1 && n % 100 !== 11 ? 'кадр' : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100) ? 'кадра' : 'кадров');
const canShareFiles = (files) => !!(navigator.canShare && navigator.canShare({ files }));

async function shareFiles(files) {
  try {
    await navigator.share({ files });
  } catch (e) {
    // Cancelling the share sheet is not an error.
    if (e && e.name !== 'AbortError') $('picture-status').textContent = 'Не удалось открыть «Поделиться». Скачайте кадры по одному';
  }
}

/**
 * «Картинка» opens a preview of every frame. Each frame is saved by its own
 * link, which no browser drops, and all of them are shared at once where the
 * device can share files. Opening the system share sheet straight from the
 * button gave desktop browsers no way to save, and a share started after the
 * frames were drawn had lost the tap and fell back to downloads browsers block.
 */
let pictureOpener = null;
let pictureUrls = [];

async function openPicture() {
  if (!state.course || state.stale) {
    toast('Сначала нужна трасса');
    return;
  }
  pauseRide();
  $('toast').hidden = true;
  pictureOpener = document.activeElement;
  for (const id of BEHIND_PICTURE) $(id).inert = true;
  $('backdrop').hidden = false;
  $('picture-sheet').hidden = false;
  $('picture-sheet').focus({ preventScroll: true });
  const id = state.shownId;
  let files = state.image?.id === id ? state.image.files : null;
  if (!files) {
    renderFrames(null);
    try {
      files = await buildImageFiles();
    } catch {
      $('picture-status').textContent = 'Не удалось нарисовать картинку. Закройте и попробуйте ещё раз';
      return;
    }
    if (state.shownId !== id || $('picture-sheet').hidden) return;
    state.image = { id, files };
  }
  renderFrames(files);
}

function renderFrames(files) {
  for (const url of pictureUrls) URL.revokeObjectURL(url);
  pictureUrls = [];
  const list = $('frames');
  list.replaceChildren();
  $('picture-actions').hidden = !files;
  if (!files) {
    $('picture-title').textContent = 'Картинка';
    $('picture-status').textContent = 'Рисую кадры…';
    return;
  }
  const n = files.length;
  $('picture-title').textContent = `Картинка · ${n} ${framesWord(n)}`;
  $('picture-status').textContent = '';
  files.forEach((file, i) => {
    const url = URL.createObjectURL(file);
    pictureUrls.push(url);
    const item = document.createElement('li');
    item.className = 'frame';
    const img = document.createElement('img');
    img.src = url;
    img.alt = `Кадр ${i + 1} из ${n}: ${i === 0 ? 'план трассы, легенда и ведомость конусов' : 'карточки элементов'}`;
    const caption = document.createElement('p');
    caption.className = 'muted';
    caption.textContent = `Кадр ${i + 1} из ${n}`;
    const row = document.createElement('div');
    row.className = 'row';
    const save = document.createElement('a');
    save.className = 'button';
    save.href = url;
    save.download = file.name;
    save.textContent = 'Скачать';
    save.setAttribute('aria-label', `Скачать кадр ${i + 1} из ${n}`);
    row.append(save);
    if (canShareFiles([file])) {
      const send = document.createElement('button');
      send.type = 'button';
      send.textContent = 'Поделиться';
      send.setAttribute('aria-label', `Поделиться кадром ${i + 1} из ${n}`);
      send.addEventListener('click', () => shareFiles([file]));
      row.append(send);
    }
    item.append(img, caption, row);
    list.append(item);
  });
  $('share-all').hidden = n < 2 || !canShareFiles(files);
  $('download-all').hidden = n < 2;
  $('picture-actions').hidden = n < 2;
}

function closePicture() {
  document.activeElement?.blur?.();
  for (const id of BEHIND_PICTURE) $(id).inert = false;
  $('backdrop').hidden = true;
  $('picture-sheet').hidden = true;
  renderFrames(null);
  pictureOpener?.focus?.({ preventScroll: true });
  pictureOpener = null;
}

// ---------------------------------------------------------------- sheet (form panel)

// The form is modal: everything behind it is inert while it is open, and focus
// returns to whatever opened it.
// On a wide screen the form is not modal: it is docked beside the stage and
// always open, so «Рецепт» only moves focus into it.
const BEHIND_FORM = ['stage', 'dock', 'setup-panel'];
const BEHIND_PICTURE = [...BEHIND_FORM, 'form-sheet'];
let formOpener = null;
let formOpen = false; // open as a modal sheet
function openForm() {
  if (wide.matches) {
    if (state.setupStep !== null) exitSetup();
    form.width.focus();
    return;
  }
  pauseRide();
  $('toast').hidden = true; // the form's status line says the same, and the toast would sit on the form
  formOpen = true;
  formOpener = document.activeElement;
  for (const id of BEHIND_FORM) $(id).inert = true;
  $('backdrop').hidden = false;
  $('form-sheet').hidden = false;
  $('form-sheet').focus({ preventScroll: true });
}
function closeForm() {
  if (!formOpen) return;
  formOpen = false;
  document.activeElement?.blur?.();
  for (const id of BEHIND_FORM) $(id).inert = false;
  $('backdrop').hidden = true;
  $('form-sheet').hidden = true;
  onFormChange(true);
  formOpener?.focus?.({ preventScroll: true });
  formOpener = null;
}
/** «Готово»: closes a valid form; otherwise shows the errors and focuses the first one. */
function submitForm() {
  const v = validate(readForm());
  if (v.ok) return closeForm();
  onFormChange(true);
  const first = ['width', 'length', 'elements', 'seed'].find((name) => v.errors[name]);
  if (first) form[first].focus();
  else form.querySelector('summary').focus();
}

/** Docks the form beside the stage on a wide screen, or makes it the modal sheet again. */
function applyLayout() {
  const sheet = $('form-sheet');
  if (wide.matches) {
    if (formOpen) {
      // The open sheet becomes the docked form; what was behind it comes back.
      formOpen = false;
      formOpener = null;
      for (const id of BEHIND_FORM) $(id).inert = false;
      $('backdrop').hidden = $('picture-sheet').hidden;
    }
    sheet.hidden = state.setupStep !== null;
    sheet.setAttribute('role', 'region');
    sheet.removeAttribute('aria-modal');
    sheet.removeAttribute('tabindex');
  } else {
    sheet.hidden = !formOpen;
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('aria-modal', 'true');
    sheet.tabIndex = -1;
  }
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
  const behavior = matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
  if (e.target.matches('input') && !wide.matches) setTimeout(() => e.target.scrollIntoView({ block: 'center', behavior }), 250);
});

// ---------------------------------------------------------------- wiring

function start() {
  buildTypeChecks();
  const saved = loadForm();
  const initial = { ...DEFAULT_FORM, ...(saved ?? {}), shape: savedShape(saved), types: savedTypes(saved) };
  delete initial.knownTypes;
  delete initial.closed;
  writeForm(initial);
  state.form = readForm();

  form.addEventListener('input', () => onFormChange());
  form.train.addEventListener('change', syncTypes);
  form.addEventListener('change', syncSizes);
  for (const r of form.querySelectorAll('[name="difficulty"]')) r.addEventListener('change', syncTypes);
  for (const r of form.querySelectorAll('[name="shape"]')) r.addEventListener('change', syncShapeHint);
  form.addEventListener('change', () => onFormChange());
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    submitForm();
  });
  $('form-sheet').addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeForm();
  });
  form.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.matches('input')) {
      e.preventDefault();
      // A phone hides its keyboard; at a desk the cursor stays in the field.
      if (!wide.matches) e.target.blur();
      onFormChange(true);
    }
  });
  document.addEventListener('keydown', onShortcut);
  for (const b of form.querySelectorAll('[data-step]')) {
    b.addEventListener('click', () => {
      const n = Number.parseInt(form.elements.value, 10);
      const next = Math.max(1, Math.min(15, (Number.isFinite(n) ? n : 8) + Number(b.dataset.step)));
      form.elements.value = String(next);
      onFormChange();
    });
  }
  $('form-new-seed').addEventListener('click', newSeed);
  $('close-form').addEventListener('click', submitForm);
  $('backdrop').addEventListener('click', () => ($('picture-sheet').hidden ? closeForm() : closePicture()));
  $('open-form').addEventListener('click', openForm);
  $('summary').addEventListener('click', openForm);
  $('new-seed').addEventListener('click', newSeed);
  $('prev-seed').addEventListener('click', previousSeed);
  $('form-x').addEventListener('click', closeForm);
  $('toast').addEventListener('click', () => ($('toast').hidden = true));
  $('setup-mode').addEventListener('click', enterSetup);
  $('setup-close').addEventListener('click', exitSetup);
  $('setup-prev').addEventListener('click', setupPrev);
  $('setup-next').addEventListener('click', setupNext);
  // Keyboard: arrows step through «Расстановка», Escape leaves it or closes the element card.
  document.addEventListener('keydown', (e) => {
    if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
    // A docked recipe (wide screen) is not in the way; only the modal sheets are.
    if (formOpen || !$('picture-sheet').hidden || e.target.matches?.('input')) return;
    if (state.setupStep !== null) {
      if (e.key === 'ArrowRight') setupNext();
      else if (e.key === 'ArrowLeft') setupPrev();
      else if (e.key === 'Escape') exitSetup();
      else return;
      e.preventDefault();
    } else if (e.key === 'Escape' && !$('element-card').hidden) {
      state.selected = null;
      hideElementCard();
      invalidate();
    }
  });
  $('share').addEventListener('click', openPicture);
  $('close-picture').addEventListener('click', closePicture);
  $('picture-sheet').addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closePicture();
  });
  $('share-all').addEventListener('click', () => shareFiles(state.image.files));
  $('download-all').addEventListener('click', () => download(state.image.files));
  $('ride').addEventListener('click', toggleRide);
  $('ride-speed').addEventListener('click', cycleRideSpeed);
  renderSpeedButton();
  $('zones').addEventListener('click', toggleZones);
  renderZonesButton();
  for (const b of document.querySelectorAll('[data-view]')) b.addEventListener('click', () => setView(b.dataset.view));
  $('zoom-in').addEventListener('click', () => zoomBy(1.25));
  $('zoom-out').addEventListener('click', () => zoomBy(1 / 1.25));
  $('zoom-fit').addEventListener('click', () => {
    state.selected = null;
    hideElementCard();
    resetCamera(state.camera);
    invalidate();
  });

  wide.addEventListener('change', () => {
    applyLayout();
    if (state.selected && state.setupStep === null) selectElement(state.selected);
  });
  applyLayout();

  renderSummary();
  onFormChange(true);
}

/** Keyboard zoom on a computer: + − and 0 for the whole course (arrows and Esc are handled in start()). */
function onShortcut(e) {
  if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
  if (!$('backdrop').hidden) return; // a modal sheet is open
  if (e.target.closest?.('input, textarea, select, summary, details')) return;
  const click = (id) => {
    if ($(id).disabled || $(id).closest('[hidden]')) return;
    e.preventDefault();
    $(id).click();
  };
  switch (e.key) {
    case '+': case '=': return click('zoom-in');
    case '-': case '−': return click('zoom-out');
    case '0': return click('zoom-fit');
    case 'z': case 'Z': case 'я': case 'Я': return click('zones');
  }
}

start();

