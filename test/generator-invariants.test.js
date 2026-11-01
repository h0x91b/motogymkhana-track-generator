// Hard rules of a course, checked on hundreds of seeds through generateCourse.

import { describe, expect, test } from 'bun:test';
import { generateCourse } from '../src/generator/index.js';
import {
  coneXY, conesById, densify, distanceToPath, fullRoute, insidePolygon, polylineEnters, sideOf, sweepAround, turns,
} from './helpers/course-geometry.js';

const RECIPES = [
  { name: '40×60 medium closed', recipe: { width: 40, length: 60, elements: 8, difficulty: 'medium', closed: true }, seeds: 150 },
  { name: '40×60 easy open', recipe: { width: 40, length: 60, elements: 6, difficulty: 'easy', closed: false }, seeds: 80 },
  { name: '30×45 hard closed', recipe: { width: 30, length: 45, elements: 10, difficulty: 'hard', closed: true }, seeds: 80 },
  { name: '60×80 hard open', recipe: { width: 60, length: 80, elements: 15, difficulty: 'hard', closed: false }, seeds: 80 },
  {
    name: 'eights and slaloms only',
    recipe: { width: 40, length: 60, elements: 8, difficulty: 'medium', closed: true, types: ['figure-eight', 'straight-slalom'] },
    seeds: 60,
  },
  { name: '25×30 easy closed (small)', recipe: { width: 25, length: 30, elements: 5, difficulty: 'easy', closed: true }, seeds: 60 },
  { name: '40×60 medium closed train', recipe: { width: 40, length: 60, elements: 8, difficulty: 'medium', closed: true, train: true }, seeds: 80 },
  { name: '60×80 hard open train', recipe: { width: 60, length: 80, elements: 12, difficulty: 'hard', closed: false, train: true }, seeds: 50 },
];

const generated = RECIPES.map(({ name, recipe, seeds }) => {
  const courses = [];
  for (let seed = 0; seed < seeds; seed++) {
    const result = generateCourse(recipe, seed);
    if (!result.ok) throw new Error(`${name} seed ${seed}: ${JSON.stringify(result.error)}`);
    courses.push(result.course);
  }
  return { name, recipe, courses };
});

const each = (fn) => {
  for (const { recipe, courses } of generated) for (const course of courses) fn(course, recipe);
};
const label = (c) => `seed ${c.seed} ${c.site.width}×${c.site.length}`;

const near = (a, b, tol = 0.011) => Math.abs(a[0] - b[0]) <= tol && Math.abs(a[1] - b[1]) <= tol;

