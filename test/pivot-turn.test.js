// The pivot turn («Вращение», ADR 0025): any quarter turn from 90° to 720°,
// a free radius from 3 m on any bike, and a free circle that keeps out cones
// only — through the catalog, a routed layout, the recipe and the course file.

import { describe, expect, test } from 'bun:test';
import { canonicalJSON, generateCourse, parseRecipe, passColor, PIVOT_ANGLES } from '../src/generator/index.js';
import { elementParams, instantiate } from '../src/generator/catalog.js';
import { conesClear, pathClear, placeTemplate, uTurnCones } from '../src/generator/generate.js';
import { elementControls, routeLayout, setElementSize } from '../src/generator/layout.js';
import { pointsBounds } from '../src/generator/geometry.js';
import { buildSetupSheet } from '../src/sheet/setup-sheet.js';
import { courseDocument, courseFileText, readCourseFile } from '../src/file/course-file.js';

const tpl = (sizes, { diagonal = false, mirrored = false, bike = 'cruiser' } = {}) => instantiate('pivot-turn', elementParams('pivot-turn', sizes, diagonal, bike), diagonal, mirrored);
const recipeOf = (bike = 'cruiser', shape = 'closed') => generateCourse({ width: 100, length: 100, elements: 1, difficulty: 'medium', bike, shape }, 0).course.recipe;
const pivotLayout = (angle, radius = 5, bike = 'cruiser') => ({
  recipe: recipeOf(bike),
  seed: 0,
  elements: [
    { type: 'gate', sizes: { width: 2 }, axis: 0, mirrored: false, x: 20, y: 30 },
    { type: 'pivot-turn', sizes: { angle, radius }, axis: 0, mirrored: false, x: 55, y: 35 },
    { type: 'gate', sizes: { width: 2 }, axis: 2, mirrored: false, x: 75, y: 75 },
  ],
});
const turnBy = ([a, b], deg) => {
  const t = (deg * Math.PI) / 180;
  return [Math.round(a * Math.cos(t) - b * Math.sin(t)) + 0, Math.round(a * Math.sin(t) + b * Math.cos(t)) + 0];
};
/** Signed angle swept round (0, 0) along a polyline, degrees. */
const swept = (points) => {
  let s = 0;
  for (let i = 1; i < points.length; i++) {
    const [p, q] = [points[i - 1], points[i]];
    let d = Math.atan2(q[1], q[0]) - Math.atan2(p[1], p[0]);
    if (d > Math.PI) d -= 2 * Math.PI;
    if (d < -Math.PI) d += 2 * Math.PI;
    s += d;
  }
  return (s * 180) / Math.PI;
};

