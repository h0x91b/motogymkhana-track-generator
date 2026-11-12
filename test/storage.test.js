// The storage seam of «Мои трассы»: saved courses round-trip through one
// namespaced, versioned key, a full or missing storage is a sentence for the
// user, and other keys on the origin are left alone.

import { describe, expect, test } from 'bun:test';
import { generateCourse } from '../src/generator/index.js';
import { layoutOf } from '../src/generator/layout.js';
import { courseDocument, courseFileText, readCourseFile } from '../src/file/course-file.js';
import { COURSE_NAME_MAX, deleteCourse, listCourses, renameCourse, saveCourse } from '../src/app/storage.js';

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

    expect(deleteCourse(b.entry.id, store).ok).toBe(true);
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
    expect(saveCourse('', doc, { store, now: 2 }).entry.name).toBe('Трасса');
  });
});
