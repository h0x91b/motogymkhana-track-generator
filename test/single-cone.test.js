// Single-cone elements (ADR 0024): «Конус слева», «Конус справа», «Малый
// разворот» and the pivot turn. Their geometry and colours through the
// catalog, their place in a generated course as gap fillers, and their way
// through «Правка» and the course file.

import { describe, expect, test } from 'bun:test';
import {
  BIKE_TURN_RADIUS, canonicalJSON, ELEMENT_TYPES, FILLER_TYPES, generateCourse, LOOPED_TYPES, passColor, RUN_OFF, RUN_OFF_TYPES, runOffFor, SINGLE_CONE_TYPES,
} from '../src/generator/index.js';
import { elementParams, instantiate, SIZE_SPECS, typicalSizes } from '../src/generator/catalog.js';
import { elementMargins, fillerLimit } from '../src/generator/generate.js';
import { elementSafety, insertElement, layoutOf, mirrorElement, routeLayout } from '../src/generator/layout.js';
import { buildSetupSheet } from '../src/sheet/setup-sheet.js';
import { courseDocument, courseFileText, readCourseFile } from '../src/file/course-file.js';
import { sweep } from './helpers/slow.js';

const tpl = (type, sizes, { diagonal = false, mirrored = false, bike = 'sport', margins } = {}) => instantiate(type, elementParams(type, sizes, diagonal, bike), diagonal, mirrored, margins);
const ANTON = { width: 40, length: 38, elements: 6, difficulty: 'medium', bike: 'sport' };
const OWN = (c) => c.elements.filter((e) => !FILLER_TYPES.includes(e.type)).length;
const FILLED = (c) => c.elements.filter((e) => FILLER_TYPES.includes(e.type)).length;

describe('catalog', () => {
  test('each is one tall cone with one pass round it, and never a big element', () => {
    for (const type of SINGLE_CONE_TYPES) {
      for (const diagonal of [false, true]) {
        const t = tpl(type, typicalSizes(type, 'medium', 'sport', {}), { diagonal });
        expect(t.cones, type).toEqual([{ a: 0, b: 0, height: 'tall' }]);
        expect(t.passes).toHaveLength(1);
        expect(t.passes[0]).toMatchObject({ kind: 'cone', cone: 0 });
        expect(t.lines).toEqual([]);
        expect((t.core[2] - t.core[0]) * (t.core[3] - t.core[1]) * t.unit * t.unit).toBeLessThan(120);
      }
    }
  });

  test('the cone passed on the left is blue, on the right red, whichever way it is mirrored', () => {
    for (const mirrored of [false, true]) {
      const left = tpl('pass-left', {}, { mirrored });
      const right = tpl('pass-right', {}, { mirrored });
      expect(left.mirrored).toBe(false);
      expect([left.passes[0].side, passColor(left.passes[0])]).toEqual(['left', 'blue']);
      expect([right.passes[0].side, passColor(right.passes[0])]).toEqual(['right', 'red']);
      // The rider keeps the cone on that side: the line runs on the other side of the axis.
      expect(left.path.every(([, b]) => b < 0)).toBe(true);
      expect(right.path.every(([, b]) => b > 0)).toBe(true);
      expect([left.entryDir, left.exitDir]).toEqual([[1, 0], [1, 0]]);
    }
  });

  test('the small U-turn goes back round the cone, 180°, coloured by its side; the pivot turn\'s cone is striped', () => {
    const plain = tpl('small-turn', { radius: 4 });
    expect(plain.passes[0]).toMatchObject({ side: 'left', angle: 180 });
    expect(passColor(plain.passes[0])).toBe('blue');
    expect([plain.entryDir, plain.exitDir]).toEqual([[1, 0], [-1, 0]]);
    const mirrored = tpl('small-turn', { radius: 4 }, { mirrored: true });
    expect(passColor(mirrored.passes[0])).toBe('red');
    for (const angle of [270, 360, 720]) {
      const pivot = tpl('pivot-turn', { angle, radius: 5 });
      expect(passColor(pivot.passes[0])).toBe('striped');
    }
  });

  test('the class radius is the small U-turn\'s minimum, never undercut, and a wider line is kept', () => {
    for (const bike of ['sport', 'cruiser']) {
      const min = BIKE_TURN_RADIUS[bike];
      expect(elementParams('small-turn', { radius: 1 }, false, bike).radius).toBe(min);
      expect(elementParams('small-turn', { radius: min + 2 }, false, bike).radius).toBe(min + 2);
      for (const diagonal of [false, true]) {
        const t = tpl('small-turn', { radius: 1 }, { bike, diagonal });
        const arc = t.path.slice(2, -2).map(([a, b]) => Math.hypot(a, b) * t.unit);
        for (const r of arc) expect(r).toBeGreaterThanOrEqual(min - 1e-9);
      }
    }
    expect(SIZE_SPECS['small-turn'].map((s) => s.kind)).toEqual(['radius']);
    expect(SIZE_SPECS['pass-left']).toEqual([]);
  });

  test('a turning single-cone element keeps half the recipe\'s run-off; a cone passed by has none', () => {
    expect(RUN_OFF_TYPES['small-turn']).toBe('turnaround');
    expect(RUN_OFF_TYPES['pass-left']).toBeUndefined();
    expect(runOffFor('small-turn', RUN_OFF)).toBe(RUN_OFF / 2);
    expect(runOffFor('pivot-turn', 4.5)).toBe(2.5);
    expect(runOffFor('u-turn', RUN_OFF)).toBe(RUN_OFF);
    expect(elementMargins({ safety: {} }, 'pivot-turn').runOff).toBe(2.5);
    const t = tpl('small-turn', { radius: 4 }, { margins: elementMargins({ safety: {} }, 'small-turn') });
    expect(t.margins.runOff).toBe(2.5);
    // Beyond the cone the run-off reaches 2.5 m from the line, not 5.
    expect((t.runOff[2] - t.core[2]) * t.unit).toBeCloseTo(2.5, 9);
    expect(tpl('pass-right', {}).runOff).toBeNull();
  });
});

