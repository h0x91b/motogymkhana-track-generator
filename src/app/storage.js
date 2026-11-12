// The last form, under one namespaced and versioned localStorage key. Every
// access is guarded: private mode or a full quota just means no memory.
// localStorage.clear() is never called — other keys on the origin are not ours.

const KEY = 'motogymkhana-constructor:form:v1';

export function loadForm() {
  try {
    const raw = window.localStorage.getItem(KEY);
    const value = raw ? JSON.parse(raw) : null;
    return value && typeof value === 'object' ? value : null;
  } catch {
    return null;
  }
}

export function saveForm(form) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(form));
  } catch {
    // Storage unavailable: the app keeps working without remembering the form.
  }
}

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

// The course as edited by hand («Правка»): its layout, under its own key and
// format version. It is shown again only for the recipe and seed it was made from.
const EDIT_KEY = 'motogymkhana-constructor:edit:v1';

export function loadEdit() {
  try {
    const raw = window.localStorage.getItem(EDIT_KEY);
    const value = raw ? JSON.parse(raw) : null;
    return value && typeof value === 'object' ? value : null;
  } catch {
    return null;
  }
}

/** Remembers the edited layout, or forgets it (null). */
export function saveEdit(layout) {
  try {
    if (layout) window.localStorage.setItem(EDIT_KEY, JSON.stringify(layout));
    else window.localStorage.removeItem(EDIT_KEY);
  } catch {
    // Storage unavailable: the edits live until the tab is closed.
  }
}

// Saved courses («Мои трассы»): course-file documents (ADR 0013) under a name
// and the time they were saved, all under one key. The functions take the
// storage so the tests can hand them a fake; the app passes nothing.
const COURSES_KEY = 'motogymkhana-constructor:courses:v1';
export const COURSE_NAME_MAX = 80;

function localStore() {
  try {
    return window.localStorage;
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

function writeCourses(store, courses) {
  if (!store) return { ok: false, error: 'Память браузера недоступна: трассы здесь не сохранить, скачайте .json' };
  try {
    store.setItem(COURSES_KEY, JSON.stringify(courses));
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      error: isQuota(e)
        ? 'В памяти браузера не хватает места: удалите ненужные трассы или скачайте эту в .json'
        : 'Память браузера недоступна: трассы здесь не сохранить, скачайте .json',
    };
  }
}

const cleanName = (name) => String(name ?? '').replace(/\s+/g, ' ').trim().slice(0, COURSE_NAME_MAX);

/** The saved courses, newest first. */
export function listCourses(store = localStore()) {
  return readCourses(store).sort((a, b) => b.savedAt - a.savedAt);
}

/**
 * Saves a course-file document under a name.
 * @returns {{ok: true, entry: object} | {ok: false, error: string}} the error is a sentence for the user
 */
export function saveCourse(name, doc, { store = localStore(), now = Date.now() } = {}) {
  const courses = readCourses(store);
  const entry = { id: `${now.toString(36)}-${courses.length.toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`, name: cleanName(name) || 'Трасса', savedAt: now, doc };
  const written = writeCourses(store, [...courses, entry]);
  return written.ok ? { ok: true, entry } : written;
}

/** Renames a saved course; an empty name keeps the old one. */
export function renameCourse(id, name, store = localStore()) {
  const courses = readCourses(store);
  const entry = courses.find((e) => e.id === id);
  if (!entry) return { ok: false, error: 'Этой трассы уже нет в «Моих трассах»' };
  entry.name = cleanName(name) || entry.name;
  return writeCourses(store, courses);
}

export function deleteCourse(id, store = localStore()) {
  const courses = readCourses(store);
  return writeCourses(store, courses.filter((e) => e.id !== id));
}
