// Single-cone elements (ADR 0024): «Конус слева», «Конус справа», «Малый
// разворот» and the pivot turn. Their geometry and colours through the
// catalog, their place in a generated course as gap fillers, and their way
// through «Правка» and the course file.

import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'bun:test';
import {
  BIKE_TURN_RADIUS, canonicalJSON, ELEMENT_TYPES, FILLER_TYPES, FREE_HEADING_TYPES, generateCourse, LOOPED_TYPES, parseRecipe, passColor, RUN_OFF, RUN_OFF_TYPES, runOffFor, SINGLE_CONE_TYPES, SMALL_TURN_RADIUS_MIN, uTurnRadius,
} from '../src/generator/index.js';
import { elementParams, instantiate, SIZE_SPECS, typicalSizes } from '../src/generator/catalog.js';
import { chainLeg, CHAIN_ANGLE, CHAIN_REACH, elementMargins, fillerLimit, innerRect, placeTemplate } from '../src/generator/generate.js';
import { elementControls, elementSafety, insertElement, insertWaypoint, layoutOf, mirrorElement, rotateElement, routeLayout, setElementSize, turnElementTo } from '../src/generator/layout.js';
import { buildSetupSheet } from '../src/sheet/setup-sheet.js';
import { conesCsv, courseDocument, courseFileText, readCourseFile } from '../src/file/course-file.js';
import { seeds, timeout } from './helpers/slow.js';
import { distanceToPath, fullRoute, turns } from './helpers/course-geometry.js';

const tpl = (type, sizes, { diagonal = false, mirrored = false, bike = 'sport', margins } = {}) => instantiate(type, elementParams(type, sizes, diagonal, bike), diagonal, mirrored, margins);
const ANTON = { width: 40, length: 38, elements: 6, difficulty: 'medium', bike: 'sport' };
const OWN = (c) => c.elements.filter((e) => !FILLER_TYPES.includes(e.type)).length;
const FILLED = (c) => c.elements.filter((e) => FILLER_TYPES.includes(e.type)).length;
const antonCourses = new Map();
/** The tester's course of a seed, generated once for the whole file. */
const antonCourse = (seed) => {
  if (!antonCourses.has(seed)) antonCourses.set(seed, generateCourse(ANTON, seed).course);
  return antonCourses.get(seed);
};

