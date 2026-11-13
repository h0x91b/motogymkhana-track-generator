// The storage seam of «Мои трассы»: saved courses round-trip through one
// namespaced, versioned key, the course on screen autosaves under its entry
// (debounced), the keys of an older build are migrated, a full or missing
// storage is a sentence for the user, and other keys on the origin are left alone.

import { describe, expect, test } from 'bun:test';
import { generateCourse } from '../src/generator/index.js';
import { layoutOf } from '../src/generator/layout.js';
import { courseDocument, courseFileText, readCourseFile } from '../src/file/course-file.js';
import {
  COURSE_NAME_MAX, createAutosave, defaultCourseName, deleteCourse, duplicateCourse, forgetLegacy, listCourses, loadCurrentId, renameCourse,
  saveCourse, saveCurrentId, startingCourse, updateCourse,
} from '../src/app/storage.js';

/** A Storage stand-in; `quota` makes every write fail the way a full browser storage does. */
function fakeStorage({ quota = false } = {}) {
  const map = new Map();
  return {
    map,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem(k, v) {
      if (quota) throw Object.assign(new Error('full'), { name: 'QuotaExceededError', code: 22 });
      map.set(k, String(v));
    },
    removeItem: (k) => map.delete(k),
    clear() {
      throw new Error('clear() must never be called');
    },
  };
}

const recipe = { width: 40, length: 60, elements: 6, difficulty: 'medium', bike: 'sport', shape: 'return' };
const generated = generateCourse(recipe, 7);
const doc = courseDocument(layoutOf(generated.course), { build: 'test', edited: true });

describe('saved courses', () => {
  test('save, list newest first, rename, delete', () => {
    const store = fakeStorage();
    expect(generated.ok).toBe(true);
    expect(listCourses(store)).toEqual([]);
    const a = saveCourse('Первая', doc, { store, now: 1000 });
    const b = saveCourse('  Вторая   трасса ', doc, { store, now: 2000 });
    expect(a.ok && b.ok).toBe(true);
    expect(a.entry.id).not.toBe(b.entry.id);
    expect(listCourses(store).map((e) => e.name)).toEqual(['Вторая трасса', 'Первая']);
    expect(listCourses(store)[1].savedAt).toBe(1000);

    expect(renameCourse(a.entry.id, 'Переименована', store).ok).toBe(true);
    expect(renameCourse(a.entry.id, '   ', store).ok).toBe(true); // an empty name keeps the old one
    expect(listCourses(store).find((e) => e.id === a.entry.id).name).toBe('Переименована');
    expect(renameCourse('nope', 'x', store).ok).toBe(false);

    const deleted = deleteCourse(b.entry.id, store);
    expect(deleted.ok).toBe(true);
    expect(deleted.next.id).toBe(a.entry.id);
    expect(listCourses(store).map((e) => e.name)).toEqual(['Переименована']);
  });

  test('a saved course opens exactly like its file, edits included', () => {
    const store = fakeStorage();
    saveCourse('x', doc, { store, now: 1 });
    const [entry] = listCourses(store);
    const fromSaved = readCourseFile(courseFileText(entry.doc));
    const fromFile = readCourseFile(courseFileText(doc));
    expect(fromSaved.ok).toBe(true);
    expect(fromSaved.edited).toBe(true);
    expect(fromSaved).toEqual(fromFile);
  });

  test('one namespaced, versioned key; other keys untouched', () => {
    const store = fakeStorage();
    store.setItem('someone-else', 'keep');
    saveCourse('x', doc, { store, now: 1 });
    expect([...store.map.keys()].sort()).toEqual(['motogymkhana-constructor:courses:v1', 'someone-else']);
    expect(JSON.parse(store.getItem('motogymkhana-constructor:courses:v1'))[0].doc.format).toBe('motogymkhana-course');
    expect(store.getItem('someone-else')).toBe('keep');
  });

  test('a full storage is a sentence, and nothing is lost', () => {
    const store = fakeStorage();
    saveCourse('kept', doc, { store, now: 1 });
    const before = store.getItem('motogymkhana-constructor:courses:v1');
    const full = fakeStorage({ quota: true });
    full.map.set('motogymkhana-constructor:courses:v1', before);
    const r = saveCourse('new', doc, { store: full, now: 2 });
    expect(r.ok).toBe(false);
    expect(r.error).toContain('не хватает места');
    expect(full.getItem('motogymkhana-constructor:courses:v1')).toBe(before);
    expect(deleteCourse(listCourses(full)[0].id, full).ok).toBe(false);
  });

  test('no storage at all, or a broken value, is not a crash', () => {
    expect(listCourses(null)).toEqual([]);
    expect(saveCourse('x', doc, { store: null }).ok).toBe(false);
    const store = fakeStorage();
    store.setItem('motogymkhana-constructor:courses:v1', '{not json');
    expect(listCourses(store)).toEqual([]);
    store.setItem('motogymkhana-constructor:courses:v1', JSON.stringify([{ id: 1 }, null, 'x']));
    expect(listCourses(store)).toEqual([]);
  });

  test('names: trimmed, capped, never empty', () => {
    const store = fakeStorage();
    expect(saveCourse('я'.repeat(200), doc, { store, now: 1 }).entry.name.length).toBe(COURSE_NAME_MAX);
    const auto = saveCourse('', doc, { store, now: Date.UTC(2026, 10, 13, 12) }).entry;
    expect(auto.name).toBe('40×60 м · средняя · seed 7 · 13.11.2026');
    expect(auto.auto).toBe(true);
  });
});

