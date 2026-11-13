// «Двойная замочная скважина»: two keyhole rings with their openings towards
// each other, a loop round each centre cone, the two passes crossing in the
// openings. The catalog's geometry, the sides and colours from the path, the
// generated course, the setup sheet, «Правка» and the course file.

import { describe, expect, test } from 'bun:test';
import { canonicalJSON, ELEMENT_TYPES, generateCourse, LOOPED_TYPES } from '../src/generator/index.js';
import { elementParams, instantiate, isBig, keyholeGapMin, KEYHOLE_NECK, KEYHOLE_NECK_CONES, KEYHOLE_RADIUS, SIZE_OPTIONS, SIZE_SPECS, sizeValues, typeAxes, typicalSizes } from '../src/generator/catalog.js';
import { elementControls, insertElement, layoutOf, mirrorElement, routeLayout } from '../src/generator/layout.js';
import { buildSetupSheet } from '../src/sheet/setup-sheet.js';
import { courseDocument, courseFileText, readCourseFile } from '../src/file/course-file.js';
import { sweepAround } from './helpers/course-geometry.js';

const TYPE = 'double-keyhole';
const KEYHOLE_CLEAR = 1.2;
const tpl = (sizes, { mirrored = false, bike = 'sport' } = {}) => instantiate(TYPE, elementParams(TYPE, sizes, false, bike), false, mirrored);
/** The template in metres: cones, centre cones and the path. */
function metres(t) {
  const cones = t.cones.map((c) => ({ ...c, p: [c.a * t.unit, c.b * t.unit] }));
  return { cones, tall: cones.filter((c) => c.height === 'tall'), low: cones.filter((c) => c.height === 'low'), path: t.path.map(([a, b]) => [a * t.unit, b * t.unit]) };
}
const segDist = (p, a, b) => {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
};
const toPath = (path, p) => Math.min(...path.slice(1).map((q, i) => segDist(p, path[i], q)));

/** Radius of the tightest bend: the circle through each point and the points 2 m before and after it. */
function tightestBend(path) {
  const at = [0];
  for (let i = 1; i < path.length; i++) at.push(at[i - 1] + Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]));
  let best = Infinity;
  for (let i = 0; i < path.length; i++) {
    let j = i;
    while (j > 0 && at[i] - at[j] < 2) j--;
    let k = i;
    while (k < path.length - 1 && at[k] - at[i] < 2) k++;
    if (at[i] - at[j] < 2 || at[k] - at[i] < 2) continue;
    const [a, b, c] = [path[j], path[i], path[k]];
    const cross = Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]));
    if (cross < 1e-9) continue;
    best = Math.min(best, (Math.hypot(b[0] - a[0], b[1] - a[1]) * Math.hypot(c[0] - b[0], c[1] - b[1]) * Math.hypot(a[0] - c[0], a[1] - c[1])) / (2 * cross));
  }
  return best;
}

/** Points where the path crosses itself. */
function selfCrossings(path) {
  const out = [];
  const cross = (u, v) => u[0] * v[1] - u[1] * v[0];
  for (let i = 1; i < path.length; i++) {
    for (let j = i + 2; j < path.length; j++) {
      const [a, b, c, d] = [path[i - 1], path[i], path[j - 1], path[j]];
      const r = [b[0] - a[0], b[1] - a[1]];
      const q = [d[0] - c[0], d[1] - c[1]];
      const den = cross(r, q);
      if (Math.abs(den) < 1e-12) continue;
      const ac = [c[0] - a[0], c[1] - a[1]];
      const t = cross(ac, q) / den;
      const u = cross(ac, r) / den;
      // Half-open, so a crossing at a shared vertex (the middle of an opening) counts once.
      if (t >= 0 && t < 1 && u >= 0 && u < 1) out.push([a[0] + t * r[0], a[1] + t * r[1]]);
    }
  }
  return out;
}

/** Every size of the type in its «Правка» range: the gap from the narrowest the rings allow. */
function* allSizes() {
  const [radius, opening] = SIZE_SPECS[TYPE].slice(0, 2).map((s) => sizeValues(s));
  for (const r of radius) for (const o of opening) for (let g = keyholeGapMin(r, o); g <= 7; g += 0.5) yield { radius: r, opening: o, gap: g };
}