describe('catalog', () => {
  test('a passed cone and the small U-turn take their heading from the route; the pivot turn does not', () => {
    expect(FREE_HEADING_TYPES.toSorted()).toEqual(['pass-left', 'pass-right', 'small-turn']);
  });

  test('a passed cone is a point beside it: no straight, no run-in or run-out', () => {
    for (const type of ['pass-left', 'pass-right']) {
      const t = tpl(type, {});
      expect(t.point).toBe(true);
      expect(t.path).toHaveLength(2);
      expect(t.path[0]).toEqual(t.path[1]);
      expect(Math.abs(t.path[0][1]) * t.unit).toBeCloseTo(1, 9);
      // A wide clearance pushes the point out with it: the line never comes inside the cone's clearance.
      const wide = tpl(type, {}, { margins: { pad: 1.5 } });
      expect(Math.abs(wide.path[0][1]) * wide.unit).toBeGreaterThan(1.5);
    }
  });

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

  test('the small U-turn goes down to 3 m on any bike, starts from the class radius, and keeps a wider line', () => {
    expect(SMALL_TURN_RADIUS_MIN).toBe(3);
    for (const bike of ['sport', 'cruiser']) {
      expect(elementParams('small-turn', { radius: 1 }, false, bike).radius).toBe(3);
      expect(elementParams('small-turn', { radius: 3 }, false, bike).radius).toBe(3);
      expect(elementParams('small-turn', { radius: 7 }, false, bike).radius).toBe(7);
      for (const difficulty of ['easy', 'medium', 'hard']) expect(typicalSizes('small-turn', difficulty, bike, {}).radius).toBe(uTurnRadius(difficulty, bike));
      for (const diagonal of [false, true]) {
        const t = tpl('small-turn', { radius: 1 }, { bike, diagonal });
        const arc = t.path.slice(2, -2).map(([a, b]) => Math.hypot(a, b) * t.unit);
        for (const r of arc) expect(r).toBeCloseTo(3, 9);
      }
    }
    expect(SIZE_SPECS['small-turn'].map((s) => s.kind)).toEqual(['radius']);
    expect(SIZE_SPECS['pass-left']).toEqual([]);
  });

  test('the recipe sets the small U-turn\'s radius from 3 to 8 m; every one generated gets it', () => {
    const recipe = { width: 40, length: 40, elements: 5, difficulty: 'medium', bike: 'cruiser', types: ['gate', 'straight-slalom', 'pass-left', 'small-turn'] };
    expect(parseRecipe({ ...recipe, sizes: { 'small-turn': { radius: 3 } } }).recipe.sizes).toEqual({ 'small-turn': { radius: 3 } });
    const low = parseRecipe({ ...recipe, sizes: { 'small-turn': { radius: 2.5 } } });
    expect(low.ok).toBe(false);
    expect(low.errors.sizes).toContain('от 3 до 8 м');
    let seen = 0;
    for (const seed of seeds(6, [2])) {
      for (const e of generateCourse({ ...recipe, sizes: { 'small-turn': { radius: 3 } } }, seed).course.elements.filter((x) => x.type === 'small-turn')) {
        expect(e.params.radius).toBe(3);
        seen++;
      }
    }
    expect(seen).toBeGreaterThan(0);
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

  test('the small U-turn\'s run-off polygon reaches its run-off from both ends of the arc', () => {
    const margins = elementMargins({ safety: {} }, 'small-turn');
    for (const radius of [3, 4, 5, 6, 7, 8]) {
      for (const mirrored of [false, true]) {
        const t = tpl('small-turn', { radius }, { mirrored, margins });
        const own = [...t.cones.map((c) => [c.a, c.b]), ...t.path.slice(1, -1)];
        const poly = t.runOffPoly;
        // Every side but the clipped entry side lies the run-off from the cone and the arc.
        const near = poly
          .map((p, k) => [p, poly[(k + 1) % poly.length]])
          .map(([p, q]) => Math.min(...own.map((o) => Math.abs((q[0] - p[0]) * (o[1] - p[1]) - (q[1] - p[1]) * (o[0] - p[0])) / Math.hypot(q[0] - p[0], q[1] - p[1]))) * t.unit)
          .filter((d) => d < margins.runOff - 1e-6);
        expect(near.length, `radius ${radius}${mirrored ? ' mirrored' : ''}`).toBe(1);
      }
    }
  });
});

describe('gap fillers in a generated course', () => {
  const SEEDS = seeds(40, [2, 4]);
  const filled = SEEDS.map((seed) => [seed, antonCourse(seed)]);

  test('a course gets fillers only where its own elements ran out, and never fewer of its own', () => {
    let used = 0;
    // Without the pivot turn, which is dealt and fills gaps too, the course's own elements are the same types with and without fillers.
    const types = ELEMENT_TYPES.filter((t) => t !== 'pivot-turn');
    for (const seed of SEEDS) {
      const c = generateCourse({ ...ANTON, types }, seed).course;
      const plain = generateCourse({ ...ANTON, types: types.filter((t) => !FILLER_TYPES.includes(t)) }, seed).course;
      expect(OWN(c), `seed ${seed}`).toBeGreaterThanOrEqual(plain.placed);
      expect(FILLED(c)).toBeLessThanOrEqual(fillerLimit(c.placed));
      // A course that came out whole without them has none.
      if (plain.placed === ANTON.elements) expect(FILLED(c), `seed ${seed}`).toBe(0);
      used += FILLED(c);
    }
    expect(used).toBeGreaterThan(0);
  }, timeout(30_000));

  test('never two of a kind in a row, and no U-turn round a cone in «паровозик»', () => {
    for (const [, c] of filled) c.elements.forEach((e, i) => i && expect(e.type).not.toBe(c.elements[i - 1].type));
    expect(LOOPED_TYPES).toContain('small-turn');
    expect(LOOPED_TYPES).not.toContain('pass-left');
    for (const seed of seeds(10, [7])) {
      const c = generateCourse({ ...ANTON, shape: 'closed', train: true }, seed).course;
      for (const e of c.elements) expect(LOOPED_TYPES).not.toContain(e.type);
    }
  }, timeout(30_000));

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
  const base = layoutOf(antonCourse(2));

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

  test('the small U-turn\'s radius steps down to 3 m on a cruiser, not below', () => {
    const cruiser = layoutOf(generateCourse({ ...ANTON, bike: 'cruiser' }, 1).course);
    let layout = insertElement(cruiser, 1, 'small-turn');
    expect(layout.elements[1].sizes.radius).toBe(uTurnRadius('medium', 'cruiser'));
    layout = setElementSize(layout, 1, 'radius', 3);
    expect(elementControls(layout, 1).find((c) => c.key === 'radius')).toMatchObject({ value: 3, less: null });
    expect(routeLayout(layout).course.elements[1].params.radius).toBe(3);
    expect(elementControls(setElementSize(layout, 1, 'radius', 2.5), 1).find((c) => c.key === 'radius').value).toBe(3);
  });

  test('its own run-off starts from half the recipe\'s', () => {
    const layout = insertElement(base, 1, 'small-turn');
    expect(elementSafety(layout, 1).find((s) => s.key === 'runOff')).toMatchObject({ value: 2.5, recipe: 2.5, own: false });
    expect(elementSafety(insertElement(base, 1, 'pass-left'), 1).map((s) => s.key)).toEqual(['pad']);
  });
});

describe('a free heading (ADR 0027)', () => {
  test('a free last element routes back on the heading that closes within the gentler turn limit, as generated', () => {
    // Seed 26 ends on «Конус слева» whose first heading in order only closes into the box with the looser limit.
    const course = generateCourse({ width: 40, length: 60, elements: 8, difficulty: 'medium', shape: 'return' }, 26).course;
    expect(course.elements.at(-1).type).toBe('pass-left');
    const bare = ({ requested, placed, edited, limitedBy, ...rest }) => rest;
    expect(canonicalJSON(bare(routeLayout(layoutOf(course)).course))).toBe(canonicalJSON(bare(course)));
  });

  // The tester's case: a gate, and «Конус слева» about 6 m past it, 1 m to one side.
  const recipe = parseRecipe({ ...ANTON, elements: 1 }).recipe;
  const gate = { type: 'gate', sizes: { width: 2 }, axis: 0, mirrored: false, x: 10, y: 18 };
  const gateExit = routeLayout({ recipe, seed: 0, elements: [gate] }).course.elements[0].exit;
  const after = (type, aside, axis = 0) => ({ recipe, seed: 0, elements: [gate, { type, sizes: {}, axis, mirrored: false, x: Math.round(gateExit.x + 6), y: gateExit.y + aside }] });
  /** Signed distance from the cone to the line ridden past it: > 0 when the cone is on the rider's left. */
  const signedSide = (course, id) => {
    const e = course.elements.find((k) => k.id === id);
    const cone = course.cones.find((c) => c.id === e.anchor);
    const p = [cone.hx / 2, cone.hy / 2];
    const line = fullRoute(course);
    let best = null;
    for (let k = 1; k < line.length; k++) {
      const [a, b] = [line[k - 1], line[k]];
      const d = [b[0] - a[0], b[1] - a[1]];
      const len2 = d[0] ** 2 + d[1] ** 2;
      if (len2 < 1e-12) continue;
      const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * d[0] + (p[1] - a[1]) * d[1]) / len2));
      const q = [a[0] + d[0] * t, a[1] + d[1] * t];
      const dist = Math.hypot(p[0] - q[0], p[1] - q[1]);
      if (!best || dist < best.dist) best = { dist, sign: Math.sign(d[0] * (p[1] - q[1]) - d[1] * (p[0] - q[0])) };
    }
    return best.sign * best.dist;
  };

  test('the cone past a gate, on either side of its line, is ridden past without a loop and without a problem', () => {
    for (const type of ['pass-left', 'pass-right']) {
      for (const aside of [-1, 1]) {
        const { course, problems } = routeLayout(after(type, aside));
        expect(problems.map((p) => p.text), `${type} ${aside}`).toEqual([]);
        const leg = course.route.legs.find((l) => l.kind === 'connector' && l.from === 'e1');
        const { left, right } = turns(leg.path);
        expect(left + right, `${type} ${aside}`).toBeLessThan(120);
      }
    }
  });

  // The published line is rounded to 1 cm and its arcs are chords: a few centimetres of slack.
  test('the cone is on the side the type says, about WEAVE from the line', () => {
    for (const aside of [-1, 0, 1, 3]) {
      const left = signedSide(routeLayout(after('pass-left', aside)).course, 'e2');
      const right = signedSide(routeLayout(after('pass-right', aside)).course, 'e2');
      expect(left, `left ${aside}`).toBeGreaterThan(1 - 0.05);
      expect(right, `right ${aside}`).toBeLessThan(-1 + 0.05);
    }
    for (const [, c] of filledCourses()) {
      for (const e of c.elements.filter((k) => k.type === 'pass-left' || k.type === 'pass-right')) {
        const d = signedSide(c, e.id);
        expect(e.type === 'pass-left' ? d : -d, `seed ${c.seed} ${e.id}`).toBeGreaterThan(1 - 0.05);
      }
    }
  }, timeout(30_000));

  test('the heading is the route\'s: an axis saved with the element, as in an old file, changes nothing', () => {
    for (const type of FREE_HEADING_TYPES) {
      const want = canonicalJSON(routeLayout(after(type, 1, 0)).course);
      for (const axis of [1, 2.5, 4, 7.5]) expect(canonicalJSON(routeLayout(after(type, 1, axis)).course), `${type} ${axis}`).toBe(want);
      // And routing it again gives the same heading.
      expect(canonicalJSON(routeLayout(after(type, 1, 0)).course)).toBe(want);
    }
  });

  test('an old course file with an axis for a passed cone opens and routes as the route wants', () => {
    const layout = after('pass-left', -1, 6);
    const read = readCourseFile(courseFileText(courseDocument(layout, {})));
    expect(read.ok).toBe(true);
    expect(read.layout.elements[1].axis).toBe(6);
    expect(canonicalJSON(routeLayout(read.layout).course)).toBe(canonicalJSON(routeLayout(after('pass-left', -1, 0)).course));
  });

  test('a small U-turn is entered from whichever side the route comes, the cone on the inside of the turn', () => {
    for (const aside of [-6, 6]) {
      const layout = { recipe, seed: 0, elements: [gate, { type: 'small-turn', sizes: { radius: 4 }, axis: 4, mirrored: aside > 0, x: Math.round(gateExit.x + 10), y: gateExit.y + aside }] };
      const { course, problems } = routeLayout(layout);
      expect(problems.map((p) => p.text), `${aside}`).toEqual([]);
      const e = course.elements[1];
      const cone = course.cones.find((c) => c.id === e.anchor);
      const ring = e.path.slice(1, -1).map((q) => Math.hypot(q[0] - cone.hx / 2, q[1] - cone.hy / 2));
      for (const r of ring) expect(r).toBeGreaterThanOrEqual(4 - 0.01);
      // Entered heading on, not turned round to the axis it was saved with.
      const leg = course.route.legs.find((l) => l.kind === 'connector' && l.to === 'e2');
      const { left, right } = turns(leg.path);
      expect(left + right, `${aside}`).toBeLessThan(150);
    }
  });

  test('«Правка» does not turn them; mirroring still swaps the side', () => {
    const layout = after('pass-left', 1);
    expect(rotateElement(layout, 1, 1)).toBe(layout);
    expect(turnElementTo(layout, 1, 90)).toBe(layout);
    expect(mirrorElement(layout, 1).elements[1].type).toBe('pass-right');
  });
});