describe('angle', () => {
  test('every quarter turn from 90° to 720° is offered, one step apart', () => {
    expect(PIVOT_ANGLES).toEqual([90, 180, 270, 360, 450, 540, 630, 720]);
    const layout = pivotLayout(90);
    const angle = (l) => elementControls(l, 1).find((c) => c.key === 'angle');
    expect(angle(layout).less).toBeNull();
    let at = layout;
    const seen = [angle(at).value];
    while (angle(at).more) {
      at = { ...at, elements: at.elements.map((e, i) => (i === 1 ? { ...e, sizes: angle(at).more } : e)) };
      seen.push(angle(at).value);
    }
    expect(seen).toEqual(PIVOT_ANGLES);
  });

  test('each angle leaves on the entry turned by it, round the cone, the way the pass says', () => {
    for (const angle of PIVOT_ANGLES) {
      for (const mirrored of [false, true]) {
        for (const diagonal of [false, true]) {
          const t = tpl({ angle, radius: 5 }, { mirrored, diagonal });
          const label = `${angle}° ${mirrored ? 'mirrored' : ''} ${diagonal ? 'diagonal' : ''}`;
          expect(t.exitDir.map((v) => v + 0), label).toEqual(turnBy(t.entryDir, mirrored ? -angle : angle));
          // The last stretch of the line runs the way the exit faces.
          const [p, q] = t.path.slice(-2);
          const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
          expect([(q[0] - p[0]) / len, (q[1] - p[1]) / len].map((v) => Math.round(v * 1e6) / 1e6 + 0), label).toEqual(t.exitDir.map((v) => v + 0));
          // Round the cone by the angle on the line 0.5 m inside the free radius.
          const ring = t.path.filter(([a, b]) => Math.abs(Math.hypot(a, b) * t.unit - 4.5) < 1e-6);
          expect(Math.abs(swept(ring)), label).toBeCloseTo(angle, 0);
          expect(t.passes[0].angle).toBe(angle);
        }
      }
    }
  });

  test('more than half a turn takes the striped cone; 90° and 180° the side colour', () => {
    for (const angle of PIVOT_ANGLES) {
      const left = tpl({ angle, radius: 5 }).passes[0];
      const right = tpl({ angle, radius: 5 }, { mirrored: true }).passes[0];
      expect([passColor(left), passColor(right)], `${angle}°`).toEqual(angle > 180 ? ['striped', 'striped'] : ['blue', 'red']);
    }
  });

  test('a course with a pivot at every angle closes back on the start with no problems', () => {
    for (const angle of PIVOT_ANGLES) {
      const { course, problems } = routeLayout(pivotLayout(angle));
      expect(problems, `${angle}°`).toEqual([]);
      const pivot = course.elements[1];
      expect(pivot.exit.dir, `${angle}°`).toBe((pivot.entry.dir + angle / 45) % 8);
      expect(course.passes.find((p) => p.element === pivot.id).angle).toBe(angle);
      const card = buildSetupSheet(course).cards[1];
      expect(card.angle).toBe(angle);
      expect(card.notes.join(' ')).toContain(angle > 180 ? 'красный с жёлтой полосой' : angle === 90 ? 'четверть оборота' : 'полоборота');
    }
  });
});