describe('catalog', () => {
  test('is a looped, side-only, always big type, not in «паровозик»', () => {
    expect(ELEMENT_TYPES).toContain(TYPE);
    expect(LOOPED_TYPES).toContain(TYPE);
    expect(typeAxes(TYPE)).toEqual([0, 2, 4, 6]);
    for (const sizes of allSizes()) expect(isBig(tpl(sizes))).toBe(true);
  });

  test('two keyholes of 12 ring and 4 neck cones round two tall centres, the necks the gap apart', () => {
    for (const sizes of allSizes()) {
      const t = tpl(sizes);
      const m = metres(t);
      const p = t.params;
      const radius = p.radius * t.unit;
      expect(m.tall).toHaveLength(2);
      expect(m.low).toHaveLength(32);
      // The anchor is ring A's centre; B's straight across the axis from it.
      expect(t.cones[0]).toEqual({ a: 0, b: 0, height: 'tall' });
      const [ca, cb] = m.tall.map((c) => c.p);
      expect(cb[0]).toBe(0);
      const lowA = m.cones.slice(1, 17);
      const lowB = m.cones.slice(18);
      // Ring cones on the radius, to the half-metre grid.
      for (const c of lowA.slice(0, 12)) expect(Math.abs(Math.hypot(c.p[0] - ca[0], c.p[1] - ca[1]) - radius)).toBeLessThan(0.36);
      // The neck: two cones each side, in line with the ring's end cones and KEYHOLE_NECK apart, outwards towards B.
      const ends = [lowA[0], lowA[11]];
      ends.forEach((end, side) => {
        const neck = lowA.slice(12 + side * KEYHOLE_NECK_CONES, 12 + (side + 1) * KEYHOLE_NECK_CONES);
        neck.forEach((c, i) => expect(c.p).toEqual([end.p[0], end.p[1] - (i + 1) * KEYHOLE_NECK]));
      });
      // The necks' end cones the gap apart; B is A mirrored across the middle of the gap.
      const bottomA = Math.min(...lowA.map((c) => c.p[1]));
      const topB = Math.max(...lowB.map((c) => c.p[1]));
      expect(bottomA - topB).toBeCloseTo(p.gap * t.unit, 9);
      const mid = (ca[1] + cb[1]) / 2;
      expect(lowB.map((c) => [c.p[0], 2 * mid - c.p[1]])).toEqual(lowA.map((c) => c.p));
    }
  });

  test('each pass crosses the other in its ring\'s opening, on the line of centres, and the passes cross in the gap', () => {
    for (const sizes of allSizes()) {
      const t = tpl(sizes);
      const m = metres(t);
      const radius = t.params.radius * t.unit;
      const crossings = selfCrossings(m.path);
      const [ca, cb] = m.tall.map((c) => c.p);
      for (const c of [ca, cb]) {
        const [x, ...rest] = crossings.filter((q) => Math.hypot(q[0] - c[0], q[1] - c[1]) < radius + 0.5);
        expect(rest).toEqual([]);
        expect(x[0]).toBeCloseTo(0, 1);
        expect(Math.abs(x[1] - c[1])).toBeCloseTo(radius, 0);
      }
      // Between the necks: the straight across crosses the way in and the way out, like an eight.
      const lows = m.low.map((c) => c.p[1]);
      const bottomA = Math.min(...lows.filter((y) => y > (ca[1] + cb[1]) / 2));
      const topB = Math.max(...lows.filter((y) => y < (ca[1] + cb[1]) / 2));
      const inGap = crossings.filter((q) => q[1] < bottomA && q[1] > topB);
      expect(inGap.length).toBeGreaterThanOrEqual(2);
    }
  });

  test('the line: through the gap the same way in and out, a loop round each centre, no bend tighter than the loops', () => {
    for (const sizes of allSizes()) {
      const t = tpl(sizes);
      const m = metres(t);
      const radius = t.params.radius * t.unit;
      const loop = radius - KEYHOLE_CLEAR;
      expect(t.entryDir).toEqual([1, 0]);
      expect(t.exitDir).toEqual([1, 0]);
      // 0.96: the 2 m stencil reads a 1.8 m arc a little tight.
      expect(tightestBend(m.path)).toBeGreaterThan(loop * 0.96);
      // The loop runs KEYHOLE_CLEAR inside each ring and round its centre cone.
      for (const c of m.tall) expect(toPath(m.path, c.p)).toBeCloseTo(loop, 1);
      // Every low cone is passed at least 0.6 m away (the keyhole's own is about as close).
      for (const c of m.low) expect(toPath(m.path, c.p), JSON.stringify(sizes)).toBeGreaterThan(0.6);
    }
  });

  test('a gap narrower than the rings allow is raised to it', () => {
    for (const radius of [3, 4, 4.5]) {
      for (const opening of [2, 2.5]) {
        expect(tpl({ radius, opening, gap: 1 }).params.gap * 0.5).toBe(keyholeGapMin(radius, opening));
        expect(keyholeGapMin(radius, opening)).toBe(radius + opening - 2.5);
      }
    }
  });

  test('the sides follow the path: clockwise round A is red, anticlockwise round B blue; mirroring swaps them', () => {
    for (const mirrored of [false, true]) {
      const t = tpl({ radius: 4, opening: 2.5, gap: 4 }, { mirrored });
      const m = metres(t);
      const radius = t.params.radius * t.unit;
      for (const pass of t.passes) {
        const c = m.cones[pass.cone];
        expect(c.height).toBe('tall');
        // Inside the ring the line is one closed loop round its centre: in and out through the crossing.
        const inside = m.path.filter((q) => Math.hypot(q[0] - c.p[0], q[1] - c.p[1]) < radius);
        const swept = sweepAround([...inside, inside[0]], c.p);
        expect(Math.abs(Math.abs(swept) - 360)).toBeLessThan(1);
        expect(pass.side).toBe(swept > 0 ? 'left' : 'right');
      }
      expect(t.passes.map((p) => p.side)).toEqual(mirrored ? ['left', 'right'] : ['right', 'left']);
    }
  });
});