const otherSeed = courseDocument(layoutOf(generateCourse(recipe, 8).course), { build: 'test' });

describe('the course on screen', () => {
  test('autosave updates its entry; an unchanged course is not written and keeps its place', () => {
    const store = fakeStorage();
    const a = saveCourse('', doc, { store, now: 1000 }).entry;
    const b = saveCourse('Другая', doc, { store, now: 2000 }).entry;
    const same = updateCourse(a.id, { ...doc, build: 'another build' }, { store, now: 3000 });
    expect(same).toMatchObject({ ok: true, changed: false });
    expect(listCourses(store)[0].id).toBe(b.id);

    const changed = updateCourse(a.id, otherSeed, { store, now: 4000 });
    expect(changed).toMatchObject({ ok: true, changed: true });
    const [first] = listCourses(store);
    expect(first.id).toBe(a.id);
    expect(first.doc.seed).toBe(8);
    // Never renamed: the name follows the seed, the date stays the day it was made.
    expect(first.name).toBe(defaultCourseName(recipe, 8, 1000));
    expect(updateCourse('gone', doc, { store }).missing).toBe(true);
  });

  test('a renamed course keeps its name through autosave', () => {
    const store = fakeStorage();
    const a = saveCourse('', doc, { store, now: 1 }).entry;
    expect(renameCourse(a.id, 'Тренировка в четверг', store).entry.auto).toBeUndefined();
    updateCourse(a.id, otherSeed, { store, now: 2 });
    expect(listCourses(store)[0].name).toBe('Тренировка в четверг');
  });

  test('duplicate: a copy under its own id and name, newest in the list', () => {
    const store = fakeStorage();
    const a = saveCourse('Площадка у ТЦ', doc, { store, now: 1 }).entry;
    const copy = duplicateCourse(a.id, { store, now: 2 });
    expect(copy.ok).toBe(true);
    expect(copy.entry.id).not.toBe(a.id);
    expect(copy.entry.name).toBe('Площадка у ТЦ — копия');
    expect(copy.entry.doc).toEqual(a.doc);
    expect(listCourses(store).map((e) => e.id)).toEqual([copy.entry.id, a.id]);
    expect(duplicateCourse('я'.repeat(3), { store }).ok).toBe(false);
    const long = saveCourse('я'.repeat(80), doc, { store, now: 3 }).entry;
    expect(duplicateCourse(long.id, { store, now: 4 }).entry.name.length).toBe(COURSE_NAME_MAX);
  });

  test('deleting the course on screen: the last edited of the rest comes next, or none', () => {
    const store = fakeStorage();
    const a = saveCourse('a', doc, { store, now: 1 }).entry;
    const b = saveCourse('b', doc, { store, now: 2 }).entry;
    const c = saveCourse('c', doc, { store, now: 3 }).entry;
    updateCourse(a.id, otherSeed, { store, now: 4 }); // a edited last
    expect(deleteCourse(c.id, store).next.id).toBe(a.id);
    expect(deleteCourse(a.id, store).next.id).toBe(b.id);
    expect(deleteCourse(b.id, store).next).toBeNull();
    expect(listCourses(store)).toEqual([]);
  });

  test('debounced: many changes in a row are one write, flush writes a pending one now', () => {
    const timers = [];
    const fake = {
      delay: 500,
      setTimer: (fn, ms) => timers.push({ fn, ms, live: true }) - 1,
      clearTimer: (i) => { timers[i].live = false; },
    };
    let writes = 0;
    const autosave = createAutosave(() => writes++, fake);
    for (let i = 0; i < 10; i++) autosave.schedule();
    expect(writes).toBe(0);
    expect(timers.filter((t) => t.live)).toHaveLength(1);
    expect(timers.at(-1).ms).toBe(500);
    timers.at(-1).fn();
    expect(writes).toBe(1);
    expect(autosave.pending).toBe(false);
    autosave.flush(); // nothing pending: nothing written
    expect(writes).toBe(1);
    autosave.schedule();
    autosave.flush();
    expect(writes).toBe(2);
    autosave.schedule();
    autosave.cancel();
    expect(writes).toBe(2);
  });

  test('debounced with real timers: one write after the changes stop', async () => {
    let writes = 0;
    const autosave = createAutosave(() => writes++, { delay: 20 });
    autosave.schedule();
    await Bun.sleep(5);
    autosave.schedule();
    await Bun.sleep(5);
    autosave.schedule();
    expect(writes).toBe(0);
    await Bun.sleep(60);
    expect(writes).toBe(1);
  });

  test('a full storage while autosaving is a sentence, and the stored course is untouched', () => {
    const store = fakeStorage();
    const a = saveCourse('a', doc, { store, now: 1 }).entry;
    const full = fakeStorage({ quota: true });
    full.map.set('motogymkhana-constructor:courses:v1', store.getItem('motogymkhana-constructor:courses:v1'));
    const r = updateCourse(a.id, otherSeed, { store: full, now: 2 });
    expect(r.ok).toBe(false);
    expect(r.error).toContain('не хватает места');
    expect(listCourses(full)[0].doc.seed).toBe(7);
    expect(renameCourse(a.id, 'b', full).ok).toBe(false);
    expect(duplicateCourse(a.id, { store: full }).ok).toBe(false);
  });
});

