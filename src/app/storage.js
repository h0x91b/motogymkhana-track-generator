// Every access to localStorage is guarded: private mode or a full quota just
// means no memory. localStorage.clear() is never called — other keys on the
// origin are not ours.

// Whether the plan shows the reserved zones, a per-viewer preference.
const ZONES_KEY = 'motogymkhana-constructor:zones:v1';

export function loadZones() {
  try {
    return window.localStorage.getItem(ZONES_KEY) !== 'off';
  } catch {
    return true;
  }
}

export function saveZones(on) {
  try {
    window.localStorage.setItem(ZONES_KEY, on ? 'on' : 'off');
  } catch {
    // Storage unavailable: the zones are shown again on the next visit.
  }
}

// The ride-through speed, a per-viewer preference under its own key.
const SPEED_KEY = 'motogymkhana-constructor:ride-speed:v1';

export function loadRideSpeed() {
  try {
    return Number(window.localStorage.getItem(SPEED_KEY)) || null;
  } catch {
    return null;
  }
}

export function saveRideSpeed(speed) {
  try {
    window.localStorage.setItem(SPEED_KEY, String(speed));
  } catch {
    // Storage unavailable: the speed resets on the next visit.
  }
}

// Saved courses («Мои трассы», ADR 0026): course-file documents (ADR 0013)
// under a name, all under one key. The course on screen is always one of them
// and is saved as it changes; which one is under its own key, kept per tab in
// sessionStorage (each tab reloads into its own course) and in localStorage
// for a new tab. The functions take the storage so the tests can hand them a
// fake; the app passes nothing.
const COURSES_KEY = 'motogymkhana-constructor:courses:v1';
const CURRENT_KEY = 'motogymkhana-constructor:current:v1';
// Before named courses: the last form and the last edited layout (ADR 0012).
// Read once to bring the course back, removed once it is saved as a course.
const LEGACY_FORM_KEY = 'motogymkhana-constructor:form:v1';
const LEGACY_EDIT_KEY = 'motogymkhana-constructor:edit:v1';
export const COURSE_NAME_MAX = 80;
export const AUTOSAVE_MS = 500;

