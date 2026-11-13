// Open and bounded elements (ADR 0028): a connector may cross the line ridden
// round a pivot turn, a small U-turn or a passed cone — only their cones block —
// while the line of every other element stays out of the route's way. Through
// the catalog, the generator's connector check and a routed layout.

import { describe, expect, test } from 'bun:test';
import { CROSSABLE_TYPES, crossable, ELEMENT_TYPES, FREE_HEADING_TYPES, generateCourse, WAYPOINT, ZONE_PAD } from '../src/generator/index.js';
import { elementParams, instantiate } from '../src/generator/catalog.js';
import { pathClear, placeTemplate } from '../src/generator/generate.js';
import { layoutOf, routeLayout } from '../src/generator/layout.js';
import { pointsBounds } from '../src/generator/geometry.js';
import { densify, distanceToPath, polylineEnters } from './helpers/course-geometry.js';

const ANTON = { width: 40, length: 38, elements: 6, difficulty: 'medium', bike: 'sport', shape: 'closed' };
const recipe = generateCourse(ANTON, 1).course.recipe;
const routed = (elements, r = recipe) => routeLayout({ recipe: r, seed: 1, elements });
const codes = (result) => result.problems.map((p) => p.code);

/**
 * A short segment across the element's ridden line where the line is farthest
 * from every cone, and the cone's distance from that point.
 */
function acrossLine(p) {
  const line = p.path.slice(1, -1);
  let best = null;
  for (let i = 1; i < line.length; i++) {
    const m = [(line[i - 1][0] + line[i][0]) / 2, (line[i - 1][1] + line[i][1]) / 2];
    const gap = Math.min(...p.spots.map(([x, y]) => Math.hypot(x - m[0], y - m[1])));
    if (!best || gap > best.gap) best = { m, gap, d: [line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]] };
  }
  const len = Math.hypot(...best.d);
  const n = [-best.d[1] / len, best.d[0] / len];
  const points = [[best.m[0] - n[0] * 0.3, best.m[1] - n[1] * 0.3], [best.m[0] + n[0] * 0.3, best.m[1] + n[1] * 0.3]];
  return { points, bounds: pointsBounds(points), gap: best.gap };
}

const placed = (type, sizes = {}) => placeTemplate(instantiate(type, elementParams(type, sizes, false, 'sport'), false, false), 0, 20, 20);

describe('classification', () => {
  test('the pivot turn, the small U-turn, the passed cones and the waypoint are open; everything else is bounded', () => {
    expect([...CROSSABLE_TYPES].sort()).toEqual(['pass-left', 'pass-right', 'pivot-turn', 'small-turn']);
    expect(crossable(WAYPOINT)).toBe(true);
    for (const type of FREE_HEADING_TYPES) expect(crossable(type)).toBe(true);
    for (const type of ['straight-slalom', 'gate', 'box', 'u-turn', 'keyhole', 'snail', 'figure-eight', 'circle']) expect(crossable(type)).toBe(false);
    expect(ELEMENT_TYPES.filter(crossable).length).toBe(CROSSABLE_TYPES.length);
  });
});

describe('connector check', () => {
  test('a connector may cross the line of a pivot turn or a small U-turn, not their cone', () => {
    for (const [type, sizes] of [['pivot-turn', { angle: 360 }], ['pivot-turn', { angle: 90, radius: 3 }], ['small-turn', {}]]) {
      const p = placed(type, sizes);
      const cut = acrossLine(p);
      expect(cut.gap, type).toBeGreaterThan(1);
      expect(pathClear(cut.points, cut.bounds, [p]), type).toBe(true);
      const [cx, cy] = p.spots[0];
      const through = [[cx - 1, cy], [cx + 1, cy]];
      expect(pathClear(through, pointsBounds(through), [p]), type).toBe(false);
    }
  });

  test('a connector may not cross the line of a bounded element away from its cones', () => {
    for (const type of ['straight-slalom', 'keyhole', 'u-turn', 'circle']) {
      const p = placed(type);
      const cut = acrossLine(p);
      expect(cut.gap, type).toBeGreaterThan(1);
      expect(pathClear(cut.points, cut.bounds, [p]), type).toBe(false);
    }
  });
});

describe('a routed layout', () => {
  // The field tester's case: a keyhole, then a 360° pivot turn the connector into it crosses.
  const KEYHOLE_THEN_PIVOT = [
    { type: 'keyhole', sizes: {}, axis: 4, mirrored: false, x: 11, y: 20 },
    { type: 'pivot-turn', sizes: { angle: 360, radius: 4 }, axis: 2, mirrored: false, x: 18, y: 10 },
  ];

  test('a keyhole, then a 360° pivot turn whose line the connector crosses: no problem', () => {
    const result = routed(KEYHOLE_THEN_PIVOT);
    expect(result.problems).toEqual([]);
    const pivot = result.course.elements[1];
    const leg = result.course.route.legs.find((l) => l.kind === 'connector' && l.to === pivot.id);
    // It really does come into the ridden ring's clearance, which a bounded element keeps it out of.
    const near = Math.min(...densify(leg.path, 0.05).map((p) => distanceToPath(pivot.path.slice(1, -1), p)));
    expect(near).toBeLessThan(ZONE_PAD);
  });

  test('a connector through a slalom is still a problem', () => {
    const result = routed([
      { type: 'gate', sizes: { width: 2 }, axis: 6, mirrored: false, x: 6, y: 10 },
      { type: 'straight-slalom', sizes: {}, axis: 2, mirrored: false, x: 6, y: 20 },
      { type: 'circle', sizes: {}, axis: 0, mirrored: false, x: 26, y: 22 },
    ]);
    expect(codes(result)).toEqual(['connector-zone']);
    expect(result.problems[0].text).toContain('через элемент 2');
    // The closing connector joins 3 and the start; the slalom it goes through is marked too.
    expect(result.problems[0].elements.sort()).toEqual(['e1', 'e2', 'e3']);
  });

  test('in a train the connector still may not cross the pivot turn: the route never crosses itself', () => {
    const elements = [
      { type: 'gate', sizes: { width: 2 }, axis: 4, mirrored: false, x: 10, y: 10 },
      { type: 'pivot-turn', sizes: { angle: 270, radius: 4 }, axis: 2, mirrored: false, x: 20, y: 10 },
    ];
    expect(routed(elements).problems).toEqual([]);
    expect(codes(routed(elements, { ...recipe, train: true }))).toContain('connector-train');
  });

  test('a connector through the empty corner of a bounded element\'s rectangle is not a problem', () => {
    let corners = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const { course } = generateCourse(ANTON, seed);
      expect(routeLayout(layoutOf(course)).problems, `seed ${seed}`).toEqual([]);
      for (const leg of course.route.legs.filter((l) => l.kind === 'connector')) {
        for (const e of course.elements) {
          if (!crossable(e.type) && polylineEnters(leg.path, e.zone, 0.3)) corners++;
        }
      }
    }
    expect(corners).toBeGreaterThan(0);
  });
});
