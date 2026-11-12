// The file seam: a course saved as a course file opens back as the same course,
// a broken or foreign file is refused with a sentence for the user, and the
// cone list has one row per physical cone at its place on the site.

import { describe, expect, test } from 'bun:test';
import { canonicalJSON, generateCourse } from '../src/generator/index.js';
import { layoutOf, mirrorElement, moveElement, rotateElement, routeLayout } from '../src/generator/layout.js';
import { buildSetupSheet } from '../src/sheet/setup-sheet.js';
import {
  COURSE_FILE_FORMAT, COURSE_FILE_VERSION, conesCsv, courseDocument, courseFileName, courseFileText, readCourseFile,
} from '../src/file/course-file.js';
import { sweep } from './helpers/slow.js';

const RECIPES = [
  { width: 40, length: 60, elements: 8, difficulty: 'hard', bike: 'cruiser', shape: 'closed', train: true },
  { width: 40, length: 38, elements: 6, difficulty: 'medium', bike: 'sport', shape: 'open' },
  { width: 40, length: 60, elements: 6, difficulty: 'medium', bike: 'sport', shape: 'return', sizes: { 'straight-slalom': { step: 4 } } },
  { width: 28, length: 30, elements: 5, difficulty: 'easy', bike: 'sport', shape: 'closed', train: true },
];
const SEEDS = sweep([0, 1, 7, 4294967295], [4294967295]);

const courses = RECIPES.flatMap((recipe) => SEEDS.map((seed) => generateCourse(recipe, seed)).filter((r) => r.ok).map((r) => r.course));

/** A course without the bookkeeping that differs between a generated and a routed one. */
const bare = ({ requested, placed, edited, limitedBy, ...course }) => course;
const saved = (layout, meta) => readCourseFile(courseFileText(courseDocument(layout, meta)));

describe('course file', () => {
  test('a generated course opens back as the same course', () => {
    expect(courses.length).toBeGreaterThan(sweep(10, 2));
    for (const course of courses) {
      const read = saved(layoutOf(course), { build: 'abc1234 · 12.11.2026' });
      expect(read.ok).toBe(true);
      expect(read.edited).toBe(false);
      expect(read.build).toBe('abc1234 · 12.11.2026');
      expect(canonicalJSON(read.layout)).toBe(canonicalJSON(layoutOf(course)));
      expect(canonicalJSON(bare(routeLayout(read.layout).course))).toBe(canonicalJSON(bare(course)));
    }
  }, 30_000);

  test('an edited course opens back with every edit and the same problems', () => {
    for (const course of courses) {
      let layout = layoutOf(course);
      layout = moveElement(layout, 0, layout.elements[0].x + 3, layout.elements[0].y - 2);
      layout = rotateElement(layout, layout.elements.length - 1, 1);
      layout = mirrorElement(layout, 0);
      const read = saved(layout, { edited: true });
      expect(read.ok).toBe(true);
      expect(read.edited).toBe(true);
      expect(canonicalJSON(read.layout)).toBe(canonicalJSON(layout));
      const [a, b] = [routeLayout(read.layout), routeLayout(layout)];
      expect(canonicalJSON(a.course)).toBe(canonicalJSON(b.course));
      expect(canonicalJSON(a.problems)).toBe(canonicalJSON(b.problems));
    }
  }, 30_000);

  test('the document names its format and version and carries the whole recipe', () => {
    const course = courses[2];
    const doc = JSON.parse(courseFileText(courseDocument(layoutOf(course))));
    expect(doc.format).toBe(COURSE_FILE_FORMAT);
    expect(doc.version).toBe(COURSE_FILE_VERSION);
    expect(doc.recipe).toEqual(course.recipe);
    expect(doc.seed).toBe(course.seed);
    expect(doc.elements).toHaveLength(course.elements.length);
  });

  test('recipe and seed alone open as the course this build generates', () => {
    const read = readCourseFile(JSON.stringify({ format: COURSE_FILE_FORMAT, version: 1, recipe: { width: '40', length: 60, elements: 8, difficulty: 'hard' }, seed: 5 }));
    expect(read.ok).toBe(true);
    expect(read.layout).toBe(null);
    expect(read.seed).toBe(5);
    expect(read.recipe.width).toBe(40);
    expect(read.recipe.shape).toBe('open');
  });

  test('a byte-order mark in front of the JSON is fine', () => {
    expect(readCourseFile(`\uFEFF${courseFileText(courseDocument(layoutOf(courses[0])))}`).ok).toBe(true);
  });

  test('a broken or foreign file is refused with a sentence, never half-opened', () => {
    const good = courseDocument(layoutOf(courses[0]));
    const cases = {
      'not json': 'это не json',
      array: '[]',
      'another format': JSON.stringify({ ...good, format: 'something-else' }),
      'no version': JSON.stringify({ ...good, version: undefined }),
      'newer version': JSON.stringify({ ...good, version: COURSE_FILE_VERSION + 1 }),
      'unknown type': JSON.stringify({ ...good, elements: [{ ...good.elements[0], type: 'rocket' }] }),
      'anchor off the metre': JSON.stringify({ ...good, elements: [{ ...good.elements[0], x: 1.5 }] }),
      'no elements left': JSON.stringify({ ...good, elements: [] }),
      'bad recipe': JSON.stringify({ ...good, recipe: { ...good.recipe, width: 5 } }),
      'bad seed': JSON.stringify({ ...good, seed: -1 }),
      'bad seed, recipe only': JSON.stringify({ format: COURSE_FILE_FORMAT, version: 1, recipe: good.recipe, seed: 1.5 }),
    };
    for (const [name, text] of Object.entries(cases)) {
      const read = readCourseFile(text);
      expect({ name, ok: read.ok }).toEqual({ name, ok: false });
      expect(read.error).toMatch(/[а-я]/);
    }
    expect(readCourseFile(JSON.stringify({ ...good, version: COURSE_FILE_VERSION + 1 })).error).toMatch(/новой версией/);
  });

  test('file names are plain ASCII', () => {
    expect(courseFileName({ width: 40, length: 38 }, 12, 'json')).toBe('motogymkhana-trassa-40x38-seed-12.json');
    expect(courseFileName({ width: 40, length: 38 }, 12, 'csv')).toBe('motogymkhana-konusy-40x38-seed-12.csv');
  });
});

