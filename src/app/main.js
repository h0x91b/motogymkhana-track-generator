import {
  BIG_ELEMENT_AREA, canonicalJSON, ELEMENT_TYPES, LOOPED_TYPES, parseLayout, parseRecipe, parseSeed, problemsWord, routeLayout, SAFETY_OPTIONS, safetyValues,
  SHAPE_NAMES, SIZE_OPTIONS, sizeDefault, sizeMinimum, sizeValues, TYPE_NAMES,
} from '../generator/index.js';
import { conesCsv, courseDocument, courseFileName, courseFileText, readCourseFile } from '../file/course-file.js';
import { buildSetupSheet, dist, fmt } from '../sheet/setup-sheet.js';
import { centreOn, createCamera, drawScene, frameBounds, hitTest, makeProjector, resetCamera } from '../render/scene.js';
import { buildRide, RIDE_SPEED, rideAt } from '../render/ride.js';
import { renderSheetImages } from '../render/sheet-image.js';
import { createEditor } from './editor.js';
import { createGenerator } from './generator-client.js';
import { loadEdit, loadForm, loadRideSpeed, loadZones, saveEdit, saveForm, saveRideSpeed, saveZones } from './storage.js';

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
  width: '40', length: '60', elements: '8', difficulty: 'hard', bike: 'cruiser', shape: 'closed', train: true, seed: '1', types: [...ELEMENT_TYPES], sizes: {}, safety: {},
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
  courseForm: null, // the form that course was generated from
  courseRev: 0, // counts every change of the shown course, edits included
  generated: null, // the shown course as the generator made it, before any edits
  problems: [], // what an edited course has wrong (generator/layout.js)
  marks: null, // the same, as the sets the renderer marks in red
  adopt: null, // an edited layout to put back once the course it was made from is generated
  opening: null, // { name, edited, layout, kept }: a course file being opened, until its course is generated
  sheet: null,
  stale: false,
  selected: null,
  setupStep: null,
  setupWanted: false, // «Расстановка» tapped while a course was still being generated
  editWanted: false, // the same for «Правка»
  ride: null, // { track, riders, s, poses, playing, last } while schematic riders are on the course
  camera: createCamera(),
  hits: [],
  view: null, // the projection of the last frame drawn: where a finger on the plan points
  requestId: 0,
  shownId: 0,
  image: null, // { id, files } — the setup-sheet frames, prepared ahead of a share tap
  // What «↶» brings back, newest last: seeds «Новый seed» replaced, and edited
  // courses a new one replaced, as { layout, form }.
  seedHistory: [],
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

const safetyName = (key) => `safety:${key}`;
const SAFETY_NOTES = {
  runOff: 'Вокруг разворотов и петель, чтобы выехать, если занесло шире. Обычно 5 м.',
  pad: 'Вокруг конусов и линии езды элемента: туда не заходят ни другие элементы, ни связки. Обычно 0,75 м.',
  coneGap: 'Вокруг высокого конуса на развороте связки: ни зона, ни другая связка ближе не подходят. Обычно 1,5 м.',
  trainGap: 'В паровозике маршрут не подходит к себе ближе: мотоциклы колонны не встретятся. Обычно 2 м.',
  edge: 'От края площадки до конусов — бордюр, разметка, столбы. Обычно 1 м.',
};

/** The «Безопасность» group: per rule, its value in steps, the default marked. */
function buildSafety() {
  $('safety').innerHTML = SAFETY_OPTIONS.map((o) => `<fieldset class="size-option safety-option" data-key="${o.key}">
      <legend>${o.name}</legend>
      <div class="chips">
        ${safetyValues(o).map((v) => `<label><input type="radio" name="${safetyName(o.key)}" value="${v}"${v === o.default ? ' checked' : ''}><span${v === o.default ? ' class="default"' : ''}>${v === 0 ? 'нет' : fmt(v)}</span></label>`).join('')}
      </div>
      <p class="muted safety-note">${SAFETY_NOTES[o.key]}</p>
    </fieldset>`).join('');
}

/** Safety values from the form, numbers in metres; the recipe keeps the ones off their defaults. */
function readSafety() {
  const safety = {};
  for (const o of SAFETY_OPTIONS) {
    const v = form.querySelector(`[name="${safetyName(o.key)}"]:checked`)?.value;
    if (v !== undefined) safety[o.key] = Number(v);
  }
  return safety;
}