function localStore() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function tabStore() {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

const isEntry = (e) => e && typeof e === 'object' && typeof e.id === 'string' && typeof e.name === 'string'
  && Number.isFinite(e.savedAt) && e.doc && typeof e.doc === 'object';

function readCourses(store) {
  try {
    const value = JSON.parse(store?.getItem(COURSES_KEY) ?? 'null');
    return Array.isArray(value) ? value.filter(isEntry) : [];
  } catch {
    return [];
  }
}

/** Is it the browser saying the storage is full (the name differs between engines)? */
const isQuota = (e) => e?.name === 'QuotaExceededError' || e?.name === 'NS_ERROR_DOM_QUOTA_REACHED' || e?.code === 22 || e?.code === 1014;

const UNAVAILABLE = 'Память браузера недоступна: трассы здесь не сохраняются, скачайте .json';
const FULL = 'В памяти браузера не хватает места: трасса не сохраняется. Удалите ненужные трассы или скачайте эту в .json';

function writeCourses(store, courses) {
  if (!store) return { ok: false, error: UNAVAILABLE };
  try {
    store.setItem(COURSES_KEY, JSON.stringify(courses));
    return { ok: true };
  } catch (e) {
    return { ok: false, error: isQuota(e) ? FULL : UNAVAILABLE };
  }
}

const cleanName = (name) => String(name ?? '').replace(/\s+/g, ' ').trim().slice(0, COURSE_NAME_MAX);
const MISSING = 'Этой трассы уже нет в «Моих трассах»';

const DIFFICULTY_NAMES = { easy: 'лёгкая', medium: 'средняя', hard: 'сложная' };

/** The name a course has until it is renamed: lot size · difficulty · seed · the day it was made. */
export function defaultCourseName(recipe, seed, date = new Date()) {
  const day = new Date(date).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
  return `${recipe.width}×${recipe.length} м · ${DIFFICULTY_NAMES[recipe.difficulty] ?? recipe.difficulty} · seed ${seed} · ${day}`;
}

/**
 * A default name no other course has: two courses of one recipe, seed and day
 * would otherwise read the same in «Мои трассы» and in the tab title.
 */
function freeName(courses, name, id = null) {
  const taken = new Set(courses.filter((e) => e.id !== id).map((e) => e.name));
  if (!taken.has(name)) return name;
  let n = 2;
  while (taken.has(`${name} · ${n}`)) n++;
  return `${name} · ${n}`;
}

/** The saved courses, the last edited first. */
export function listCourses(store = localStore()) {
  return readCourses(store).sort((a, b) => b.savedAt - a.savedAt);
}

export const findCourse = (id, store = localStore()) => readCourses(store).find((e) => e.id === id) ?? null;

const newId = (now, n) => `${now.toString(36)}-${n.toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;

/**
 * Saves a course-file document as a new course. Without a name it is named
 * after its recipe and seed, and keeps following them (`auto`) until renamed.
 * @returns {{ok: true, entry: object} | {ok: false, error: string}} the error is a sentence for the user
 */
export function saveCourse(name, doc, { store = localStore(), now = Date.now() } = {}) {
  const courses = readCourses(store);
  const given = cleanName(name);
  const entry = {
    id: newId(now, courses.length),
    name: given || freeName(courses, defaultCourseName(doc.recipe, doc.seed, now)),
    savedAt: now,
    createdAt: now,
    doc,
    ...(given ? {} : { auto: true }),
  };
  const written = writeCourses(store, [...courses, entry]);
  return written.ok ? { ok: true, entry } : written;
}

/** The document without what does not change the course (which build wrote it). */
export const sameDoc = (a, b) => JSON.stringify({ ...a, build: '' }) === JSON.stringify({ ...b, build: '' });

/**
 * Puts the course's new state under its entry: what autosave does. A course
 * that did not change is not written, so only an edit moves it up the list.
 * @returns {{ok: true, entry: object, changed: boolean} | {ok: false, error: string, missing?: true}}
 */
export function updateCourse(id, doc, { store = localStore(), now = Date.now() } = {}) {
  const courses = readCourses(store);
  const entry = courses.find((e) => e.id === id);
  if (!entry) return { ok: false, error: MISSING, missing: true };
  const name = entry.auto ? freeName(courses, defaultCourseName(doc.recipe, doc.seed, entry.createdAt ?? entry.savedAt), id) : entry.name;
  if (sameDoc(entry.doc, doc) && name === entry.name) return { ok: true, entry, changed: false };
  Object.assign(entry, { doc, name, savedAt: now });
  const written = writeCourses(store, courses);
  return written.ok ? { ok: true, entry, changed: true } : written;
}

/** Renames a saved course; an empty name keeps the old one. A renamed course keeps its name. */
export function renameCourse(id, name, store = localStore()) {
  const courses = readCourses(store);
  const entry = courses.find((e) => e.id === id);
  if (!entry) return { ok: false, error: MISSING };
  const given = cleanName(name);
  if (!given || given === entry.name) return { ok: true, entry };
  entry.name = given;
  delete entry.auto;
  const written = writeCourses(store, courses);
  return written.ok ? { ok: true, entry } : written;
}

/** A copy of a saved course under «… — копия», the newest in the list. */
export function duplicateCourse(id, { store = localStore(), now = Date.now() } = {}) {
  const courses = readCourses(store);
  const entry = courses.find((e) => e.id === id);
  if (!entry) return { ok: false, error: MISSING };
  const suffix = ' — копия';
  const copy = {
    id: newId(now, courses.length),
    name: `${entry.name.slice(0, COURSE_NAME_MAX - suffix.length)}${suffix}`,
    savedAt: now,
    createdAt: now,
    doc: entry.doc,
  };
  const written = writeCourses(store, [...courses, copy]);
  return written.ok ? { ok: true, entry: copy } : written;
}

/**
 * Deletes a saved course.
 * @returns {{ok: true, next: object|null} | {ok: false, error: string}} next: the course to show if
 *   the deleted one was on screen — the last edited of the rest, or null for a new one
 */
export function deleteCourse(id, store = localStore()) {
  const rest = readCourses(store).filter((e) => e.id !== id);
  const written = writeCourses(store, rest);
  if (!written.ok) return written;
  return { ok: true, next: rest.sort((a, b) => b.savedAt - a.savedAt)[0] ?? null };
}

function readCurrent(store) {
  try {
    return store?.getItem(CURRENT_KEY) || null;
  } catch {
    return null;
  }
}

/** Which saved course is on screen: this tab's, else the one opened last in any tab, or null. */
export const loadCurrentId = (store = localStore(), tab = tabStore()) => readCurrent(tab) ?? readCurrent(store);

/** Another tab opening a course changes what a new tab opens, never what this one reloads into. */
export function saveCurrentId(id, store = localStore(), tab = tabStore()) {
  for (const s of [tab, store]) {
    try {
      if (id) s?.setItem(CURRENT_KEY, id);
      else s?.removeItem(CURRENT_KEY);
    } catch {
      // Storage unavailable: the last edited course opens on the next visit.
    }
  }
}

function readJson(store, key) {
  try {
    const value = JSON.parse(store?.getItem(key) ?? 'null');
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

/**
 * What to show on load: the course that was on screen in this tab, or the one
 * opened last in any tab (or, if both are gone, the last edited one); else what an older build left — the last form and edited
 * layout, to be saved as a course once shown; else nothing.
 * @returns {{kind: 'course', entry: object} | {kind: 'legacy', form: object|null, edit: object|null} | {kind: 'fresh'}}
 */
export function startingCourse(store = localStore(), tab = tabStore()) {
  const courses = listCourses(store);
  // This tab's course, or if it is gone, the one opened last in any tab.
  const entry = [readCurrent(tab), readCurrent(store)].map((id) => courses.find((e) => e.id === id)).find(Boolean) ?? null;
  if (entry) return { kind: 'course', entry };
  const form = readJson(store, LEGACY_FORM_KEY);
  const edit = readJson(store, LEGACY_EDIT_KEY);
  if (form || edit) return { kind: 'legacy', form, edit };
  return courses.length ? { kind: 'course', entry: courses[0] } : { kind: 'fresh' };
}

/** Removes the keys of an older build, once their course is saved as a course. */
export function forgetLegacy(store = localStore()) {
  try {
    store?.removeItem(LEGACY_FORM_KEY);
    store?.removeItem(LEGACY_EDIT_KEY);
  } catch {
    // Storage unavailable: they are read again, and saved again, next time.
  }
}

/**
 * Debounced saving: `schedule()` on every change, `write()` runs once the
 * changes stop for `delay` ms; `flush()` runs a pending write now (before a
 * switch, when the page is hidden). The timers are passed in for the tests.
 */
export function createAutosave(write, { delay = AUTOSAVE_MS, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  let timer = null;
  const run = () => {
    timer = null;
    write();
  };
  return {
    schedule() {
      if (timer !== null) clearTimer(timer);
      timer = setTimer(run, delay);
    },
    flush() {
      if (timer === null) return;
      clearTimer(timer);
      run();
    },
    cancel() {
      if (timer !== null) clearTimer(timer);
      timer = null;
    },
    get pending() { return timer !== null; },
  };
}