describe('free radius', () => {
  test('goes down to 3 m on a cruiser, with the line 0.5 m inside it; under 3 m is refused', () => {
    const at3 = setElementSize(pivotLayout(270, 6), 1, 'radius', 3);
    expect(elementControls(at3, 1).find((c) => c.key === 'radius')).toMatchObject({ value: 3, less: null });
    expect(elementControls(setElementSize(at3, 1, 'radius', 2.5), 1).find((c) => c.key === 'radius').value).toBe(3);
    const ring = tpl({ angle: 270, radius: 3 });
    expect(Math.min(...ring.path.map(([a, b]) => Math.hypot(a, b) * ring.unit))).toBeCloseTo(2.5, 9);
    // The stepper reaches 3 m from a class value off the 0.5 m step (sport, hard: 4.25 m).
    const sport = setElementSize(pivotLayout(270, 4.25, 'sport'), 1, 'radius', 3.25);
    expect(elementControls(sport, 1).find((c) => c.key === 'radius').less.radius).toBe(3);

    const recipe = { width: 40, length: 40, elements: 3, difficulty: 'medium', bike: 'cruiser', types: ['pivot-turn', 'gate'] };
    const ok = parseRecipe({ ...recipe, sizes: { 'pivot-turn': { radius: 3 } } });
    expect(ok.ok).toBe(true);
    expect(ok.recipe.sizes).toEqual({ 'pivot-turn': { radius: 3 } });
    const low = parseRecipe({ ...recipe, sizes: { 'pivot-turn': { radius: 2.5 } } });
    expect(low.ok).toBe(false);
    expect(low.errors.sizes).toContain('от 3 до 8 м');
  });

  test('the recipe\'s radius is the radius every generated pivot gets; without one the class value', () => {
    const recipe = { width: 60, length: 60, elements: 4, difficulty: 'medium', bike: 'cruiser', types: ['pivot-turn', 'gate', 'straight-slalom'] };
    for (const seed of [1, 2, 3]) {
      for (const e of generateCourse({ ...recipe, sizes: { 'pivot-turn': { radius: 3 } } }, seed).course.elements.filter((x) => x.type === 'pivot-turn')) expect(e.params.radius).toBe(3);
      for (const e of generateCourse(recipe, seed).course.elements.filter((x) => x.type === 'pivot-turn')) expect(e.params.radius).toBe(5.5);
    }
  });

  test('another element\'s cone inside the circle is a problem; just outside it is not', () => {
    // A 90° pivot leaves its upper-left quarter free of its line: a cone there is close to nothing but the circle.
    const layout = (x, y) => ({
      recipe: recipeOf(),
      seed: 0,
      elements: [
        { type: 'pivot-turn', sizes: { angle: 90, radius: 8 }, axis: 0, mirrored: false, x: 50, y: 50 },
        { type: 'pass-left', sizes: {}, axis: 0, mirrored: false, x, y },
      ],
    });
    const inside = routeLayout(layout(45, 55)).problems; // 7.07 m from the pivot cone
    expect(inside.map((p) => p.code)).toEqual(['in-free-radius']);
    expect(inside[0].elements).toEqual(['e1', 'e2']);
    expect(inside[0].text).toContain('свободном радиусе');
    expect(routeLayout(layout(44, 56)).problems).toEqual([]); // 8.49 m
  });

  test('a connector may cross the circle; its U-turn cone may not stand in it', () => {
    const t = tpl({ angle: 90, radius: 8 });
    const pivot = placeTemplate(t, 0, 50, 50);
    // A chord through the free upper-left quarter, deep inside the circle.
    const chord = [[44, 50.5], [49.5, 56]];
    expect(chord.every(([x, y]) => Math.hypot(x - 50, y - 50) < 8)).toBe(true);
    expect(pathClear(chord, pointsBounds(chord), [pivot])).toBe(true);
    // The same spot as the centre of a connector's U-turn: its cone would stand in the circle.
    const cone = uTurnCones([{ turn: Math.PI, left: true, center: [46, 54], gapBefore: 0 }], 0);
    expect(cone).toHaveLength(1);
    expect(conesClear(cone, [0, 0, 100, 100], [pivot], [])).toBe(false);
    const far = uTurnCones([{ turn: Math.PI, left: true, center: [43, 57], gapBefore: 0 }], 0);
    expect(conesClear(far, [0, 0, 100, 100], [pivot], [])).toBe(true);
  });

  test('a generated course keeps every cone of other elements out of each pivot\'s circle', () => {
    let seen = 0;
    for (const difficulty of ['easy', 'hard']) {
      for (let seed = 1; seed <= 8; seed++) {
        const { course } = generateCourse({ width: 40, length: 38, elements: 6, difficulty, bike: 'sport', types: ['pivot-turn', 'gate', 'straight-slalom', 'u-turn', 'offset-slalom'], sizes: { 'pivot-turn': { radius: 8 } } }, seed);
        const at = new Map(course.cones.map((c) => [c.id, c]));
        for (const e of course.elements.filter((x) => x.type === 'pivot-turn')) {
          const centre = at.get(e.anchor);
          for (const c of course.cones) {
            if (c.id === e.anchor) continue;
            const d = Math.hypot(c.hx - centre.hx, c.hy - centre.hy) / 2;
            expect(d, `${difficulty} ${seed} ${e.id} ${c.id}`).toBeGreaterThanOrEqual(8 - 0.011);
            seen++;
          }
        }
      }
    }
    expect(seen).toBeGreaterThan(0);
  }, 30_000);
});

describe('course file', () => {
  test('a pivot at 450° on a 3 m radius opens back as the same course', () => {
    const layout = pivotLayout(450, 3);
    const read = readCourseFile(courseFileText(courseDocument(layout, {})));
    expect(read.ok).toBe(true);
    expect(read.layout.elements[1].sizes).toEqual({ angle: 450, radius: 3 });
    expect(canonicalJSON(routeLayout(read.layout).course)).toBe(canonicalJSON(routeLayout(layout).course));
  });
});