describe('«Опорная точка»', () => {
  const recipe = parseRecipe({ ...ANTON, elements: 1 }).recipe;
  const gate = (x, y) => ({ type: 'gate', sizes: { width: 2 }, axis: 0, mirrored: false, x, y });
  const two = { recipe, seed: 0, elements: [gate(8, 12), gate(26, 12)] };
  const point = { type: 'waypoint', sizes: {}, axis: 0, mirrored: false, x: 18, y: 24 };
  const through = { ...two, elements: [two.elements[0], point, two.elements[1]] };
  const near = (course, x, y) => distanceToPath(fullRoute(course), [x, y]);

  test('the route is bent through it: the connector changes and passes within 0.1 m', () => {
    const plain = routeLayout(two).course;
    const { course, problems } = routeLayout(through);
    expect(problems.map((p) => p.text)).toEqual([]);
    expect(near(plain, 18, 24)).toBeGreaterThan(3);
    expect(near(course, 18, 24)).toBeLessThan(0.1);
    // Not a cone: nothing to set out, and it is still ridden through.
    expect(course.cones.length).toBe(plain.cones.length);
    expect(course.elements[1].at).toEqual({ x: 18, y: 24 });
  });

  test('a layout of the routed course routes to the same course', () => {
    const { course } = routeLayout(through);
    expect(canonicalJSON(routeLayout(layoutOf(course)).course)).toBe(canonicalJSON(course));
  });

  test('a press on the plan puts it between the elements whose connector passes nearest', () => {
    const plain = routeLayout(two).course;
    const leg = plain.route.legs.find((l) => l.kind === 'connector' && l.from === 'e1');
    const [x, y] = leg.path[Math.floor(leg.path.length / 2)];
    const next = insertWaypoint(two, x + 2, y + 3);
    expect(next.elements.map((e) => e.type)).toEqual(['gate', 'waypoint', 'gate']);
    expect(next.elements[1]).toMatchObject({ x: Math.round(x + 2), y: Math.round(y + 3) });
    expect(insertElement(two, 1, 'waypoint').elements[1].type).toBe('waypoint');
  });

  test('the course file carries it at version 3; the sheet lists it as a note, not as cones', () => {
    const doc = courseDocument(through, {});
    expect(doc.version).toBe(3);
    expect(courseDocument(two, {}).version).toBeLessThan(3);
    const read = readCourseFile(courseFileText(doc));
    expect(read.ok).toBe(true);
    const { course } = routeLayout(read.layout);
    expect(canonicalJSON(course)).toBe(canonicalJSON(routeLayout(through).course));
    const sheet = buildSetupSheet(course);
    expect(sheet.cards.some((c) => c.element === 'e2' || c.id === 'e2')).toBe(false);
    expect(JSON.stringify(sheet)).toContain('проезд через точку');
    expect(conesCsv(course, sheet)).toBe(conesCsv(routeLayout(two).course, buildSetupSheet(routeLayout(two).course)).replaceAll('2. Ворота', '3. Ворота'));
  });
});

