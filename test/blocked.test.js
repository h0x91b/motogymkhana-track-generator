// Blocked areas: cutouts of a lot that is not a rectangle and obstacles on it.
// Nothing of a course comes nearer than the site margin to one, run-off zones
// and the lines' waiting areas stay out of them, and a lot without any routes
// exactly as before.

import { describe, expect, test } from 'bun:test';
import {
  addBlocked, generateCourse, layoutOf, moveBlocked, parseLayout, parseRecipe, removeBlocked, resizeBlocked, routeLayout,
} from '../src/generator/index.js';
import { freeRects, blockedAreas } from '../src/generator/generate.js';
import { buildSetupSheet } from '../src/sheet/setup-sheet.js';
import { coneXY, densify, insidePolygon } from './helpers/course-geometry.js';
import { slowTest, sweep } from './helpers/slow.js';

const MARGIN = 1;
// Anton's П-shaped lot: 40 × 38 m with a 12 × 22 m bite out of one long side.
const P_CUTOUT = { kind: 'cutout', x: 14, y: 0, w: 12, h: 22 };
const P_LOT = { width: 40, length: 38, elements: 6, difficulty: 'medium', bike: 'sport', blocked: [P_CUTOUT] };

/** Distance from a point to a rectangle {x, y, w, h}; 0 inside it. */
function toRect(p, b) {
  const dx = Math.max(b.x - p[0], 0, p[0] - (b.x + b.w));
  const dy = Math.max(b.y - p[1], 0, p[1] - (b.y + b.h));
  return Math.hypot(dx, dy);
}

/** Points of the rectangle's interior on a fine grid, a little in from its edges. */
function interior(b) {
  const out = [];
  for (let i = 0; i <= 20; i++) for (let j = 0; j <= 20; j++) out.push([b.x + 0.05 + ((b.w - 0.1) * i) / 20, b.y + 0.05 + ((b.h - 0.1) * j) / 20]);
  return out;
}

/** Every way the course breaks the rules of blocked areas, as text; empty when it keeps them. */
function blockedFaults(course) {
  const faults = [];
  const blocked = course.recipe.blocked;
  const cones = new Map(course.cones.map((c) => [c.id, c]));
  for (const b of blocked) {
    for (const c of course.cones) {
      if (toRect(coneXY(c), b) < MARGIN - 1e-6) faults.push(`cone ${c.id} ${toRect(coneXY(c), b).toFixed(2)} m from ${b.kind}`);
    }
    for (const e of course.elements) {
      for (const p of densify(e.path, 0.1)) if (toRect(p, b) < MARGIN - 0.02) faults.push(`${e.id} line within the margin of ${b.kind}`);
      if (e.runOff && interior(b).some((p) => insidePolygon(e.runOff, p, 0.01))) faults.push(`${e.id} run-off zone on ${b.kind}`);
    }
    for (const leg of course.route.legs) {
      if (leg.kind !== 'connector') continue;
      if (densify(leg.path, 0.1).some((p) => toRect(p, b) < MARGIN - 0.02)) faults.push(`connector ${leg.from} → ${leg.to} within the margin of ${b.kind}`);
    }
    for (const t of [course.route.start, course.route.finish]) {
      if (interior(b).some((p) => insidePolygon(t.zone, p, 0.01))) faults.push(`line ${t.cones.join('/')} waits on ${b.kind}`);
      for (const id of t.cones) if (toRect(coneXY(cones.get(id)), b) < MARGIN - 1e-6) faults.push(`line cone ${id} too close`);
    }
  }
  return faults;
}

