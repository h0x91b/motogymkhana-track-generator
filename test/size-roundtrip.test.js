// Sizes never change on the way through storage: an element of every type, at
// the sizes the editor starts it from (a radius from the bike class and the
// difficulty's margin among them) and at each end of every range, keeps its
// sizes exactly through the course file, through «Мои трассы» and through
// being routed and read back as a layout. The saved course a user reported
// (`fixtures/edited-40x52.json`) opens with its own sizes.

import { describe, expect, test } from 'bun:test';
import { BIKES, DIFFICULTIES, ELEMENT_TYPES, editAxes, WAYPOINT } from '../src/generator/index.js';
import { elementControls, layoutOf, routeLayout } from '../src/generator/layout.js';
import { diagonalAxis, typicalSizes } from '../src/generator/catalog.js';
import { courseDocument, courseFileText, readCourseFile } from '../src/file/course-file.js';
import { saveCourse, startingCourse, updateCourse } from '../src/app/storage.js';

function fakeStorage() {
  const map = new Map();
  return { getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, String(v)), removeItem: (k) => map.delete(k) };
}

/** The sizes reached from `sizes` by stepping every control as far as it goes one way (`less` or `more`). */
function stepped(layout, way) {
  let el = layout.elements[0];
  for (let guard = 0; guard < 100; guard++) {
    const next = elementControls({ ...layout, elements: [el] }, 0).find((c) => c[way])?.[way];
    if (!next) return el.sizes;
    el = { ...el, sizes: next };
  }
  throw new Error('a size never reached the end of its range');
}

const cases = [];
for (const bike of BIKES) {
  for (const difficulty of DIFFICULTIES) {
    const recipe = { width: 60, length: 80, elements: 1, difficulty, bike, shape: 'open', train: false, sizes: {}, blocked: [] };
    for (const type of [...ELEMENT_TYPES, WAYPOINT]) {
      // A side axis and, where the type has one, a diagonal: a length is held on another lattice there.
      for (const axis of [0, 1].filter((a) => editAxes(type).includes(a))) {
        const base = { recipe, seed: 1, elements: [{ type, sizes: type === WAYPOINT ? {} : typicalSizes(type, difficulty, bike, {}), axis, mirrored: false, x: 30, y: 40 }] };
        for (const [name, sizes] of [['typical', base.elements[0].sizes], ['smallest', stepped(base, 'less')], ['largest', stepped(base, 'more')]]) {
          cases.push({ label: `${type} ${name} on axis ${axis}, ${difficulty} ${bike}`, layout: { ...base, elements: [{ ...base.elements[0], sizes }] } });
        }
      }
    }
  }
}

const parsed = (layout) => {
  const read = readCourseFile(courseFileText(courseDocument(layout, { edited: true })));
  expect(read.ok).toBe(true);
  return read.layout;
};

describe('sizes survive save and load', () => {
  test('the cases cover every type with a size that comes from the bike class and the difficulty', () => {
    expect(new Set(cases.map((c) => c.layout.elements[0].type)).size).toBe(ELEMENT_TYPES.length + 1);
    // «Малый разворот», easy cruiser: the class radius 4.5 m plus the easy margin of 1 m.
    expect(typicalSizes('small-turn', 'easy', 'cruiser', {}).radius).toBe(5.5);
  });

  test('through the course file', () => {
    for (const { label, layout } of cases) expect({ label, sizes: parsed(layout).elements[0].sizes }).toEqual({ label, sizes: layout.elements[0].sizes });
  });

  test('through «Мои трассы»: saved, saved again, opened from storage', () => {
    const store = fakeStorage();
    const first = saveCourse('Трасса', courseDocument(cases[0].layout), { store });
    for (const { label, layout } of cases) {
      expect(updateCourse(first.entry.id, courseDocument(layout, { edited: true }), { store }).ok).toBe(true);
      const read = readCourseFile(courseFileText(startingCourse(store).entry.doc));
      expect({ label, sizes: read.layout.elements[0].sizes }).toEqual({ label, sizes: layout.elements[0].sizes });
    }
  });

  // A turned element keeps the nominal sizes it had along a side (ADR 0019), so
  // on a diagonal two nominal lengths can build the same lattice length: there
  // what is built and what the editor shows must hold, not the nominal figure.
  test('through routing: the course built from a layout reads back as the same element, shown with the same values', () => {
    for (const { label, layout } of cases) {
      const course = routeLayout(parsed(layout)).course;
      const back = layoutOf(course);
      if (!diagonalAxis(layout.elements[0].type, layout.elements[0].axis)) expect({ label, sizes: back.elements[0].sizes }).toEqual({ label, sizes: layout.elements[0].sizes });
      expect({ label, params: routeLayout(back).course.elements[0].params }).toEqual({ label, params: course.elements[0].params });
      const shown = (l) => elementControls(l, 0).map((c) => c.value);
      expect({ label, shown: shown(back) }).toEqual({ label, shown: shown(layout) });
    }
  });

  test('the saved course from the report opens with every size it was saved with', async () => {
    const text = await Bun.file(new URL('./fixtures/edited-40x52.json', import.meta.url)).text();
    const doc = JSON.parse(text);
    const read = readCourseFile(text);
    expect(read.ok).toBe(true);
    expect(read.layout.elements.map((e) => e.sizes)).toEqual(doc.elements.map((e) => e.sizes));
    expect(read.layout.elements[6]).toMatchObject({ type: 'small-turn', sizes: { radius: 5.5 } });
    const back = layoutOf(routeLayout(read.layout).course);
    expect(back.elements.map((e) => e.sizes)).toEqual(doc.elements.map((e) => e.sizes));
  });
});