describe('keyhole', () => {
  test('a ring of 12 low cones, a neck of two cones each side, the passes crossing in the opening and leaving the neck nearly parallel', () => {
    for (const radius of sizeValues(SIZE_SPECS.keyhole[0])) {
      for (const opening of sizeValues(SIZE_SPECS.keyhole[1])) {
        const t = instantiate('keyhole', elementParams('keyhole', { radius, opening }, false, 'sport'), false, false);
        const m = metres(t);
        expect(m.low).toHaveLength(12 + 2 * KEYHOLE_NECK_CONES);
        const centre = m.tall[0].p;
        const loop = t.params.radius * t.unit - KEYHOLE_CLEAR;
        expect(toPath(m.path, centre)).toBeCloseTo(loop, 1);
        // The loop, the turns through the opening on the loop's radius; past the neck the passes part on 2 m turns.
        expect(tightestBend(m.path.filter((q) => q[0] > Math.min(...m.low.map((c) => c.p[0]))))).toBeGreaterThan(loop * 0.97);
        expect(tightestBend(m.path)).toBeGreaterThan(Math.min(loop, 2) * 0.97);
        for (const c of m.low) expect(toPath(m.path, c.p), `${radius} ${opening}`).toBeGreaterThan(0.6);
        // One crossing, in the opening: level with the ring's end cones, on the axis through the centre.
        const crossings = selfCrossings(m.path);
        expect(crossings).toHaveLength(1);
        const [x] = crossings;
        const ends = [m.cones[0], m.cones[11]];
        expect(Math.abs(x[0] - ends[0].p[0])).toBeLessThan(0.75);
        expect(x[1]).toBeCloseTo(centre[1], 0);
        // Down the neck the way in and the way out are straight along the axis, under half a metre either side of
        // it; past it they part to 1.5 m either side.
        const neckEnd = Math.min(...m.low.map((c) => c.p[0]));
        const inNeck = m.path.filter((q) => q[0] >= neckEnd - 1e-9 && q[0] < ends[0].p[0]);
        expect(inNeck.length).toBeGreaterThan(0);
        for (const q of inNeck) expect(Math.abs(q[1] - centre[1])).toBeLessThan(0.5);
        for (const q of [m.path[0], m.path.at(-1)]) expect(Math.abs(q[1] - centre[1])).toBeCloseTo(1.5, 9);
        expect(t.entryDir).toEqual([1, 0]);
        expect(t.exitDir).toEqual([-1, 0]);
      }
    }
  });
});

describe('sizes', () => {
  test('the ring radius is the keyhole\'s by bike class; opening and gap by difficulty', () => {
    const want = { easy: [3, 4.5], medium: [2.5, 4], hard: [2, 3.5] };
    for (const bike of ['sport', 'cruiser']) {
      for (const [difficulty, [opening, gap]] of Object.entries(want)) {
        const s = typicalSizes(TYPE, difficulty, bike, {});
        expect(s.radius).toBe(KEYHOLE_RADIUS[bike]);
        expect(s.opening).toBe(Math.min(opening, KEYHOLE_RADIUS[bike] - 1));
        expect(s.gap).toBe(Math.max(gap, keyholeGapMin(KEYHOLE_RADIUS[bike], s.opening)));
      }
    }
  });

  test('the recipe fixes the radius, the opening and the gap', () => {
    expect(SIZE_OPTIONS[TYPE].map((o) => o.key)).toEqual(['radius', 'opening', 'gap']);
    const recipe = { width: 50, length: 60, elements: 2, difficulty: 'medium', bike: 'cruiser', types: [TYPE, 'gate'], sizes: { [TYPE]: { radius: 4, opening: 2, gap: 5.5 } } };
    let seen = 0;
    for (let seed = 1; seed <= 6; seed++) {
      const r = generateCourse(recipe, seed);
      for (const e of r.course?.elements.filter((x) => x.type === TYPE) ?? []) {
        seen++;
        expect([e.params.radius, e.params.opening, e.params.gap].map((v) => v * 0.5)).toEqual([4, 2, 5.5]);
      }
    }
    expect(seen).toBeGreaterThan(0);
  });
});