describe('the recipe', () => {
  test('reads blocked areas from form strings, whole metres from corner A', () => {
    const r = parseRecipe({ ...P_LOT, blocked: [{ kind: 'obstacle', x: '3', y: '30', w: '2', h: '5' }] });
    expect(r.ok).toBe(true);
    expect(r.recipe.blocked).toEqual([{ kind: 'obstacle', x: 3, y: 30, w: 2, h: 5 }]);
  });

  test('a recipe without them has none', () => {
    expect(parseRecipe({ width: 40, length: 60, elements: 6, difficulty: 'easy' }).recipe.blocked).toEqual([]);
  });

  test('refuses areas off the site, fractional, empty or of an unknown kind', () => {
    const bad = [
      { kind: 'cutout', x: 30, y: 0, w: 12, h: 5 },
      { kind: 'cutout', x: 0, y: 30, w: 5, h: 10 },
      { kind: 'obstacle', x: 1.5, y: 1, w: 2, h: 5 },
      { kind: 'obstacle', x: 1, y: 1, w: 0, h: 5 },
      { kind: 'obstacle', x: '', y: 1, w: 2, h: 5 },
      { kind: 'tree', x: 1, y: 1, w: 2, h: 5 },
    ];
    for (const b of bad) {
      const r = parseRecipe({ ...P_LOT, blocked: [b] });
      expect(r.ok).toBe(false);
      expect(typeof r.errors.blocked).toBe('string');
    }
    expect(parseRecipe({ ...P_LOT, blocked: Array.from({ length: 9 }, () => P_CUTOUT) }).ok).toBe(false);
  });
});

describe('free asphalt', () => {
  test('a П-shaped lot is two legs and a bar', () => {
    const rects = freeRects(40, 38, blockedAreas(P_LOT));
    expect(rects).toContainEqual([0, 0, 14, 38]);
    expect(rects).toContainEqual([26, 0, 40, 38]);
    expect(rects).toContainEqual([0, 22, 40, 38]);
    expect(rects).toHaveLength(3);
  });
});

describe('generation', () => {
  const LOTS = [
    { name: 'П-shaped 40×38 medium sport open', recipe: P_LOT, seeds: sweep(40, 3) },
    {
      name: '40×60 hard closed with a car and a pillar',
      recipe: {
        width: 40, length: 60, elements: 8, difficulty: 'hard', shape: 'closed',
        blocked: [{ kind: 'obstacle', x: 18, y: 28, w: 2, h: 5 }, { kind: 'obstacle', x: 8, y: 10, w: 1, h: 1 }],
      },
      seeds: sweep(30, 2),
    },
    {
      name: '40×60 medium return with a cut corner',
      recipe: { width: 40, length: 60, elements: 6, difficulty: 'medium', shape: 'return', blocked: [{ kind: 'cutout', x: 25, y: 40, w: 15, h: 20 }] },
      seeds: sweep(30, 2),
    },
    {
      name: 'П-shaped closed train',
      recipe: { ...P_LOT, shape: 'closed', train: true, elements: 5 },
      seeds: sweep(30, 2),
    },
  ];
  for (const { name, recipe, seeds } of LOTS) {
    test(`${name}: nothing comes within the margin of a blocked area`, () => {
      for (let seed = 1; seed <= seeds; seed++) {
        const r = generateCourse(recipe, seed);
        expect(r.ok).toBe(true);
        expect({ seed, faults: blockedFaults(r.course) }).toEqual({ seed, faults: [] });
      }
    }, 60_000);
  }

  slowTest('a П-shaped lot fits more than the biggest rectangle inside it', () => {
    const mean = (recipe) => {
      let sum = 0;
      for (let seed = 1; seed <= 30; seed++) sum += generateCourse(recipe, seed).course.placed;
      return sum / 30;
    };
    const p = mean(P_LOT);
    const bar = mean({ ...P_LOT, length: 16, blocked: [] });
    const leg = mean({ ...P_LOT, width: 14, blocked: [] });
    expect(p).toBeGreaterThan(Math.max(bar, leg));
  }, 60_000);

  test('a lot without blocked areas routes exactly as before: no list and an empty list are one course', () => {
    const recipe = { width: 40, length: 38, elements: 6, difficulty: 'medium', bike: 'sport' };
    for (let seed = 1; seed <= sweep(10, 2); seed++) {
      expect(JSON.stringify(generateCourse({ ...recipe, blocked: [] }, seed))).toBe(JSON.stringify(generateCourse(recipe, seed)));
    }
  }, 30_000);

  test('the course carries the blocked areas on its site', () => {
    const r = generateCourse(P_LOT, 3);
    expect(r.course.site.blocked).toEqual([P_CUTOUT]);
  });
});