/** The safety summary toggle says what is off its default, so a narrowed course is never a surprise. */
function syncSafety() {
  const set = SAFETY_OPTIONS.filter((o) => {
    const v = form.querySelector(`[name="${safetyName(o.key)}"]:checked`)?.value;
    return v !== undefined && Number(v) !== o.default;
  });
  form.querySelector('#safety-details summary').textContent = set.length
    ? `Безопасность: изменено ${set.length} из ${SAFETY_OPTIONS.length}`
    : 'Ещё: безопасность — свободное место вокруг';
  form.querySelector('#safety-details summary').classList.toggle('set', set.length > 0);
  form.querySelector('.safety-option[data-key="trainGap"]').hidden = !form.train.checked;
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
      + `${LOOPED_TYPES.includes(t) ? '<span class="train-off"> — не в паровозике</span>' : ''}</span>`;
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
 * «паровозик»: say so on the boxes. The difficulty leaves every type in.
 */
function syncTypes() {
  const train = form.train.checked;
  $('train-hint').hidden = !train;
  for (const t of ELEMENT_TYPES) {
    form.querySelector(`[name="types"][value="${t}"]`).disabled = train && LOOPED_TYPES.includes(t);
  }
  for (const s of form.querySelectorAll('.train-off')) s.hidden = !train;
  syncSizes();
  syncSafety();
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
  for (const o of SAFETY_OPTIONS) {
    const value = f.safety?.[o.key] ?? o.default;
    const input = form.querySelector(`[name="${safetyName(o.key)}"][value="${value}"]`) ?? form.querySelector(`[name="${safetyName(o.key)}"][value="${o.default}"]`);
    input.checked = true;
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
    safety: readSafety(),
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
  if (errors.safety) $('safety-details').open = true;
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
      state.opening = null;
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

const generator = createGenerator(({ id, result: generated }) => {
  let result = generated;
  if (id !== state.requestId) return; // a newer request is on its way
  state.shownId = id;
  const opening = state.opening;
  state.opening = null;
  // A file holds its elements: if this build cannot generate a course for its
  // recipe and seed any more, the file's course is still shown as it was saved.
  const unbuilt = !result.ok && result.error.code !== 'invalid-input' && !!opening?.layout;
  let unbuiltProblems = [];
  if (unbuilt) {
    const { course, problems } = routeLayout(opening.layout);
    unbuiltProblems = problems;
    result = { ok: true, course: { ...course, requested: opening.layout.recipe.elements, placed: opening.layout.elements.length } };
  }
  const wanted = state.setupWanted;
  const editWanted = state.editWanted;
  state.setupWanted = false;
  state.editWanted = false;
  if (!result.ok) {
    if (result.error.code === 'invalid-input') {
      showErrors(result.error.fields);
      showBanner('Исправьте ошибки в форме', 'error');
    } else {
      if (editor.active) exitEdit();
      state.course = null;
      state.sheet = null;
      setProblems([]);
      showBanner(result.error.message, 'error');
    }
    state.image = null;
    renderSummary();
    invalidate();
    return;
  }
  const course = result.course;
  const key = canonicalJSON({ recipe: course.recipe, seed: course.seed });
  const same = !!state.course && key === state.courseKey;
  // Edits made to this very recipe and seed go back on top of the course: kept
  // from the last visit, brought back by «↶», or on screen behind a form error.
  // An opened file brings its own course, edited or not.
  const adopt = state.adopt && layoutKey(state.adopt) === key ? state.adopt : same && editor.edited && !opening ? editor.layout : null;
  state.adopt = null;
  // Same recipe and seed is the same course: keep the view, selection and setup step.
  if (same && !state.stale && (!adopt || adopt === editor.layout) && !(opening && editor.edited)) {
    if (opening) toast(openedText(opening, { unbuilt, replaced: false }), 6000);
    renderSummary();
    if (wanted) enterSetup();
    if (editWanted) enterEdit();
    return;
  }
  // An edited course gives way to the new one; «↶» brings it back.
  const replaced = !same && !!state.course && editor.edited;
  if (replaced) {
    state.seedHistory.push({ layout: editor.layout, form: state.courseForm });
    if (state.seedHistory.length > SEED_HISTORY) state.seedHistory.shift();
    renderSeedBack();
  }
  if (editor.active) exitEdit();
  state.courseKey = key;
  state.courseForm = { ...state.form };
  stopRide();
  state.generated = course;
  const shown = editor.load(course, adopt);
  state.course = shown.course;
  setProblems(unbuilt ? unbuiltProblems : shown.problems);
  state.sheet = buildSetupSheet(shown.course);
  state.courseRev++;
  saveEdit(editor.edited ? editor.layout : null);
  state.stale = false;
  state.selected = null;
  state.image = null;
  hideElementCard();
  if (state.setupStep !== null) exitSetup();
  resetCamera(state.camera);
  // The count stays in the summary; the hint only needs to be seen once.
  hideBanner();
  // Not over the open form: the form says it in its own status line.
  if (opening) toast(openedText(opening, { unbuilt, replaced }), 9000);
  else if (replaced) toast('Трасса с правками заменена новой. «↶» вернёт её', 6000);
  else if (!editor.edited && course.placed < course.requested && $('form-sheet').hidden) toast(shortfallText(course), 6000);
  renderSummary();
  invalidate();
  prepareImageSoon();
  if (wanted) enterSetup();
  if (editWanted) enterEdit();
});

const layoutKey = (layout) => canonicalJSON({ recipe: layout.recipe, seed: layout.seed });

function setProblems(problems) {
  state.problems = problems;
  state.marks = problems.length
    ? { elements: new Set(problems.flatMap((p) => p.elements)), connectors: new Set(problems.map((p) => p.connector).filter((c) => c !== null)) }
    : null;
}

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
  // An edited course goes into the history whole, when the new one replaces it.
  if (!editor.edited && parseSeed(previous).ok && state.seedHistory.at(-1) !== previous) {
    state.seedHistory.push(previous);
    if (state.seedHistory.length > SEED_HISTORY) state.seedHistory.shift();
  }
  form.seed.value = String(randomSeed());
  renderSeedBack();
  onFormChange(true);
}

/** «↶»: the course before the last «Новый seed», or the edited one a new course replaced, so a good one is never lost to a curious tap. */
function previousSeed() {
  const entry = state.seedHistory.pop();
  if (entry === undefined) return;
  if (typeof entry === 'string') form.seed.value = entry;
  else {
    writeForm(entry.form);
    state.adopt = entry.layout;
  }
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
  const parts = [{ text: `${f.width || '?'} × ${f.length || '?'} м` }];
  if (c && !state.stale && editor.edited) {
    // Edited by hand: the count is what stands on the site, and the seed alone no longer gives this course.
    parts.push({ text: `${c.elements.length} эл. с правками` });
    if (state.problems.length) parts.push({ text: problemsWord(state.problems.length), warn: true });
  } else if (c && !state.stale) {
    const count = c.limitedBy === 'big-elements' ? `${c.placed} из ${c.requested} эл.: большой один` : `влезло ${c.placed} из ${c.requested} эл.`;
    parts.push({ text: short ? count : `${c.placed} из ${c.requested} эл.`, warn: short });
    // Only a course opened from a file this build cannot generate has problems here.
    if (state.problems.length) parts.push({ text: problemsWord(state.problems.length), warn: true });
  }
  parts.push({ text: DIFFICULTY_NAMES[f.difficulty] ?? '' });
  parts.push({ text: BIKE_NAMES[f.bike] ?? '' });
  parts.push({ text: SHAPE_NAMES[f.shape] ?? '' });
  if (f.train) parts.push({ text: 'паровозик' });
  parts.push({ text: sizesSummary(f) });
  parts.push({ text: `seed ${f.seed || '—'}` });
  const shown = parts.filter((part) => part.text);
  const summary = $('summary');
  summary.replaceChildren(...shown.flatMap(({ text, warn }, i) => {
    const node = warn ? Object.assign(document.createElement('span'), { className: 'warn', textContent: text }) : document.createTextNode(text);
    return i ? [document.createTextNode(' · '), node] : [node];
  }));
  summary.setAttribute('aria-label', `${shown.map((part) => part.text).join(' · ')}. Открыть рецепт`);
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
  } else if (editor.edited) {
    text = `Трасса с правками: ${c.elements.length} ${elementsWord(c.elements.length)}${state.problems.length ? `, ${problemsWord(state.problems.length)}` : ''}`;
    kind = state.problems.length ? 'warn' : '';
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
  // While editing the zones are always on: they are what an element must keep clear of.
  const { hits, view } = drawScene(ctx, state.course, state.camera, W, H, {
    selected: state.selected, sheet: state.sheet, riders: state.ride?.poses ?? [], zones: showZones || editor.active, problems: state.marks, editing: editor.active,
  });
  ctx.globalAlpha = 1;
  state.hits = hits;
  state.view = view;
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
  if (state.selected && !editor.active) focusElement(state.selected);
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
// In «Правка» a finger on the selected element drags it instead; a mouse drags
// any element it presses, since it has other ways to pan.
const pointers = new Map();
let gesture = null;
const DRAG_FROM = 6; // px a pointer travels before a press becomes a drag

const canvasPoint = (e) => {
  const rect = canvas.getBoundingClientRect();
  return [e.clientX - rect.left, e.clientY - rect.top];
};
// Mouse: the left button drags like one finger; the right or middle button, or
// Shift with the left, pans in either view; the wheel or a trackpad pinch zooms.
canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  const panButton = e.pointerType === 'mouse' && (e.button === 1 || e.button === 2 || e.shiftKey);
  if (panButton) e.preventDefault();
  if (pointers.size === 1) {
    gesture = { kind: panButton ? 'pan' : 'one', x: e.clientX, y: e.clientY, ox: e.clientX, oy: e.clientY, moved: false };
    const id = !panButton && editor.active && state.view ? hitTest(state.hits, ...canvasPoint(e)) : null;
    if (id && (e.pointerType === 'mouse' || id === state.selected)) Object.assign(gesture, { kind: 'drag', id, from: state.view.unproject(...canvasPoint(e)) });
  } else if (pointers.size === 2) {
    // A second finger turns a drag into a pinch: the element stays where it got to.
    if (gesture?.kind === 'drag' && gesture.moved) editor.dragEnd();
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
  if (gesture.kind === 'drag') {
    if (!gesture.moved && Math.hypot(e.clientX - gesture.ox, e.clientY - gesture.oy) > DRAG_FROM) gesture.moved = editor.dragStart(gesture.id);
    if (!gesture.moved) return;
    canvas.style.cursor = 'grabbing';
    // Whole metres from where the finger went down: the anchor stays on the metre grid.
    const [x, y] = state.view.unproject(...canvasPoint(e));
    editor.dragBy(Math.round(x - gesture.from[0]), Math.round(y - gesture.from[1]));
  } else if (gesture.kind === 'pan') {
    canvas.style.cursor = 'grabbing';
    cam.panX += e.clientX - gesture.x;
    cam.panY += e.clientY - gesture.y;
    gesture.x = e.clientX;
    gesture.y = e.clientY;
    invalidate();
  } else if (gesture.kind === 'one') {
    const dx = e.clientX - gesture.x;
    const dy = e.clientY - gesture.y;
    if (Math.hypot(e.clientX - gesture.ox, e.clientY - gesture.oy) > DRAG_FROM) gesture.moved = true;
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
  if (gesture?.kind === 'drag' && gesture.moved) editor.dragEnd();
  else if ((gesture?.kind === 'one' || gesture?.kind === 'drag') && !gesture.moved && e.type === 'pointerup') onTap(...canvasPoint(e));
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
  const clickable = state.course && state.setupStep === null && !state.ride?.playing && hitTest(state.hits, ...canvasPoint(e));
  canvas.style.cursor = clickable ? (editor.active ? 'move' : 'pointer') : 'grab';
}

function onTap(x, y) {
  if (!state.course || state.setupStep !== null || state.ride?.playing) return;
  if (editor.active) return editor.select(hitTest(state.hits, x, y));
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
    return `<tr><td>${c.n}</td><td>${coneDot(c)}</td><td>${dist(a)} м</td><td>${dist(b)} м</td></tr>`;
  }).join('');
  const note = diag ? '' : '<p class="muted">поперёк: «+» — влево от направления оси</p>';
  const table = `<table class="cones${big ? ' big' : ''}"><tr>${head}</tr>${rows}</table>${note}`;
  // A snail has some eighty cones: the table is there, but folded.
  return card.cones.length > LONG_TABLE ? `<details class="cones-fold"><summary>Таблица конусов: ${card.cones.length} шт.</summary>${table}</details>` : table;
}

function cardHtml(card, big = false) {
  return `<h3>${card.number}. ${esc(card.name)}</h3>
    <p class="anchor${big ? ' big' : ''}">Якорь: X ${dist(card.anchor.x)} м · Y ${dist(card.anchor.y)} м</p>
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
  // The card's title shares its row with the way into «Правка» for this element.
  const head = Object.assign(document.createElement('div'), { className: 'card-head' });
  const edit = Object.assign(document.createElement('button'), { type: 'button', className: 'card-edit', textContent: 'Править' });
  edit.setAttribute('aria-label', `Править элемент ${card.number}`);
  edit.addEventListener('click', () => enterEdit(id));
  box.querySelector('h3').replaceWith(head);
  head.append(Object.assign(document.createElement('h3'), { textContent: `${card.number}. ${card.name}` }), edit);
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
  const cones = t.cones.map((c) => `<tr><td>${coneDot({ height: 'low', color: 'neutral' })}</td><td>X ${dist(c.x)} м</td><td>Y ${dist(c.y)} м</td></tr>`).join('');
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

// ---------------------------------------------------------------- edit mode

const editor = createEditor({
  /** The course as edited so far; while an element is dragged, only what the plan needs. */
  show(course, problems, { dragging = false } = {}) {
    const edited = editor.edited;
    // Edits undone all the way give the generated course back, with what it says about itself.
    state.course = edited ? course : state.generated;
    setProblems(edited ? problems : []);
    state.sheet = buildSetupSheet(state.course);
    state.selected = editor.selectedId;
    state.courseRev++;
    state.image = null;
    invalidate();
    if (dragging) return;
    saveEdit(edited ? editor.layout : null);
    renderSummary();
  },
  /** An element picked in the panel that is off the screen (zoomed in elsewhere) is panned into view; the zoom stays. */
  reveal(id) {
    const e = state.course.elements.find((x) => x.id === id);
    if (!e) return;
    const [x, y] = [(e.zone[0][0] + e.zone[2][0]) / 2, (e.zone[0][1] + e.zone[2][1]) / 2];
    const [W, H] = [canvas.clientWidth, canvas.clientHeight];
    const p = makeProjector(state.camera, W, H, state.course.site).project(x, y, 0);
    const edge = 48;
    if (p.x < edge || p.x > W - edge || p.y < edge || p.y > H - edge) centreOn(state.camera, W, H, state.course.site, x, y);
    invalidate();
  },
  leave: () => exitEdit(),
  /** The type picker is modal: what is behind it goes inert. */
  modal(open) {
    for (const id of BEHIND_PICKER) $(id).inert = open;
    $('backdrop').hidden = !open;
  },
});

/** «Правка»: the dock gives way to the edit panel; `id` is the element to start with. */
function enterEdit(id = null) {
  if (state.requestId !== state.shownId) {
    state.editWanted = true; // enter once the course being generated is shown
    return;
  }
  if (!state.course || state.stale) {
    toast('Сначала нужна трасса');
    return;
  }
  stopRide();
  hideElementCard();
  $('toast').hidden = true;
  $('stage').classList.add('in-edit');
  $('dock').hidden = true;
  $('edit-panel').hidden = false;
  editor.enter(id);
  applyLayout();
  ($('edit-body').querySelector('.chip[aria-pressed="true"]') ?? $('edit-body').querySelector('.chip')).focus({ preventScroll: true });
}

function exitEdit() {
  if (!editor.active) return;
  editor.leave();
  state.selected = null;
  $('stage').classList.remove('in-edit');
  $('dock').hidden = false;
  $('edit-panel').hidden = true;
  applyLayout();
  renderSummary();
  invalidate();
  prepareImageSoon();
  if (state.problems.length) toast(`На трассе ${problemsWord(state.problems.length)}: они отмечены красным. Исправьте их в «Правке»`, 6000);
  $('edit-mode').focus({ preventScroll: true });
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

// ---------------------------------------------------------------- course file

function fileStatus(text, kind = '') {
  const p = $('file-status');
  p.textContent = text;
  p.className = `form-status ${kind}`;
}

/** The shown course as a course file and as its cone list; null, with the reason shown, when there is none to save. */
function courseFiles() {
  if (!state.course || !editor.layout) {
    fileStatus('Сначала нужна трасса', 'error');
    return null;
  }
  if (state.stale) {
    fileStatus('Исправьте ошибки в форме: сохраняется трасса этого рецепта', 'error');
    return null;
  }
  const { layout } = editor;
  const doc = courseDocument(layout, { build: $('version').textContent.trim(), edited: editor.edited });
  return {
    json: new File([courseFileText(doc)], courseFileName(layout.recipe, layout.seed, 'json'), { type: 'application/json' }),
    csv: new File([conesCsv(state.course, state.sheet)], courseFileName(layout.recipe, layout.seed, 'csv'), { type: 'text/csv' }),
  };
}

/** Downloads one file right in the tap, so no browser takes it for an unasked download. */
function downloadNow(file) {
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function saveFile(kind) {
  const files = courseFiles();
  if (!files) return;
  downloadNow(files[kind]);
  // Whether it was saved only the browser knows: say what was handed to it.
  fileStatus(`Скачивание: ${files[kind].name}`);
}

async function shareFile(kind) {
  const files = courseFiles();
  if (!files) return;
  try {
    await navigator.share({ files: [files[kind]] });
    fileStatus('');
  } catch (e) {
    // Cancelling the share sheet is not an error.
    if (e && e.name !== 'AbortError') fileStatus('Не удалось открыть «Поделиться». Скачайте файл', 'error');
  }
}

/** «Отправить» only where the device shares files of that kind (Chrome on Android shares no .json). */
function renderFileButtons() {
  $('share-json').hidden = !canShareFiles([new File(['{}'], 'trassa.json', { type: 'application/json' })]);
  $('share-csv').hidden = !canShareFiles([new File([';'], 'konusy.csv', { type: 'text/csv' })]);
}

const FILE_MAX = 1_000_000; // bytes; a course file is a few kilobytes

async function onFilePicked() {
  const input = $('open-file');
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  if (file.size > FILE_MAX) {
    fileStatus('Это не файл трассы: он слишком большой', 'error');
    return;
  }
  let text;
  try {
    text = await file.text();
  } catch {
    fileStatus('Не удалось прочитать файл', 'error');
    return;
  }
  const read = readCourseFile(text);
  if (!read.ok) {
    fileStatus(read.error, 'error');
    return;
  }
  openCourse(read, file.name);
}

/** The form a recipe and seed are shown in: the recipe's own fields, so a field added to it travels too. */
const formOf = (recipe, seed) => ({ ...DEFAULT_FORM, ...recipe, seed: String(seed), sizes: recipe.sizes ?? {} });

/** Puts an opened course file on screen: its recipe and seed in the form, its elements on top of the course they give. */
function openCourse(read, name) {
  stopRide();
  if (state.setupStep !== null) exitSetup();
  if (editor.active) exitEdit();
  // Edits to this very recipe and seed would be lost without a trace: «↶» keeps them.
  const key = canonicalJSON({ recipe: read.recipe, seed: read.seed });
  const kept = editor.edited && key === state.courseKey && JSON.stringify(read.layout?.elements) !== JSON.stringify(editor.layout.elements);
  if (kept) {
    state.seedHistory.push({ layout: editor.layout, form: state.courseForm });
    if (state.seedHistory.length > SEED_HISTORY) state.seedHistory.shift();
    renderSeedBack();
  }
  writeForm(formOf(read.recipe, read.seed));
  state.adopt = read.layout;
  state.opening = { name, edited: read.edited, layout: read.layout, kept };
  fileStatus('');
  if (formOpen) closeForm();
  else onFormChange(true);
}

/** What the toast says once an opened file is on screen. */
function openedText(opening, { unbuilt, replaced }) {
  let text = `Открыт файл «${opening.name}»`;
  if (unbuilt) text += '. По его рецепту и seed эта сборка трассу не строит — показана трасса из файла';
  // Saved unedited, but this build generates another course for the seed (ADR 0009).
  else if (opening.layout && !opening.edited && editor.edited) {
    text += '. Эта сборка по тому же seed строит другую трассу — показана трасса из файла, как трасса с правками';
  }
  if (replaced || opening.kept) text += '. Прежнюю трассу с правками вернёт «↶»';
  return text;
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
  const id = state.courseRev;
  imageTimer = setTimeout(async () => {
    try {
      const files = await buildImageFiles();
      if (state.courseRev === id && state.course) state.image = { id, files };
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
  const id = state.courseRev;
  let files = state.image?.id === id ? state.image.files : null;
  if (!files) {
    renderFrames(null);
    try {
      files = await buildImageFiles();
    } catch {
      $('picture-status').textContent = 'Не удалось нарисовать картинку. Закройте и попробуйте ещё раз';
      return;
    }
    if (state.courseRev !== id || $('picture-sheet').hidden) return;
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
const BEHIND_FORM = ['stage', 'dock', 'setup-panel', 'edit-panel'];
const BEHIND_PICTURE = [...BEHIND_FORM, 'form-sheet'];
const BEHIND_PICKER = BEHIND_PICTURE;
/** A modal sheet is open: the keys of the plan and of the modes behind it are off. */
const modalOpen = () => formOpen || !$('picture-sheet').hidden || editor.pickerOpen;
let formOpener = null;
let formOpen = false; // open as a modal sheet
function openForm() {
  if (wide.matches) {
    if (state.setupStep !== null) exitSetup();
    exitEdit();
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
    sheet.hidden = state.setupStep !== null || editor.active;
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
  buildSafety();
  state.adopt = parseLayout(loadEdit());
  const saved = loadForm();
  const initial = { ...DEFAULT_FORM, ...(saved ?? {}), shape: savedShape(saved), types: savedTypes(saved) };
  delete initial.knownTypes;
  delete initial.closed;
  writeForm(initial);
  state.form = readForm();

  form.addEventListener('input', () => onFormChange());
  form.train.addEventListener('change', syncTypes);
  form.addEventListener('change', syncSizes);
  form.addEventListener('change', syncSafety);
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
  $('backdrop').addEventListener('click', () => {
    if (editor.pickerOpen) editor.closePicker();
    else if ($('picture-sheet').hidden) closeForm();
    else closePicture();
  });
  $('open-form').addEventListener('click', openForm);
  $('summary').addEventListener('click', openForm);
  $('new-seed').addEventListener('click', newSeed);
  $('prev-seed').addEventListener('click', previousSeed);
  $('form-x').addEventListener('click', closeForm);
  $('toast').addEventListener('click', () => ($('toast').hidden = true));
  $('edit-mode').addEventListener('click', () => enterEdit(state.selected));
  $('setup-mode').addEventListener('click', enterSetup);
  $('setup-close').addEventListener('click', exitSetup);
  $('setup-prev').addEventListener('click', setupPrev);
  $('setup-next').addEventListener('click', setupNext);
  // Keyboard in «Правка»: arrows move the selected element, R turns it, Delete removes it, Ctrl+Z undoes.
  document.addEventListener('keydown', (e) => {
    if (e.defaultPrevented || !editor.active || modalOpen() || e.target.matches?.('input')) return;
    if (editor.key(e)) e.preventDefault();
  });
  // Keyboard: arrows step through «Расстановка», Escape leaves it or closes the element card.
  document.addEventListener('keydown', (e) => {
    if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
    // A docked recipe (wide screen) is not in the way; only the modal sheets are.
    if (modalOpen() || e.target.matches?.('input')) return;
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
  $('save-json').addEventListener('click', () => saveFile('json'));
  $('save-csv').addEventListener('click', () => saveFile('csv'));
  $('share-json').addEventListener('click', () => shareFile('json'));
  $('share-csv').addEventListener('click', () => shareFile('csv'));
  $('open-json').addEventListener('click', () => $('open-file').click());
  $('open-file').addEventListener('change', onFilePicked);
  renderFileButtons();
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
    // In «Правка» the selected element stays selected: only the camera moves.
    if (!editor.active) {
      state.selected = null;
      hideElementCard();
    }
    resetCamera(state.camera);
    invalidate();
  });

  wide.addEventListener('change', () => {
    applyLayout();
    if (state.selected && state.setupStep === null && !editor.active) selectElement(state.selected);
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
    // Not in «Правка», where the zones are always drawn and their button is away.
    case 'z': case 'Z': case 'я': case 'Я': return editor.active ? undefined : click('zones');
  }
}

start();