/** The CSV back as rows of cells; no cell in it is quoted. */
const parseCsv = (text) => {
  expect(text.startsWith('\uFEFF')).toBe(true);
  expect(text).not.toContain('"');
  return text.slice(1).trimEnd().split('\r\n').map((line) => line.split(';'));
};
const metres = (s) => Number(s.replace(',', '.'));

describe('cone list CSV', () => {
  test('one row per physical cone, numbered in order, at its place from the reference corner', () => {
    for (const course of courses) {
      const [head, ...rows] = parseCsv(conesCsv(course));
      expect(head).toEqual(['№', 'Где', '№ в элементе', 'Высота', 'Цвет', 'X, м', 'Y, м']);
      expect(rows).toHaveLength(course.cones.length);
      rows.forEach((r, i) => expect(r[0]).toBe(String(i + 1)));
      const place = (x, y) => `${x}|${y}`;
      const want = course.cones.map((c) => place(c.hx / 2, c.hy / 2)).sort();
      const got = rows.map((r) => {
        expect(r[5]).toMatch(/^\d+,\d$/);
        expect(r[6]).toMatch(/^\d+,\d$/);
        return place(metres(r[5]), metres(r[6]));
      }).sort();
      expect(got).toEqual(want);
      expect(rows.some((r) => r[1] === '—')).toBe(false);
    }
  });

  test('heights and colours add up to the cone list of the setup sheet', () => {
    for (const course of courses) {
      const rows = parseCsv(conesCsv(course)).slice(1);
      const { coneList } = buildSetupSheet(course);
      expect(rows.filter((r) => r[3] === 'низкий' && r[4] === 'любой')).toHaveLength(coneList.low);
      expect(rows.filter((r) => r[3] === 'высокий' && r[4] === 'синий (слева)')).toHaveLength(coneList.tallBlue);
      expect(rows.filter((r) => r[3] === 'высокий' && r[4] === 'красный (справа)')).toHaveLength(coneList.tallRed);
    }
  });

  test('element cones carry the number of their row in the element card', () => {
    const course = courses[0];
    const sheet = buildSetupSheet(course);
    const rows = parseCsv(conesCsv(course)).slice(1);
    for (const card of sheet.cards) {
      const mine = rows.filter((r) => r[1] === `${card.number}. ${card.name}`);
      expect(mine.map((r) => Number(r[2]))).toEqual(card.cones.map((c) => c.n));
      card.cones.forEach((c, k) => {
        const row = mine[k];
        if (card.axis.diagonal) {
          expect(metres(row[5]) - card.anchor.x).toBeCloseTo(c.dx, 6);
          expect(metres(row[6]) - card.anchor.y).toBeCloseTo(c.dy, 6);
        }
      });
    }
    const terminals = rows.filter((r) => r[1].startsWith('Старт'));
    expect(terminals.length).toBeGreaterThan(0);
  });

  test('connector U-turn cones are tall and named by their connector', () => {
    const withTurns = courses.filter((c) => c.passes.some((p) => p.connector));
    expect(withTurns.length).toBeGreaterThan(0);
    for (const course of withTurns) {
      const rows = parseCsv(conesCsv(course)).slice(1).filter((r) => r[1].startsWith('Связка'));
      expect(rows).toHaveLength(course.passes.filter((p) => p.connector).length);
      for (const r of rows) expect(r[3]).toBe('высокий');
    }
  });
});