describe('«Правка»', () => {
  const plain = { width: 40, length: 60, elements: 4, difficulty: 'medium' };
  const layout = layoutOf(generateCourse(plain, 5).course);

  test('the layout from a lot with blocked areas routes back to the same course, with no problems', () => {
    const course = generateCourse(P_LOT, 4).course;
    const routed = routeLayout(layoutOf(course));
    expect(routed.problems).toEqual([]);
    expect(routed.course.cones).toEqual(course.cones);
  });

  test('an obstacle put on an element is a problem that names both', () => {
    const el = layout.elements[0];
    const on = addBlocked(layout, 'obstacle');
    const moved = moveBlocked(on, 0, el.x, el.y);
    const { problems } = routeLayout(moved);
    const p = problems.find((q) => q.code === 'blocked');
    expect(p.elements).toEqual(['e1']);
    expect(p.text).toContain('препятствие 1');
  });

  test('a cutout under a run-off zone is a problem of that zone', () => {
    const course = generateCourse({ ...plain, types: ['u-turn'], elements: 1 }, 2).course;
    const l = layoutOf(course);
    const e = course.elements[0];
    const own = [...e.path, ...e.cones.map((id) => coneXY(course.cones.find((c) => c.id === id)))];
    // A 1 × 1 m cutout just inside a corner of the run-off zone, well clear of the element's cones and line.
    const c = [e.runOff.reduce((t, p) => t + p[0], 0) / 4, e.runOff.reduce((t, p) => t + p[1], 0) / 4];
    const strip = e.runOff.map(([x, y]) => {
      const d = Math.hypot(c[0] - x, c[1] - y);
      const at = [x + ((c[0] - x) * 2) / d, y + ((c[1] - y) * 2) / d];
      return { kind: 'cutout', x: Math.round(at[0] - 0.5), y: Math.round(at[1] - 0.5), w: 1, h: 1 };
    }).find((b) => own.every((p) => toRect(p, b) >= 2) && [[b.x, b.y], [b.x + 1, b.y + 1]].every((p) => insidePolygon(e.runOff, p)));
    const { problems } = routeLayout({ ...l, recipe: { ...l.recipe, blocked: [strip] } });
    expect(problems.map((p) => p.code)).toContain('run-off-blocked');
  });

  test('blocked areas stay on the site, at least 1 × 1 m, and edits never touch the layout they start from', () => {
    const before = JSON.stringify(layout);
    const a = addBlocked(addBlocked(layout, 'cutout'), 'obstacle');
    expect(a.recipe.blocked.map((b) => b.kind)).toEqual(['cutout', 'obstacle']);
    expect(moveBlocked(a, 1, 100, -5).recipe.blocked[1]).toEqual({ kind: 'obstacle', x: 38, y: 0, w: 2, h: 5 });
    expect(resizeBlocked(a, 0, 0, 80).recipe.blocked[0]).toEqual({ kind: 'cutout', x: 0, y: 0, w: 1, h: 60 });
    expect(removeBlocked(a, 0).recipe.blocked).toEqual([a.recipe.blocked[1]]);
    expect(JSON.stringify(layout)).toBe(before);
  });

  test('a layout keeps its blocked areas through storage', () => {
    const a = moveBlocked(addBlocked(layout, 'obstacle'), 0, 3, 4);
    expect(parseLayout(JSON.parse(JSON.stringify(a))).recipe.blocked).toEqual([{ kind: 'obstacle', x: 3, y: 4, w: 2, h: 5 }]);
  });
});

describe('the setup sheet', () => {
  test('measures each blocked area from corner A: its nearest corner, then its size', () => {
    const sheet = buildSetupSheet(generateCourse({ ...P_LOT, blocked: [P_CUTOUT, { kind: 'obstacle', x: 3, y: 30, w: 2, h: 5 }] }, 7).course);
    expect(sheet.site.blocked.map((b) => b.label.replace(/\u00a0/g, ' '))).toEqual([
      'Вырез 1: угол X 14 · Y 0 м, по X 12 м, по Y 22 м',
      'Препятствие 2: угол X 3 · Y 30 м, по X 2 м, по Y 5 м',
    ]);
  });
});