describe('placement', () => {
  test('every cone is inside the site with the 1 m margin', () => {
    each((c) => {
      for (const cone of c.cones) {
        const [x, y] = coneXY(cone);
        expect(x >= 1 && x <= c.site.width - 1 && y >= 1 && y <= c.site.length - 1, `${label(c)} ${cone.id} at ${x},${y}`).toBe(true);
      }
    });
  });

  test('the ridden line stays on the site, inside the margin', () => {
    each((c) => {
      for (const p of fullRoute(c)) {
        const ok = p[0] >= 0.99 && p[0] <= c.site.width - 0.99 && p[1] >= 0.99 && p[1] <= c.site.length - 0.99;
        expect(ok, `${label(c)} route point ${p}`).toBe(true);
      }
    });
  });

  test('cones lie on the 0.5 m grid and every anchor on whole metres', () => {
    each((c) => {
      const byId = conesById(c);
      for (const cone of c.cones) expect(Number.isInteger(cone.hx) && Number.isInteger(cone.hy)).toBe(true);
      for (const e of c.elements) {
        const anchor = byId.get(e.anchor);
        expect(anchor.hx % 2 === 0 && anchor.hy % 2 === 0, `${label(c)} ${e.id} anchor`).toBe(true);
        expect(e.cones).toContain(e.anchor);
      }
    });
  });

  test('element axes and zone sides are multiples of 45°', () => {
    each((c) => {
      for (const e of c.elements) {
        expect(Number.isInteger(e.axis) && e.axis >= 0 && e.axis <= 7).toBe(true);
        for (let i = 0; i < 4; i++) {
          const a = e.zone[i];
          const b = e.zone[(i + 1) % 4];
          const deg = (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI;
          // Zone corners are published rounded to 1 cm, hence the 0.5° slack.
          const off = Math.abs(deg - 45 * Math.round(deg / 45));
          expect(off < 0.5, `${label(c)} ${e.id} zone edge at ${deg}°`).toBe(true);
        }
      }
    });
  });

  test('element zones do not overlap', () => {
    each((c) => {
      for (let i = 0; i < c.elements.length; i++) {
        for (let j = i + 1; j < c.elements.length; j++) {
          const a = c.elements[i].zone;
          const b = c.elements[j].zone;
          // Convex quads overlap iff a vertex or the centre of one lies inside the other.
          const centre = (q) => [(q[0][0] + q[2][0]) / 2, (q[0][1] + q[2][1]) / 2];
          const hit = [...a, centre(a)].some((p) => insidePolygon(b, p, 0.02))
            || [...b, centre(b)].some((p) => insidePolygon(a, p, 0.02))
            || polylineEnters([...a, a[0]], b, 0.02);
          expect(hit, `${label(c)} ${c.elements[i].id} overlaps ${c.elements[j].id}`).toBe(false);
        }
      }
    });
  });

  test('connectors never pass through an element zone', () => {
    each((c) => {
      for (const leg of c.route.legs) {
        if (leg.kind !== 'connector') continue;
        for (const e of c.elements) {
          expect(polylineEnters(leg.path, e.zone), `${label(c)} connector ${leg.from}→${leg.to} enters ${e.id}`).toBe(false);
        }
      }
    });
  });

  test('connectors do not ride unmarked loops: at most 300° of turning, 400° for the closing one', () => {
    each((c) => {
      for (const leg of c.route.legs) {
        if (leg.kind !== 'connector') continue;
        const t = turns(leg.path);
        const limit = c.route.closed && leg.to === 'finish' ? 400 : 300;
        expect(t.left + t.right, `${label(c)} ${leg.from}→${leg.to}`).toBeLessThanOrEqual(limit + 1);
      }
    });
  });

  test('the closing connector rides a loop only when no loop-free closed course fits: never on a roomy site', () => {
    let closed = 0;
    let loops = 0;
    for (const { name, recipe, courses } of generated) {
      if (!recipe.closed) continue;
      const roomy = recipe.width >= 30 && recipe.length >= 45;
      for (const c of courses) {
        const last = c.route.legs[c.route.legs.length - 1];
        const t = turns(last.path);
        const loop = t.left + t.right > 301;
        if (roomy) expect(loop, `${name} seed ${c.seed}`).toBe(false);
        closed++;
        if (loop) loops++;
      }
    }
    expect(loops / closed).toBeLessThan(0.03);
  });

  test('no route leg passes over a cone it does not belong to', () => {
    each((c) => {
      const owner = new Map();
      for (const e of c.elements) for (const id of e.cones) owner.set(id, e.id);
      for (const leg of c.route.legs) {
        if (leg.kind !== 'connector') continue;
        for (const cone of c.cones) {
          if (!owner.has(cone.id)) continue;
          expect(distanceToPath(leg.path, coneXY(cone)) > 0.5, `${label(c)} ${leg.from}→${leg.to} runs over ${cone.id}`).toBe(true);
        }
      }
    });
  });
});

describe('cone sides, from the actual geometry of the route', () => {
  test('every tall-cone pass keeps the cone on its required side; blue left, red right', () => {
    each((c) => {
      const byId = conesById(c);
      const elements = new Map(c.elements.map((e) => [e.id, e]));
      for (const pass of c.passes.filter((p) => p.kind === 'cone')) {
        const path = elements.get(pass.element).path;
        expect(sideOf(path, coneXY(byId.get(pass.cone))), `${label(c)} ${pass.id}`).toBe(pass.side);
      }
    });
  });

  test('gates: the left cone stays left and the right cone right in the direction of travel', () => {
    each((c) => {
      const byId = conesById(c);
      const elements = new Map(c.elements.map((e) => [e.id, e]));
      for (const pass of c.passes.filter((p) => p.kind === 'gate')) {
        const path = elements.get(pass.element).path;
        const l = coneXY(byId.get(pass.left));
        const r = coneXY(byId.get(pass.right));
        expect(sideOf(path, l), `${label(c)} ${pass.id} left`).toBe('left');
        expect(sideOf(path, r), `${label(c)} ${pass.id} right`).toBe('right');
        // The rider goes between them: the path crosses the segment l–r.
        const mid = [(l[0] + r[0]) / 2, (l[1] + r[1]) / 2];
        expect(distanceToPath(path, mid)).toBeLessThan(0.3);
      }
    });
  });

  test('each tall cone has one side in all its passes, low cones carry no side', () => {
    each((c) => {
      const sides = new Map();
      const note = (id, side) => {
        if (!sides.has(id)) sides.set(id, new Set());
        sides.get(id).add(side);
      };
      for (const p of c.passes) {
        if (p.kind === 'gate') {
          note(p.left, 'left');
          note(p.right, 'right');
        } else note(p.cone, p.side);
      }
      for (const cone of c.cones) {
        if (cone.height === 'tall') expect(sides.get(cone.id)?.size, `${label(c)} ${cone.id}`).toBe(1);
        else expect(sides.has(cone.id)).toBe(false);
      }
    });
  });
});

describe('element shapes', () => {
  test('figure-eight loops are stretched along the line between the two centre cones', () => {
    let seen = 0;
    each((c) => {
      const byId = conesById(c);
      for (const e of c.elements.filter((x) => x.type === 'figure-eight')) {
        seen++;
        const [a, b] = e.cones.map((id) => coneXY(byId.get(id)));
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        const u = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
        // The loop around a cone: the trajectory within D/2 of it (this leaves out
        // the straight approach and exit runs from the zone edge).
        const dense = densify(e.path, 0.05);
        for (const centre of [a, b]) {
          const other = centre === a ? b : a;
          const loop = dense.filter((p) => {
            const d = Math.hypot(p[0] - centre[0], p[1] - centre[1]);
            return d <= len / 2 + 1e-6 && d < Math.hypot(p[0] - other[0], p[1] - other[1]) + 1e-6;
          });
          const along = loop.map((p) => (p[0] - centre[0]) * u[0] + (p[1] - centre[1]) * u[1]);
          const across = loop.map((p) => -(p[0] - centre[0]) * u[1] + (p[1] - centre[1]) * u[0]);
          const ext = (xs) => Math.max(...xs) - Math.min(...xs);
          expect(ext(along) > ext(across), `${label(c)} ${e.id}`).toBe(true);
          // And the loop goes all the way round its cone.
          expect(Math.abs(sweepAround(loop, centre))).toBeGreaterThan(270);
        }
      }
    });
    expect(seen).toBeGreaterThan(20);
  });

  test('pivot turns are 270° or 360° around their cone, as the pass says', () => {
    let seen = 0;
    each((c) => {
      const byId = conesById(c);
      for (const e of c.elements.filter((x) => x.type === 'pivot-turn')) {
        seen++;
        const pass = c.passes.find((p) => p.element === e.id);
        expect([270, 360]).toContain(pass.angle);
        const cone = coneXY(byId.get(e.anchor));
        const r = Math.min(...e.path.map((p) => Math.hypot(p[0] - cone[0], p[1] - cone[1])));
        const arc = e.path.filter((p) => Math.hypot(p[0] - cone[0], p[1] - cone[1]) <= r * 1.02);
        expect(Math.abs(Math.abs(sweepAround(arc, cone)) - pass.angle), `${label(c)} ${e.id}`).toBeLessThan(11);
      }
    });
    expect(seen).toBeGreaterThan(20);
  });

  test('pivot angles follow the difficulty: easy 270°, hard 360°', () => {
    for (const { recipe, courses } of generated) {
      const angles = courses.flatMap((c) => c.passes.filter((p) => p.angle).map((p) => p.angle));
      if (recipe.difficulty === 'easy') expect(angles.every((a) => a === 270)).toBe(true);
      if (recipe.difficulty === 'hard') expect(angles.every((a) => a === 360)).toBe(true);
    }
  });

  test('slalom steps and gate widths stay in the difficulty ranges', () => {
    const ranges = {
      easy: { slalom: [4.5, 5], gate: [2.25, 2.75] },
      medium: { slalom: [3.5, 4], gate: [1.75, 2.25] },
      hard: { slalom: [3, 3.5], gate: [1.25, 1.75] },
    };
    each((c, recipe) => {
      const byId = conesById(c);
      const r = ranges[recipe.difficulty];
      for (const e of c.elements) {
        const pts = e.cones.map((id) => coneXY(byId.get(id)));
        if (e.type === 'straight-slalom') {
          for (let i = 1; i < pts.length; i++) {
            const d = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
            expect(d >= r.slalom[0] - 1e-9 && d <= r.slalom[1] + 1e-9, `${label(c)} ${e.id} step ${d}`).toBe(true);
          }
          expect(pts.length >= 4 && pts.length <= 6).toBe(true);
        }
        if (e.type === 'gate') {
          const d = Math.hypot(pts[1][0] - pts[0][0], pts[1][1] - pts[0][1]);
          expect(d >= r.gate[0] && d <= r.gate[1], `${label(c)} ${e.id} gate ${d}`).toBe(true);
        }
      }
    });
  });
});

describe('route', () => {
  test('every element is passed exactly once, in order', () => {
    each((c) => {
      const visits = c.route.legs.filter((l) => l.kind === 'element').map((l) => l.element);
      expect(visits).toEqual(c.elements.map((e) => e.id));
      expect(c.elements.map((e) => e.order)).toEqual(c.elements.map((_, i) => i + 1));
      expect(new Set(c.passes.map((p) => p.id)).size).toBe(c.passes.length);
    });
  });

  test('the route is continuous: each connector runs from an exit to the next entry', () => {
    each((c) => {
      const byId = new Map(c.elements.map((e) => [e.id, e]));
      const legs = c.route.legs;
      for (let i = 0; i < legs.length; i++) {
        const leg = legs[i];
        if (leg.kind !== 'connector') continue;
        const from = leg.from === 'start' ? [c.route.start.x, c.route.start.y] : byId.get(leg.from).path.at(-1);
        const to = leg.to === 'finish' ? [c.route.finish.x, c.route.finish.y] : byId.get(leg.to).path[0];
        expect(near(leg.path[0], from), `${label(c)} leg ${i} start`).toBe(true);
        expect(near(leg.path.at(-1), to), `${label(c)} leg ${i} end`).toBe(true);
      }
      expect(legs[0].from).toBe('start');
      expect(legs.at(-1).to).toBe('finish');
    });
  });

  test('a closed course starts and finishes on the same line; an open one on two lines', () => {
    each((c, recipe) => {
      const { start, finish } = c.route;
      if (recipe.closed) {
        expect(finish).toEqual(start);
      } else {
        expect(finish.cones).not.toEqual(start.cones);
      }
      for (const t of [start, finish]) {
        expect(t.cones).toHaveLength(2);
        for (const id of t.cones) expect(conesById(c).get(id).height).toBe('low');
      }
    });
  });

  test('only allowed types are used, never the same type twice in a row', () => {
    each((c, recipe) => {
      const allowed = recipe.types ?? null;
      c.elements.forEach((e, i) => {
        if (allowed) expect(allowed).toContain(e.type);
        if (i > 0) expect(e.type, `${label(c)} ${e.id}`).not.toBe(c.elements[i - 1].type);
      });
    });
  });

  test('never more elements than ordered, and the count is reported', () => {
    each((c, recipe) => {
      expect(c.requested).toBe(recipe.elements);
      expect(c.placed).toBe(c.elements.length);
      expect(c.placed).toBeGreaterThanOrEqual(1);
      expect(c.placed).toBeLessThanOrEqual(recipe.elements);
    });
  });
});

// «Паровозик»: several riders follow each other. Two passes of the route near
// one spot must be far enough apart along the route for the whole column to
// clear it, or riders meet there.
const TRAIN_GAP = 30; // metres of route
const TRAIN_CLEARANCE = 1.5; // closer than this is the same spot

describe('паровозик', () => {
  const trains = generated.filter(({ recipe }) => recipe.train);

  test('has no looped elements: no pivot turn, figure eight or box', () => {
    for (const { courses } of trains) {
      for (const c of courses) {
        for (const e of c.elements) expect(['pivot-turn', 'figure-eight', 'box']).not.toContain(e.type);
      }
    }
  });

  test(`the route never comes back within ${TRAIN_CLEARANCE} m of itself sooner than ${TRAIN_GAP} m of route`, () => {
    for (const { name, courses } of trains) {
      for (const c of courses) {
        const pts = densify(fullRoute(c), 0.25);
        const at = [0];
        for (let i = 1; i < pts.length; i++) at.push(at[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
        const total = at[at.length - 1];
        for (let i = 0; i < pts.length; i++) {
          for (let j = i + 1; j < pts.length; j++) {
            const along = at[j] - at[i];
            // A closed course is ridden round and round: count the way through the finish too.
            const gap = c.route.closed ? Math.min(along, total - along) : along;
            if (gap < 4 || gap >= TRAIN_GAP) continue;
            const d = Math.hypot(pts[j][0] - pts[i][0], pts[j][1] - pts[i][1]);
            if (d < TRAIN_CLEARANCE) throw new Error(`${name} seed ${c.seed}: ${d.toFixed(2)} m apart after ${gap.toFixed(1)} m of route at (${pts[i].map((v) => v.toFixed(1))})`);
          }
        }
      }
    }
  });

  test('still lays out most of what was asked on a roomy site', () => {
    const [{ courses }] = trains;
    const placed = courses.reduce((n, c) => n + c.placed, 0) / courses.length;
    expect(placed).toBeGreaterThan(6.5);
  });
});