describe('course', () => {
  const recipe = { width: 50, length: 60, elements: 4, difficulty: 'medium', bike: 'sport', types: [TYPE, 'gate', 'straight-slalom'] };
  const courses = [1, 2, 3, 4, 5].map((seed) => generateCourse(recipe, seed)).filter((r) => r.ok).map((r) => r.course);
  const withIt = courses.filter((c) => c.elements.some((e) => e.type === TYPE));

  test('is generated, at most once a course (a big element)', () => {
    expect(withIt.length).toBeGreaterThan(2);
    for (const c of courses) expect(c.elements.filter((e) => e.type === TYPE).length).toBeLessThanOrEqual(1);
  });

  test('the setup sheet lays out each ring from its centre: radius, cone count, the second centre from the anchor', () => {
    for (const course of withIt) {
      const sheet = buildSetupSheet(course);
      const card = sheet.cards.find((c) => c.type === TYPE);
      const e = course.elements.find((x) => x.type === TYPE);
      const radius = e.params.radius * 0.5;
      expect(card.name).toBe('Двойная замочная скважина');
      expect(card.table).toBe(false);
      expect(card.arcs).toHaveLength(2);
      for (const arc of card.arcs) {
        expect(arc.radius).toBe(radius);
        expect(arc.count).toBe(12);
        expect(arc.degrees).toBeGreaterThan(270);
      }
      // Ring A round the anchor, ring B's centre the line of centres away, where its tall cone stands.
      expect(card.arcs[0].fromAnchor).toEqual({ dx: 0, dy: 0 });
      const { dx, dy } = card.arcs[1].fromAnchor;
      // B's tall cone is off the arcs, at ring B's centre.
      expect(card.loose.find((l) => l.n === card.cones.findIndex((c, i) => i > 0 && c.height === 'tall') + 1)).toMatchObject({ dx, dy });
      expect(card.cones.filter((c) => c.height === 'tall').map((c) => c.color).sort()).toEqual(['blue', 'red']);
      const notes = card.notes.join('\n');
      expect(notes).toContain('кольца по 12 низких конусов');
      expect(notes).toContain('Горловина перед проёмом: по 2 низких конуса');
      expect(notes).toContain('против часовой стрелки');
      expect(notes).toContain('по часовой стрелке');
    }
  });

  test('a course with it saves to a course file and opens back as the same course', () => {
    for (const course of withIt) {
      const read = readCourseFile(courseFileText(courseDocument(layoutOf(course), { build: 'test' })));
      expect(read.ok).toBe(true);
      expect(canonicalJSON(read.layout)).toBe(canonicalJSON(layoutOf(course)));
    }
  });
});

describe('«Правка»', () => {
  const base = generateCourse({ width: 60, length: 60, elements: 1, difficulty: 'medium', bike: 'sport', types: ['gate'] }, 1).course;

  test('is put in from the type picker, with three size rows', () => {
    const layout = insertElement(layoutOf(base), 1, TYPE);
    const i = layout.elements.findIndex((e) => e.type === TYPE);
    expect(i).toBeGreaterThanOrEqual(0);
    expect(elementControls(layout, i).map((c) => [c.name, c.value])).toEqual([['Радиус колец', 4], ['Проём', 2.5], ['Между горловинами', 4]]);
    const routed = routeLayout(layout);
    expect(routed.course.elements[i].type).toBe(TYPE);
  });

  test('mirroring swaps the colours of the centre cones', () => {
    const layout = insertElement(layoutOf(base), 1, TYPE);
    const i = layout.elements.findIndex((e) => e.type === TYPE);
    const colours = (l) => {
      const c = routeLayout(l).course;
      const e = c.elements[i];
      return c.passes.filter((p) => p.element === e.id).map((p) => p.side);
    };
    expect(colours(layout)).toEqual(['right', 'left']);
    expect(colours(mirrorElement(layout, i))).toEqual(['left', 'right']);
  });
});