describe('gap fillers in a generated course', () => {
  const seeds = sweep(40, 4);
  const filled = [];
  for (let seed = 1; seed <= seeds; seed++) filled.push([seed, generateCourse(ANTON, seed).course]);

  test('a course gets fillers only where its own elements ran out, and never fewer of its own', () => {
    let used = 0;
    // Without the pivot turn, which is dealt and fills gaps too, the course's own elements are the same types with and without fillers.
    const types = ELEMENT_TYPES.filter((t) => t !== 'pivot-turn');
    for (let seed = 1; seed <= seeds; seed++) {
      const c = generateCourse({ ...ANTON, types }, seed).course;
      const plain = generateCourse({ ...ANTON, types: types.filter((t) => !FILLER_TYPES.includes(t)) }, seed).course;
      expect(OWN(c), `seed ${seed}`).toBeGreaterThanOrEqual(plain.placed);
      expect(FILLED(c)).toBeLessThanOrEqual(fillerLimit(c.placed));
      // A course that came out whole without them has none.
      if (plain.placed === ANTON.elements) expect(FILLED(c), `seed ${seed}`).toBe(0);
      used += FILLED(c);
    }
    expect(used).toBeGreaterThan(0);
  }, 30_000);

  test('never two of a kind in a row, and no U-turn round a cone in «паровозик»', () => {
    for (const [, c] of filled) c.elements.forEach((e, i) => i && expect(e.type).not.toBe(c.elements[i - 1].type));
    expect(LOOPED_TYPES).toContain('small-turn');
    expect(LOOPED_TYPES).not.toContain('pass-left');
    for (let seed = 1; seed <= sweep(10, 3); seed++) {
      const c = generateCourse({ ...ANTON, shape: 'closed', train: true }, seed).course;
      for (const e of c.elements) expect(LOOPED_TYPES).not.toContain(e.type);
    }
  });

  test('a recipe of fillers alone is laid out from them', () => {
    const c = generateCourse({ ...ANTON, types: ['pass-left', 'pass-right'] }, 1).course;
    expect(c.elements.length).toBeGreaterThan(0);
    for (const e of c.elements) expect(['pass-left', 'pass-right']).toContain(e.type);
  });

  test('the setup sheet gives each one its cone and colour, and the striped cone a count of its own', () => {
    for (const [, c] of filled) {
      const sheet = buildSetupSheet(c);
      for (const card of sheet.cards.filter((k) => SINGLE_CONE_TYPES.includes(k.type))) {
        expect(card.cones).toHaveLength(1);
        const want = { 'pass-left': 'blue', 'pass-right': 'red', 'pivot-turn': 'striped' }[card.type];
        if (want) expect(card.cones[0].color).toBe(want);
        expect(card.notes.join(' ').length).toBeGreaterThan(0);
      }
    }
    const pivot = generateCourse({ ...ANTON, types: ['pivot-turn', 'gate'] }, 2).course;
    expect(buildSetupSheet(pivot).coneList.tallStriped).toBe(pivot.elements.filter((e) => e.type === 'pivot-turn').length);
  });

  test('a course with fillers opens back from its file as the same course', () => {
    const bare = ({ requested, placed, edited, limitedBy, ...course }) => course;
    const some = filled.filter(([, c]) => FILLED(c) > 0).slice(0, 3);
    expect(some.length).toBeGreaterThan(0);
    for (const [, c] of some) {
      const read = readCourseFile(courseFileText(courseDocument(layoutOf(c), {})));
      expect(read.ok).toBe(true);
      expect(canonicalJSON(bare(routeLayout(read.layout).course))).toBe(canonicalJSON(bare(c)));
    }
  });
});

describe('«Правка»', () => {
  const base = layoutOf(generateCourse(ANTON, 1).course);

  test('each can be inserted, and routes', () => {
    for (const type of SINGLE_CONE_TYPES) {
      const layout = insertElement(base, 1, type);
      expect(layout.elements[1].type).toBe(type);
      const { course } = routeLayout(layout);
      expect(course.elements[1].cones).toHaveLength(1);
    }
  });

  test('mirroring a cone passed on one side makes it the cone passed on the other', () => {
    const layout = insertElement(base, 1, 'pass-left');
    const once = mirrorElement(layout, 1);
    expect(once.elements[1].type).toBe('pass-right');
    expect(mirrorElement(once, 1).elements[1].type).toBe('pass-left');
    const turn = mirrorElement(insertElement(base, 1, 'small-turn'), 1);
    expect([turn.elements[1].type, turn.elements[1].mirrored]).toEqual(['small-turn', true]);
  });

  test('its own run-off starts from half the recipe\'s', () => {
    const layout = insertElement(base, 1, 'small-turn');
    expect(elementSafety(layout, 1).find((s) => s.key === 'runOff')).toMatchObject({ value: 2.5, recipe: 2.5, own: false });
    expect(elementSafety(insertElement(base, 1, 'pass-left'), 1).map((s) => s.key)).toEqual(['pad']);
  });
});