/** Generated courses of the tester's recipe that have fillers. */
function filledCourses() {
  const out = [];
  for (const seed of seeds(20, [2, 4])) {
    const c = antonCourse(seed);
    if (FILLED(c)) out.push([seed, c]);
  }
  return out;
}

describe('a tight small U-turn', () => {
  const inner = innerRect({ width: 40, length: 40, safety: {} });
  // A small U-turn whose exit, heading west (axis 4), is at (20, 10), and an element entered at `entry` on `axis`.
  const turn = { tpl: { type: 'small-turn' }, exit: [20, 10], exitDir: 4 };
  const into = (entry, axis = 4, type = 'straight-slalom') => ({ tpl: { type }, entry, entryDir: axis });

  test('its exit is joined straight to an entry ahead within CHAIN_ANGLE, however far', () => {
    // 6 m ahead and 0.5 m to the side: a connector on the class radius would need an S (or a loop), the rider just rides on.
    const leg = chainLeg(turn, into([14, 10.5]), inner, []);
    expect(leg.points).toEqual([[20, 10], [14, 10.5]]);
    expect(leg.turnLeft + leg.turnRight).toBe(0);
    // Further off the line than CHAIN_ANGLE, facing another way, behind, or through a zone: not chained.
    expect(chainLeg(turn, into([14, 12]), inner, [])).toBeNull();
    expect(chainLeg(turn, into([14, 10.5], 4.5), inner, [])).toBeNull();
    expect(chainLeg(turn, into([24, 10]), inner, [])).toBeNull();
    const wall = { footprint: placeTemplate(tpl('gate', { width: 2 }), 2, 17, 10).footprint };
    expect(chainLeg(turn, into([14, 10.5]), inner, [wall])).toBeNull();
    // Without the asphalt to check (no `inner`) only the short chain of any element is taken.
    expect(chainLeg(turn, into([14, 10.5]))).toBeNull();
    expect(Math.atan2(0.5, 6) * 180 / Math.PI).toBeLessThan(CHAIN_ANGLE);
  });

  test('its entry is joined straight from an exit behind it the same way; other elements keep CHAIN_REACH', () => {
    const before = { tpl: { type: 'straight-slalom' }, exit: [20, 10], exitDir: 4 };
    expect(chainLeg(before, into([14, 10.5], 4, 'small-turn'), inner, []).points).toEqual([[20, 10], [14, 10.5]]);
    expect(chainLeg(before, into([14, 10.5], 4, 'pass-left'), inner, [])).toBeNull();
    expect(chainLeg(before, into([20 - CHAIN_REACH, 10], 4, 'gate'), inner, [])).not.toBeNull();
  });

  test('the user\'s 40 × 52 course: a 3 m U-turn round the cone by the slalom routes 7 → 8 → 9 with no problem', () => {
    // fixtures/edited-40x52.json with element 8 as a 3 m small U-turn 1.4 m from the cone passed there, the
    // slalom a metre lower (y 2) and the lot edge margin 0.5 m. With the slalom at y 3 no 3 m U-turn fits:
    // its way in is 6 m above the slalom's line, and the one connector from element 7 down to it runs
    // through the crescent (element 6), whose line comes down to y 8.
    const read = readCourseFile(readFileSync(new URL('./fixtures/small-turn-40x52.json', import.meta.url), 'utf8'));
    expect(read.ok).toBe(true);
    const { course, problems } = routeLayout(read.layout);
    const turn8 = course.elements[7];
    expect([turn8.type, turn8.params.radius]).toEqual(['small-turn', 3]);
    const near = problems.filter((p) => [7, 8, 9].includes(p.connector) || p.elements.some((e) => ['e8', 'e9'].includes(e)));
    expect(near).toEqual([]);
  });
});