describe('which course opens', () => {
  const LEGACY_FORM = 'motogymkhana-constructor:form:v1';
  const LEGACY_EDIT = 'motogymkhana-constructor:edit:v1';

  test('the one that was on screen, else the last edited, else fresh', () => {
    const store = fakeStorage();
    expect(startingCourse(store)).toEqual({ kind: 'fresh' });
    const a = saveCourse('a', doc, { store, now: 1 }).entry;
    const b = saveCourse('b', doc, { store, now: 2 }).entry;
    expect(startingCourse(store)).toMatchObject({ kind: 'course', entry: { id: b.id } });
    saveCurrentId(a.id, store);
    expect(loadCurrentId(store)).toBe(a.id);
    expect(startingCourse(store)).toMatchObject({ kind: 'course', entry: { id: a.id } });
    deleteCourse(a.id, store);
    expect(startingCourse(store)).toMatchObject({ kind: 'course', entry: { id: b.id } });
    saveCurrentId(null, store);
    expect(loadCurrentId(store)).toBeNull();
  });

  test('migration: an older build\'s last form and edits come back, and their keys go once saved', () => {
    const store = fakeStorage();
    const form = { width: '30', length: '50', seed: '42', knownTypes: ['slalom'] };
    const edit = layoutOf(generated.course);
    store.setItem(LEGACY_FORM, JSON.stringify(form));
    store.setItem(LEGACY_EDIT, JSON.stringify(edit));
    // Courses saved by hand before stay; the last form still wins, it was on screen.
    saveCourse('by hand', doc, { store, now: 1 });
    expect(startingCourse(store)).toEqual({ kind: 'legacy', form, edit: JSON.parse(JSON.stringify(edit)) });
    // The app saves the course it shows, makes it current and only then forgets the old keys.
    const saved = saveCourse('', doc, { store, now: 2 });
    saveCurrentId(saved.entry.id, store);
    forgetLegacy(store);
    expect(store.getItem(LEGACY_FORM)).toBeNull();
    expect(store.getItem(LEGACY_EDIT)).toBeNull();
    expect(startingCourse(store)).toMatchObject({ kind: 'course', entry: { id: saved.entry.id } });
    expect(listCourses(store)).toHaveLength(2);
  });

  test('migration with a broken legacy value is not a crash', () => {
    const store = fakeStorage();
    store.setItem(LEGACY_FORM, '{oops');
    store.setItem(LEGACY_EDIT, '[1,2]');
    expect(startingCourse(store)).toEqual({ kind: 'fresh' });
    expect(startingCourse(null)).toEqual({ kind: 'fresh' });
  });
});
