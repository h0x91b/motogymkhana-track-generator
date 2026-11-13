// Hard rules of a course, checked through generateCourse on a few seeds per
// recipe by default and on hundreds with SLOW=1 (helpers/slow.js). A recipe with
// no fast seeds is covered by another recipe in the default run. The fast seeds
// are ones that lay out at once: another seed of a recipe can take ten times as long.

import { describe, expect, test } from 'bun:test';
import {
  BIG_ELEMENT_AREA, FREE_HEADING_TYPES, BIKE_TURN_RADIUS, CHAIN_ANGLE, DIFFICULTY_TABLE, CHAIN_REACH, generateCourse, LOOPED_TYPES, RUN_OFF, RUN_OFF_TYPES, runOffFor, TRAIN_EXEMPT_TYPES,
  U_TURN_CONE_CLEARANCE, uTurnRadius, ZONE_PAD,
} from '../src/generator/index.js';

// Types whose U-turns are sized by the bike class (the rest keep difficulty sizes).
const CLASS_SIZED_TYPES = ['u-turn', 'box', 'pivot-turn', 'mirror', 'gate-turn', 'figure-eight'];
import {
  barrierOf, coneXY, conesById, densify, distanceToFootprint, distanceToPath, distanceToPolygon, footprintGap, footprintOf, fullRoute, insidePolygon, polylineEnters, sideOf, sweepAround,
  turns,
} from './helpers/course-geometry.js';
import { SLOW, slowTest, sweep, timeout } from './helpers/slow.js';

const RECIPES = [
  { name: '40×60 medium closed', recipe: { width: 40, length: 60, elements: 8, difficulty: 'medium', shape: 'closed' }, seeds: sweep(150, [9]) },
  { name: '40×60 easy open', recipe: { width: 40, length: 60, elements: 6, difficulty: 'easy', shape: 'open' }, seeds: sweep(80, [2]) },
  { name: '30×45 hard closed', recipe: { width: 30, length: 45, elements: 10, difficulty: 'hard', shape: 'closed' }, seeds: sweep(80, [2]) },
  { name: '40×60 hard closed sport', recipe: { width: 40, length: 60, elements: 8, difficulty: 'hard', bike: 'sport', shape: 'closed' }, seeds: sweep(60, [6]) },
  { name: '60×80 hard open', recipe: { width: 60, length: 80, elements: 15, difficulty: 'hard', shape: 'open' }, seeds: sweep(80, 1) },
  {
    name: 'eights and slaloms only',
    recipe: { width: 40, length: 60, elements: 8, difficulty: 'medium', shape: 'closed', types: ['figure-eight', 'straight-slalom'] },
    seeds: sweep(60, 2),
  },
  { name: '25×30 easy closed (small)', recipe: { width: 25, length: 30, elements: 5, difficulty: 'easy', shape: 'closed' }, seeds: sweep(60, [10]) },
  { name: '40×60 medium closed train', recipe: { width: 40, length: 60, elements: 8, difficulty: 'medium', shape: 'closed', train: true }, seeds: sweep(80, [14]) },
  { name: '40×60 medium return', recipe: { width: 40, length: 60, elements: 8, difficulty: 'medium', shape: 'return' }, seeds: sweep(100, 1) },
  { name: '30×45 hard return', recipe: { width: 30, length: 45, elements: 10, difficulty: 'hard', shape: 'return' }, seeds: sweep(60, 0) },
  { name: '25×30 easy return (small)', recipe: { width: 25, length: 30, elements: 5, difficulty: 'easy', shape: 'return' }, seeds: sweep(40, [1]) },
  { name: '40×60 hard return train (form default)', recipe: { width: 40, length: 60, elements: 8, difficulty: 'hard', shape: 'return', train: true }, seeds: sweep(60, [2]) },
  { name: '60×80 hard open train', recipe: { width: 60, length: 80, elements: 12, difficulty: 'hard', shape: 'open', train: true }, seeds: sweep(50, [3]) },
  {
    name: '50×70 medium closed, fixed sizes',
    recipe: {
      width: 50, length: 70, elements: 8, difficulty: 'medium', shape: 'closed',
      sizes: {
        'straight-slalom': { step: 3 }, 'offset-slalom': { step: 7 }, gate: { width: 3.5 }, 'lane-change': { shift: 4 },
        'u-turn': { width: 8 }, 'figure-eight': { distance: 12 }, box: { size: 16 }, circle: { radius: 5 }, tunnel: { gap: 6 },
        zigzag: { step: 2.5 }, 'corridor-slalom': { width: 3, step: 5 }, keyhole: { radius: 4.5 }, crescent: { radius: 8 },
      },
    },
    seeds: sweep(60, [5]),
  },
  {
    // Few seeds of the mixed recipes miss some types: this one puts every
    // class-sized U-turn and every type with its own shape test on the course
    // (figure eights come from the eights-and-slaloms recipe).
    name: 'turning and shaped types',
    recipe: {
      width: 40, length: 60, elements: 8, difficulty: 'medium', shape: 'closed',
      types: ['u-turn', 'box', 'pivot-turn', 'mirror', 'gate-turn', 'lane-change'],
    },
    // Fast: three cheap seeds that between them deal every type of the recipe.
    seeds: sweep(30, [113, 156, 223]),
  },
  {
    name: 'only big types',
    recipe: { width: 40, length: 60, elements: 6, difficulty: 'easy', shape: 'closed', types: ['snail', 'crescent'] },
    seeds: sweep(30, 1),
  },
  {
    name: 'only big types, train',
    recipe: { width: 40, length: 60, elements: 4, difficulty: 'hard', shape: 'open', train: true, types: ['snail', 'crescent', 'figure-eight'] },
    seeds: sweep(30, 2),
  },
];

const generated = RECIPES.map(({ name, recipe, seeds }) => {
  const courses = [];
  for (const seed of Array.isArray(seeds) ? seeds : Array.from({ length: seeds }, (_, k) => k)) {
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

/** Area of an element's core in m²: its zone without the 0.75 m clearance on each side. */
function coreArea(e) {
  const [a, b, c] = e.zone;
  const side = (p, q) => Math.hypot(q[0] - p[0], q[1] - p[1]) - 2 * 0.75;
  return side(a, b) * side(b, c);
}

/**
 * Radius of the tightest bend of a polyline: the circle through each vertex and
 * the nearest vertices at least 2 m before and after it. The wide stencil keeps
 * the 0.01 m rounding of the output from showing up as a sharp bend.
 */
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
    const r = (Math.hypot(b[0] - a[0], b[1] - a[1]) * Math.hypot(c[0] - b[0], c[1] - b[1]) * Math.hypot(a[0] - c[0], a[1] - c[1])) / (2 * cross);
    best = Math.min(best, r);
  }
  return best;
}

/** Where the path crosses the segment a–b: the signed crossing direction of each crossing. */
function crossingsOf(path, a, b) {
  const out = [];
  const side = (p) => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
  for (let i = 1; i < path.length; i++) {
    const s0 = side(path[i - 1]);
    const s1 = side(path[i]);
    if (s0 === 0 || Math.sign(s0) === Math.sign(s1)) continue;
    const t = s0 / (s0 - s1);
    const x = [path[i - 1][0] + t * (path[i][0] - path[i - 1][0]), path[i - 1][1] + t * (path[i][1] - path[i - 1][1])];
    const along = ((x[0] - a[0]) * (b[0] - a[0]) + (x[1] - a[1]) * (b[1] - a[1])) / ((b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2);
    if (along > 0 && along < 1) out.push(s1 - s0);
  }
  return out;
}

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
      for (const cone of c.cones) expect(Number.isInteger(cone.hx) && Number.isInteger(cone.hy), `${label(c)} ${cone.id}`).toBe(true);
      for (const e of c.elements) {
        const anchor = byId.get(e.anchor);
        expect(anchor.hx % 2 === 0 && anchor.hy % 2 === 0, `${label(c)} ${e.id} anchor`).toBe(true);
        expect(e.cones).toContain(e.anchor);
      }
    });
  });

  test('element axes and zone sides are multiples of 45°; a free-heading one\'s of 22.5°', () => {
    each((c) => {
      for (const e of c.elements) {
        // The route turns a free-heading element (ADR 0027) to any of sixteen headings.
        const step = FREE_HEADING_TYPES.includes(e.type) ? 22.5 : 45;
        expect(Number.isInteger((e.axis * 45) / step) && e.axis >= 0 && e.axis < 8).toBe(true);
        for (let i = 0; i < 4; i++) {
          const a = e.zone[i];
          const b = e.zone[(i + 1) % 4];
          const deg = (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI;
          // Zone corners are published rounded to 1 cm, hence the 0.5° slack.
          const off = Math.abs(deg - step * Math.round(deg / step));
          expect(off < 0.5, `${label(c)} ${e.id} zone edge at ${deg}°`).toBe(true);
        }
      }
    });
  });

  // Footprints: the cones, walls, chalk lines and the line ridden of each
  // element, each with ZONE_PAD of clearance. Measured on the published
  // course, 1 cm rounding and 5 cm sampling included in the 0.03 m slack.
  test('element footprints keep apart: cones, lines and the lines ridden of two elements at least twice the clearance', () => {
    expect(ZONE_PAD).toBe(0.75);
    let near = 0;
    each((c) => {
      const fps = c.elements.map((e) => footprintOf(c, e));
      for (let i = 0; i < fps.length; i++) {
        for (let j = i + 1; j < fps.length; j++) {
          const gap = footprintGap(fps[i], fps[j]);
          expect(gap, `${label(c)} ${c.elements[i].id} and ${c.elements[j].id}`).toBeGreaterThan(2 * ZONE_PAD - 0.03);
          if (gap < 2 * ZONE_PAD + 1) near++;
        }
      }
    });
    // The point of footprints: elements stand closer than their zone rectangles
    // allowed. A count over many courses: the slow suite only.
    if (SLOW) expect(near).toBeGreaterThan(50);
  });

  test('the route keeps the clearance from every element: connectors, run-ins and run-outs never cut into a footprint, or into the cones of an open element', () => {
    each((c) => {
      const fps = new Map(c.elements.map((e) => [e.id, barrierOf(c, e)]));
      const pieces = [
        ...c.route.legs.filter((l) => l.kind === 'connector').map((l) => ({ name: `connector ${l.from}→${l.to}`, path: l.path })),
        ...c.elements.flatMap((e) => [
          { name: `run-in of ${e.id}`, path: e.path.slice(0, 2), own: e.id },
          { name: `run-out of ${e.id}`, path: e.path.slice(-2), own: e.id },
        ]),
      ];
      for (const { name, path, own } of pieces) {
        const xs = path.map((p) => p[0]);
        const ys = path.map((p) => p[1]);
        const near = [...fps].filter(([id, fp]) => id !== own && fp.bounds[0] - 1 < Math.max(...xs) && Math.min(...xs) < fp.bounds[2] + 1
          && fp.bounds[1] - 1 < Math.max(...ys) && Math.min(...ys) < fp.bounds[3] + 1);
        if (!near.length) continue;
        for (const p of densify(path, 0.1)) {
          for (const [id, fp] of near) {
            expect(distanceToFootprint(fp, p), `${label(c)} ${name} cuts into ${id}`).toBeGreaterThan(ZONE_PAD - 0.03);
          }
        }
      }
    });
  }, timeout(30_000));

  test('an exit chained into the next entry is joined by a straight no longer than 0.5 m along the way the rider goes', () => {
    expect([CHAIN_REACH, CHAIN_ANGLE]).toEqual([0.5, 10]);
    let chains = 0;
    each((c) => {
      const byId = new Map(c.elements.map((e) => [e.id, e]));
      for (const leg of c.route.legs) {
        if (leg.kind !== 'connector' || leg.from === 'start' || leg.to === 'finish') continue;
        const [from, to] = [byId.get(leg.from), byId.get(leg.to)];
        const d = Math.hypot(to.entry.x - from.exit.x, to.entry.y - from.exit.y);
        if (d > CHAIN_REACH + 0.02) continue;
        chains++;
        expect(leg.path.length, `${label(c)} ${leg.from}→${leg.to}`).toBe(2);
        expect(from.exit.dir, `${label(c)} ${leg.from}→${leg.to}`).toBe(to.entry.dir);
        if (d > 0.05) {
          const off = Math.abs(Math.atan2(to.entry.y - from.exit.y, to.entry.x - from.exit.x) - (from.exit.dir * Math.PI) / 4);
          expect(Math.min(off, 2 * Math.PI - off), `${label(c)} ${leg.from}→${leg.to}`).toBeLessThan(((CHAIN_ANGLE + 1) * Math.PI) / 180);
        }
      }
    });
    // Chains do happen (a count over many courses: the slow suite only).
    if (SLOW) expect(chains).toBeGreaterThan(5);
  });

  test('turning elements keep a run-off zone of free asphalt inside the site', () => {
    const toLine = (p, a, b) => Math.abs((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])) / Math.hypot(b[0] - a[0], b[1] - a[1]);
    let seen = 0;
    each((c) => {
      const byId = conesById(c);
      const start = c.route.start.cones.map((id) => coneXY(byId.get(id)));
      // A closed course's finish is its start line, a `return` one's its start box.
      const finish = c.route.shape !== 'open' ? [] : c.route.finish.cones.map((id) => coneXY(byId.get(id)));
      c.elements.forEach((e, i) => {
        expect(Boolean(e.runOff), `${label(c)} ${e.id} ${e.type} run-off`).toBe(Boolean(RUN_OFF_TYPES[e.type]));
        if (!e.runOff) return;
        seen++;
        for (const [x, y] of e.runOff) {
          expect(x >= -0.011 && y >= -0.011 && x <= c.site.width + 0.011 && y <= c.site.length + 0.011, `${label(c)} ${e.id} run-off off the site`).toBe(true);
        }
        // Every side lies its run-off from the element's cones and line, but the entry side of a turnaround.
        const own = [...e.cones.map((id) => coneXY(byId.get(id))), ...e.path.slice(1, -1)];
        const sides = e.runOff.map((p, k) => [p, e.runOff[(k + 1) % e.runOff.length]]).filter(([p, q]) => Math.hypot(q[0] - p[0], q[1] - p[1]) > 0.05);
        // A single-cone element keeps a shorter one (ADR 0021).
        const reach = runOffFor(e.type, RUN_OFF);
        const short = sides.filter(([p, q]) => Math.min(...own.map((o) => toLine(o, p, q))) < reach - 0.03);
        expect(short.length, `${label(c)} ${e.id} ${e.type} sides short of ${reach} m`).toBeLessThanOrEqual(RUN_OFF_TYPES[e.type] === 'loop' ? 0 : 1);
        // And no other element's footprint in it: its cones and lines keep the clearance from it.
        for (const other of c.elements) {
          if (other === e) continue;
          const fp = footprintOf(c, other);
          for (const p of [...fp.cones, ...fp.segments.flatMap((s) => densify(s, 0.1))]) {
            expect(distanceToPolygon(e.runOff, p), `${label(c)} ${other.id} in the run-off of ${e.id}`).toBeGreaterThanOrEqual(ZONE_PAD - 0.03);
          }
        }
        // Start and finish lines stay out, except the element's own.
        const lines = [...(i === 0 ? [] : start), ...(i === c.elements.length - 1 ? [] : finish)];
        for (const p of lines) expect(insidePolygon(e.runOff, p, 0.02), `${label(c)} start/finish cone in the run-off of ${e.id}`).toBe(false);
        for (const leg of c.route.legs) {
          for (const id of leg.cones ?? []) {
            expect(insidePolygon(e.runOff, coneXY(byId.get(id)), 0.02), `${label(c)} U-turn cone ${id} of ${leg.from}→${leg.to} in the run-off of ${e.id}`).toBe(false);
          }
        }
      });
    });
    expect(seen).toBeGreaterThan(sweep(100, 0));
  }, timeout(30_000));

  test('connectors turn no tighter than the bike allows: Ø 9 m on a cruiser, Ø 7.5 m on a sport bike', () => {
    expect(BIKE_TURN_RADIUS).toEqual({ sport: 3.75, cruiser: 4.5 });
    each((c, recipe) => {
      const radius = BIKE_TURN_RADIUS[recipe.bike ?? 'cruiser'];
      for (const leg of c.route.legs.filter((l) => l.kind === 'connector')) {
        expect(tightestBend(leg.path), label(c)).toBeGreaterThan(radius * 0.97);
      }
    });
  });

  test('U-turns inside elements turn no tighter than connectors: the bike class sets the minimum, difficulty adds margin', () => {
    expect(uTurnRadius('hard', 'cruiser')).toBe(4.5);
    expect(uTurnRadius('hard', 'sport')).toBe(3.75);
    expect(uTurnRadius('medium', 'cruiser')).toBe(5);
    expect(uTurnRadius('easy', 'sport')).toBe(4.75);
    const seen = new Set();
    each((c, recipe) => {
      const bike = recipe.bike ?? 'cruiser';
      for (const e of c.elements) {
        if (!CLASS_SIZED_TYPES.includes(e.type)) continue;
        seen.add(e.type);
        expect(tightestBend(e.path), `${label(c)} ${e.id} ${e.type}`).toBeGreaterThan(BIKE_TURN_RADIUS[bike] * 0.97);
        expect(tightestBend(e.path), `${label(c)} ${e.id} ${e.type}`).toBeGreaterThan(uTurnRadius(recipe.difficulty, bike) * 0.97);
      }
    });
    expect([...seen].sort()).toEqual([...CLASS_SIZED_TYPES].sort());
  });

  test('figure-eight: the cones stand the table distance apart, the loops round them on the U-turn radius', () => {
    let seen = 0;
    each((c) => {
      const byId = conesById(c);
      const r = uTurnRadius(c.recipe.difficulty, c.recipe.bike);
      const want = c.recipe.sizes['figure-eight']?.distance ?? DIFFICULTY_TABLE[c.recipe.difficulty].eightDistance[0];
      for (const e of c.elements.filter((x) => x.type === 'figure-eight')) {
        seen++;
        const [p, q] = e.cones.map((id) => coneXY(byId.get(id)));
        const d = Math.hypot(q[0] - p[0], q[1] - p[1]);
        // On a diagonal the nearest lattice length (ADR 0005).
        expect(Math.abs(d - want), `${label(c)} ${e.id} cones ${d} m apart`).toBeLessThanOrEqual(e.axis % 2 === 0 ? 1e-9 : 0.25 + 1e-9);
        // Loop centres on the line through the cones, 2√2 r apart about their midpoint.
        const u = [(q[0] - p[0]) / d, (q[1] - p[1]) / d];
        const mid = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
        const centres = [-1, 1].map((k) => [mid[0] + k * Math.SQRT2 * r * u[0], mid[1] + k * Math.SQRT2 * r * u[1]]);
        // Away from the crossing (and without the run-in from the zone edge) the
        // line ridden keeps the U-turn radius from the nearer loop centre.
        const loops = e.path.slice(1, -1).filter((pt) => Math.hypot(pt[0] - mid[0], pt[1] - mid[1]) > Math.SQRT2 * r);
        expect(loops.length, `${label(c)} ${e.id}`).toBeGreaterThan(20);
        for (const pt of loops) {
          const x = Math.min(...centres.map((o) => Math.hypot(pt[0] - o[0], pt[1] - o[1])));
          expect(Math.abs(x - r), `${label(c)} ${e.id}`).toBeLessThan(0.05);
        }
        // Across the base the eight is the loop diameter wide.
        const across = e.path.slice(1, -1).map((pt) => -(pt[0] - mid[0]) * u[1] + (pt[1] - mid[1]) * u[0]);
        expect(Math.max(...across) - Math.min(...across), `${label(c)} ${e.id}`).toBeCloseTo(2 * r, 1);
        // The line ridden goes all the way round each cone in its own loop and keeps clear of it.
        const dense = densify(e.path, 0.05);
        for (const [k, cone] of [p, q].entries()) {
          expect(distanceToPath(dense, cone), `${label(c)} ${e.id}`).toBeGreaterThan(1);
          const own = dense.filter((pt) => (pt[0] - mid[0]) * u[0] + (pt[1] - mid[1]) * u[1] < 0 === (k === 0));
          expect(Math.abs(sweepAround(own, cone)), `${label(c)} ${e.id}`).toBeGreaterThan(270);
        }
      }
    });
    expect(seen).toBeGreaterThan(sweep(20, 0));
  });

  test('connectors do not ride unmarked loops: at most 300° of turning, 400° for the closing one', () => {
    each((c) => {
      for (const leg of c.route.legs) {
        if (leg.kind !== 'connector') continue;
        const t = turns(leg.path);
        const limit = c.route.shape !== 'open' && leg.to === 'finish' ? 400 : 300;
        expect(t.left + t.right, `${label(c)} ${leg.from}→${leg.to}`).toBeLessThanOrEqual(limit + 1);
      }
    });
  });

  // A closing connector of more than 300° of turning rides a loop.
  const closingLoops = () => generated.filter(({ recipe }) => recipe.shape !== 'open').flatMap(({ name, recipe, courses }) => courses.map((c) => {
    const t = turns(c.route.legs[c.route.legs.length - 1].path);
    return { name, recipe, c, loop: t.left + t.right > 301 };
  }));

  test('the closing connector never rides a loop on a roomy site', () => {
    for (const { name, recipe, c, loop } of closingLoops()) {
      // Roomy for a cruiser's 9 m turns; on 30×45 it can take a loop to get back to the start.
      // With only eights and slaloms allowed, a cruiser-sized eight with its run-off zone
      // can leave room for a single slalom, which then needs the loop to come back.
      const roomy = recipe.width >= 40 && recipe.length >= 60 && !recipe.types?.includes('figure-eight');
      if (roomy) expect(loop, `${name} seed ${c.seed}`).toBe(false);
    }
  });

  slowTest('the closing connector rides a loop only when no loop-free course back to the start fits: rarely', () => {
    const all = closingLoops();
    // Measured 0.04 at v12: run-off zones leave tight sites (25×30, 30×45) fewer
    // loop-free closures, so the looser limit is needed about twice as often.
    // 0.058 with the field sizes: 4 m slalom steps and the larger circle, keyhole and box eight.
    expect(all.filter((x) => x.loop).length / all.length).toBeLessThan(0.07);
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

function circleThrough(a, b, d) {
  const bx = b[0] - a[0];
  const by = b[1] - a[1];
  const dx = d[0] - a[0];
  const dy = d[1] - a[1];
  const den = 2 * (bx * dy - by * dx);
  if (Math.abs(den) < 1e-6) return null;
  const ux = (dy * (bx * bx + by * by) - by * (dx * dx + dy * dy)) / den;
  const uy = (bx * (dx * dx + dy * dy) - dx * (bx * bx + by * by)) / den;
  return { centre: [a[0] + ux, a[1] + uy], radius: Math.hypot(ux, uy) };
}

/**
 * Turns of a polyline round one centre, brute force from the published path
 * (independent of the Dubins words): a circle through a vertex and its
 * neighbours two samples away, grown to the run of vertices on it and refitted
 * through the ends and middle of that run, then grown again tighter; then how far the run sweeps round
 * the centre (degrees, + anticlockwise).
 */
function circularTurns(path, minRadius) {
  const out = [];
  let i = 2;
  while (i < path.length - 2) {
    // Just past a run, a circle centred on i would take in that run's last
    // samples and miss the next arc (two arcs either side of a short straight):
    // it is seeded from i onwards instead.
    const after = out.length && i - 2 <= out.at(-1).hi;
    let circle = after ? circleThrough(path[i], path[i + 1], path[i + 2]) : circleThrough(path[i - 2], path[i], path[i + 2]);
    if (!circle || circle.radius < minRadius * 0.97 || circle.radius > 20) {
      i++;
      continue;
    }
    let lo = i;
    let hi = i;
    // Loose while the circle is rough, then tight: the first sample of an
    // opposite arc lies within some 7 cm of the circle at the tangent point.
    for (const tol of [0.05, 0.05, 0.04]) {
      const { centre, radius } = circle;
      const on = (p) => Math.abs(Math.hypot(p[0] - centre[0], p[1] - centre[1]) - radius) < tol;
      if (tol < 0.05) {
        lo = i;
        hi = i;
      }
      while (lo > 0 && on(path[lo - 1])) lo--;
      while (hi < path.length - 1 && on(path[hi + 1])) hi++;
      const refit = tol === 0.05 && hi - lo >= 2 && circleThrough(path[lo], path[(lo + hi) >> 1], path[hi]);
      if (refit) circle = refit;
    }
    // A long run of points can still be split by rounding: join runs round the same centre.
    const prev = out.at(-1);
    const { centre, radius } = circle;
    if (prev && prev.hi >= lo - 1 && Math.hypot(prev.centre[0] - centre[0], prev.centre[1] - centre[1]) < 0.2) prev.hi = Math.max(prev.hi, hi);
    else out.push({ centre, radius, lo, hi });
    i = hi + 1;
  }
  // Two turns the same way with at most a 1 m straight between them are ridden
  // as one: centre midway between theirs.
  // A circle fitted across the junction of two arcs makes a short run that
  // only bridges its neighbours: drop it.
  const runs = out.filter((r, k) => !(out[k - 1] && out[k + 1] && out[k - 1].hi >= r.lo - 1 && out[k + 1].lo <= r.hi + 1
    && r.hi - r.lo < Math.max(out[k - 1].hi - out[k - 1].lo, out[k + 1].hi - out[k + 1].lo)));
  const joined = [];
  for (const t of runs.map((r) => ({ ...r, sweep: sweepAround(path.slice(r.lo, r.hi + 1), r.centre) }))) {
    const prev = joined.at(-1);
    // Joined by a straight (or overlapping by a point or two), the two
    // centres are offset by the straight's length.
    const gap = prev && (t.lo > prev.hi ? Math.hypot(path[t.lo][0] - path[prev.hi][0], path[t.lo][1] - path[prev.hi][1]) : 0);
    const apart = prev && Math.hypot(t.centre[0] - prev.last[0], t.centre[1] - prev.last[1]);
    // When the two fitted runs overlap, the short straight between them was
    // absorbed into both fits, so its length is unknown: the centres are then
    // at most the 1 m join limit apart.
    // A run can take in the first or last point of the straight, so the
    // straight between the runs is no longer than the gap and may be shorter.
    const offset = t.lo > prev?.hi ? apart < gap + 0.3 : apart <= 1.02;
    // Two runs one sample apart round centres a little over the join limit
    // apart can be two arcs whose shared circle swallowed the end of the
    // first: from the samples alone it cannot be told whether they are one turn.
    const near = prev && t.lo - prev.hi <= 2 && apart <= 1.3 && Math.sign(prev.sweep) === Math.sign(t.sweep);
    const sure = prev && t.lo - prev.hi <= 1 && gap <= 1.02 && offset && Math.sign(prev.sweep) === Math.sign(t.sweep);
    if (sure || near) {
      // Overlapping runs can also be one long arc split by rounding, centred
      // on either fit rather than between them: those centres count too.
      const alts = t.lo <= prev.hi ? [prev.last, t.centre] : [];
      // A straight within 2 cm of the limit cannot be told from 1 m in the
      // sampled path: the generator may have ridden it as two turns.
      const unsure = prev.unsure || !sure || (t.lo > prev.hi && gap > 0.98);
      joined[joined.length - 1] = {
        ...t, lo: prev.lo, sweep: prev.sweep + t.sweep, centre: [(prev.first[0] + t.centre[0]) / 2, (prev.first[1] + t.centre[1]) / 2], first: prev.first, last: t.centre, alts, unsure,
      };
    } else joined.push({ ...t, first: t.centre, last: t.centre });
  }
  // Fits round nearby centres (one wider circle, or two overlapping runs whose
  // shared points count twice) can overstate a turn: never count more than
  // the run turns the heading, its neighbouring segments included, plus 15°
  // for the coarse sampling at its ends.
  for (const t of joined) {
    const h = turns(path.slice(Math.max(0, t.lo - 1), Math.min(path.length, t.hi + 2)));
    t.sweep = Math.sign(t.sweep) * Math.min(Math.abs(t.sweep), h.left + h.right + 15);
  }
  return joined;
}

describe('U-turn cones on connectors', () => {
  test('a connector turn of 160° or more has a tall cone at its centre, on the inside, and a gentler turn has none', () => {
    let turns160 = 0;
    each((c, recipe) => {
      const byId = conesById(c);
      const radius = BIKE_TURN_RADIUS[recipe.bike ?? 'cruiser'];
      for (const leg of c.route.legs.filter((l) => l.kind === 'connector')) {
        const cones = (leg.cones ?? []).map((id) => byId.get(id));
        const used = new Set();
        const gentle = [];
        // The way back of a finish by the start ends in a straight run-in across
        // the line and on into the box (checked by its own test): only 3.5 m,
        // short enough for the circle fit to bend its last turn into it.
        const path = leg.to === 'finish' && c.route.shape === 'return' ? leg.path.slice(0, -2) : leg.path;
        for (const t of circularTurns(path, radius)) {
          // The cone sits on the half-metre lattice: within 0.36 m of the true centre,
          // and a circle fitted to 1 cm-rounded samples can miss that centre by
          // up to about 0.15 m more.
          const at = cones.find((k) => [t.centre, ...(t.alts ?? [])].some((q) => Math.hypot(k.hx / 2 - q[0], k.hy / 2 - q[1]) < 0.55));
          const where = `${label(c)} ${leg.from}→${leg.to} turn ${Math.round(t.sweep)}°`;
          // Arcs are sampled every 10° at most and rounded to 1 cm, so a run can
          // gain or lose one sample at its ends: within 12° of 160° it can go either way.
          if (t.unsure && !at) continue;
          if (Math.abs(t.sweep) >= 172 || (at && Math.abs(t.sweep) >= 148)) {
            turns160++;
            expect(at, where).toBeDefined();
            expect(at.height, where).toBe('tall');
            const pass = c.passes.find((p) => p.cone === at.id);
            expect(pass.connector, where).toEqual({ from: leg.from, to: leg.to });
            expect(pass.side, where).toBe(t.sweep > 0 ? 'left' : 'right');
            used.add(at.id);
          } else if (at) gentle.push({ at, where });
        }
        // A cone near the centre of a gentler turn is there for a U-turn round the same centre.
        for (const { at, where } of gentle) expect(used.has(at.id), where).toBe(true);
        // And every cone of the connector is the centre of one of its U-turns.
        expect(cones.map((k) => k.id).sort(), `${label(c)} ${leg.from}→${leg.to}`).toEqual([...used].sort());
      }
    });
    expect(turns160).toBeGreaterThan(sweep(100, 0));
  });

  test('a U-turn cone keeps 1.5 m from every element footprint and every other route leg', () => {
    expect(U_TURN_CONE_CLEARANCE).toBe(1.5);
    each((c) => {
      const byId = conesById(c);
      const elements = new Map(c.elements.map((e) => [e.id, e]));
      const fps = c.elements.map((e) => ({ e, fp: footprintOf(c, e) }));
      for (const leg of c.route.legs.filter((l) => l.cones)) {
        for (const id of leg.cones) {
          const p = coneXY(byId.get(id));
          for (const { e, fp } of fps) {
            expect(distanceToFootprint(fp, p), `${label(c)} ${id} near ${e.id}`).toBeGreaterThan(U_TURN_CONE_CLEARANCE + ZONE_PAD - 0.03);
          }
          for (const other of c.route.legs) {
            const path = other.kind === 'connector' ? other.path : elements.get(other.element).path;
            if (other === leg) {
              expect(distanceToPath(path, p), `${label(c)} ${id} own connector`).toBeGreaterThan(3);
            } else {
              expect(distanceToPath(path, p), `${label(c)} ${id} near ${other.from ?? other.element}→${other.to ?? ''}`).toBeGreaterThan(1.45);
            }
          }
        }
      }
    });
  });
});

/**
 * The line ridden past an element: its own, and for a point waypoint (a passed
 * cone, ADR 0027), which has none, the connectors in and out joined at its point.
 */
function riddenPast(c, id) {
  const e = c.elements.find((k) => k.id === id);
  if (e.path.some(([x, y]) => x !== e.path[0][0] || y !== e.path[0][1])) return e.path;
  const legs = c.route.legs.filter((l) => l.kind === 'connector');
  return [...legs.find((l) => l.to === id).path, ...legs.find((l) => l.from === id).path.slice(1)];
}

describe('cone sides, from the actual geometry of the route', () => {
  test('every tall-cone pass keeps the cone on its required side; blue left, red right', () => {
    each((c) => {
      const byId = conesById(c);
      const elements = new Map(c.elements.map((e) => [e.id, e]));
      const connectorPath = (k) => c.route.legs.find((l) => l.kind === 'connector' && l.from === k.from && l.to === k.to).path;
      for (const pass of c.passes.filter((p) => p.kind === 'cone')) {
        const path = pass.connector ? connectorPath(pass.connector) : riddenPast(c, pass.element);
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
        } else if (p.kind === 'cone') note(p.cone, p.side);
      }
      for (const cone of c.cones) {
        if (cone.height === 'tall') expect(sides.get(cone.id)?.size, `${label(c)} ${cone.id}`).toBe(1);
        else expect(sides.has(cone.id)).toBe(false);
      }
    });
  });
});

describe('element shapes', () => {
  test('pivot turns are 270°, 360° or 720° around their cone, as the pass says', () => {
    let seen = 0;
    each((c) => {
      const byId = conesById(c);
      for (const e of c.elements.filter((x) => x.type === 'pivot-turn')) {
        seen++;
        const pass = c.passes.find((p) => p.element === e.id);
        expect([270, 360, 720]).toContain(pass.angle);
        const cone = coneXY(byId.get(e.anchor));
        const r = Math.min(...e.path.map((p) => Math.hypot(p[0] - cone[0], p[1] - cone[1])));
        const arc = e.path.filter((p) => Math.hypot(p[0] - cone[0], p[1] - cone[1]) <= r * 1.02);
        expect(Math.abs(Math.abs(sweepAround(arc, cone)) - pass.angle), `${label(c)} ${e.id}`).toBeLessThan(11);
      }
    });
    expect(seen).toBeGreaterThan(sweep(20, 0));
  });

  test('a lane change is ridden straight through both gates and changes lean once between them', () => {
    let seen = 0;
    each((c) => {
      const byId = conesById(c);
      for (const e of c.elements.filter((x) => x.type === 'lane-change')) {
        seen++;
        const [a, b, d, f] = e.cones.map((id) => coneXY(byId.get(id)));
        const g1 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
        const g2 = [(d[0] + f[0]) / 2, (d[1] + f[1]) / 2];
        const u = [Math.cos((e.entry.dir * Math.PI) / 4), Math.sin((e.entry.dir * Math.PI) / 4)];
        const local = e.path.map((p) => [(p[0] - g1[0]) * u[0] + (p[1] - g1[1]) * u[1], -(p[0] - g1[0]) * u[1] + (p[1] - g1[1]) * u[0]]);
        const gap = (g2[0] - g1[0]) * u[0] + (g2[1] - g1[1]) * u[1];
        const slopes = [];
        for (let i = 1; i < local.length; i++) {
          const [x0, y0] = local[i - 1];
          const [x1, y1] = local[i];
          slopes.push({ from: x0, to: x1, slope: (y1 - y0) / (x1 - x0) });
        }
        // Through each gate the trajectory runs along the axis, within 3°.
        for (const at of [0, gap]) {
          const s = slopes.find((x) => x.from <= at + 1e-6 && x.to > at + 1e-6) ?? slopes.find((x) => x.from < at && x.to >= at);
          expect(Math.abs(s.slope), `${label(c)} ${e.id} at ${at.toFixed(1)} m`).toBeLessThan(Math.tan((3 * Math.PI) / 180));
        }
        // Between them it turns towards the shift, then back: the slope grows, then falls.
        const between = slopes.filter((x) => x.from >= -1e-6 && x.to <= gap + 1e-6).map((x) => Math.abs(x.slope));
        const peak = between.indexOf(Math.max(...between));
        expect(peak > 0 && peak < between.length - 1, `${label(c)} ${e.id}`).toBe(true);
        between.forEach((v, i) => {
          if (i > 0) expect(i <= peak ? v >= between[i - 1] - 1e-9 : v <= between[i - 1] + 1e-9, `${label(c)} ${e.id}`).toBe(true);
        });
      }
    });
    expect(seen).toBeGreaterThan(sweep(20, 0));
  });

  test('pivot angles follow the difficulty: easy 270°, hard 360° or two laps', () => {
    for (const { recipe, courses } of generated) {
      // The small U-turn's pass says its 180° too (ADR 0024): only the pivot turn's angle follows the difficulty.
      const angles = courses.flatMap((c) => {
        const pivots = new Set(c.elements.filter((e) => e.type === 'pivot-turn').map((e) => e.id));
        return c.passes.filter((p) => pivots.has(p.element)).map((p) => p.angle);
      });
      if (recipe.difficulty === 'easy') expect(angles.every((a) => a === 270)).toBe(true);
      if (recipe.difficulty === 'hard') expect(angles.every((a) => a === 360 || a === 720)).toBe(true);
    }
  });

  test('the ridden line of an element keeps at least 0.5 m from every one of its cones', () => {
    each((c) => {
      const byId = conesById(c);
      for (const e of c.elements) {
        for (const id of e.cones) {
          expect(distanceToPath(e.path, coneXY(byId.get(id))), `${label(c)} ${e.id} ${e.type} ${id}`).toBeGreaterThan(0.5);
        }
      }
    });
  });

  test('a mirror is ridden over its line: the wheel crosses the line between its two low cones', () => {
    let seen = 0;
    each((c) => {
      const byId = conesById(c);
      const elements = new Map(c.elements.map((e) => [e.id, e]));
      for (const pass of c.passes.filter((p) => p.kind === 'line')) {
        seen++;
        const e = elements.get(pass.element);
        expect(e.type).toBe('mirror');
        const a = coneXY(byId.get(pass.from));
        const b = coneXY(byId.get(pass.to));
        expect(byId.get(pass.from).height).toBe('low');
        expect(e.lines).toEqual([{ kind: 'chalk', cones: [pass.from, pass.to] }]);
        expect(crossingsOf(e.path, a, b).length, `${label(c)} ${e.id}`).toBeGreaterThan(0);
      }
    });
    expect(seen).toBeGreaterThan(sweep(10, 0));
  });

  test('wall and chalk lines join cones of their own element', () => {
    each((c) => {
      for (const e of c.elements) {
        for (const line of e.lines ?? []) {
          expect(['wall', 'chalk']).toContain(line.kind);
          expect(line.cones.length).toBeGreaterThanOrEqual(2);
          for (const id of line.cones) expect(e.cones).toContain(id);
        }
      }
    });
  });

  test('a gate turn goes through its gate and comes back through the same gate the other way', () => {
    let seen = 0;
    each((c) => {
      const byId = conesById(c);
      for (const e of c.elements.filter((x) => x.type === 'gate-turn')) {
        seen++;
        const [a, b] = e.cones.map((id) => coneXY(byId.get(id)));
        const crossings = crossingsOf(e.path, a, b);
        expect(crossings.length, `${label(c)} ${e.id}`).toBe(2);
        expect(Math.sign(crossings[0]) === -Math.sign(crossings[1])).toBe(true);
      }
    });
    expect(seen).toBeGreaterThan(sweep(10, 0));
  });

  test('slalom steps and gate widths stay in the difficulty ranges, or on the size the recipe fixed', () => {
    const ranges = {
      easy: { slalom: [4.5, 5], gate: [2.25, 2.75] },
      medium: { slalom: [3.75, 4.25], gate: [1.75, 2.25] },
      hard: { slalom: [3.75, 4.25], gate: [1.25, 1.75] },
    };
    each((c, recipe) => {
      const byId = conesById(c);
      const fixed = (type, key) => recipe.sizes?.[type]?.[key];
      const step = fixed('straight-slalom', 'step');
      const gate = fixed('gate', 'width');
      // A fixed size is exact on a side axis and the nearest lattice length, within 0.25 m, on a diagonal (ADR 0005).
      const r = {
        slalom: step ? [step - 0.25, step + 0.25] : ranges[recipe.difficulty].slalom,
        gate: gate ? [gate - 0.25, gate + 0.25] : ranges[recipe.difficulty].gate,
      };
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

  test('a closed course starts and finishes on one line, a finish by the start in one box, an open course on two lines', () => {
    each((c, recipe) => {
      const { start, finish } = c.route;
      expect(c.route.shape).toBe(recipe.shape);
      if (recipe.shape === 'closed') expect(finish).toEqual(start);
      else if (recipe.shape === 'return') expect(finish.cones).toEqual(start.cones);
      else expect(finish.cones).not.toEqual(start.cones);
      for (const t of [start, finish]) {
        expect(t.cones).toHaveLength(recipe.shape === 'return' ? 4 : 2);
        for (const id of t.cones) expect(conesById(c).get(id).height).toBe('low');
      }
    });
  });

  test('a course finishing by the start: one square box, left across its start line and entered again across the same line, the other way', () => {
    const angleOf = (dir) => (dir * Math.PI) / 4;
    const off = (a, b) => Math.abs(((a - b + 3 * Math.PI) % (2 * Math.PI)) - Math.PI);
    // Proper crossing of segments ab and cd.
    const cross = (a, b, c, d) => {
      const o = (p, q, r) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
      return o(a, b, c) !== o(a, b, d) && o(c, d, a) !== o(c, d, b) && o(a, b, c) !== 0 && o(a, b, d) !== 0;
    };
    let n = 0;
    each((c, recipe) => {
      if (recipe.shape !== 'return') return;
      n++;
      const byId = conesById(c);
      const { start, finish, legs } = c.route;
      const box = start.cones.map((id) => coneXY(byId.get(id)));
      // A square: the start line in front, its two cones behind, as deep as the line is wide.
      const side = (i) => Math.hypot(box[(i + 1) % 4][0] - box[i][0], box[(i + 1) % 4][1] - box[i][1]);
      for (const i of [1, 2, 3]) expect(side(i), label(c)).toBeCloseTo(side(0), 6);
      expect(Math.hypot((box[0][0] + box[1][0]) / 2 - start.x, (box[0][1] + box[1][1]) / 2 - start.y), label(c)).toBeLessThan(0.02);
      expect(finish.cones).toEqual(start.cones);
      // Back the other way: square on or at 45°.
      expect([3, 4, 5], label(c)).toContain((finish.dir - start.dir + 8) % 8);
      // Lined up, then across the middle of the start line and on into the box, where the rider stops.
      const back = legs.at(-1);
      expect(back.to).toBe('finish');
      const [p, q, r] = back.path.slice(-3);
      expect(Math.hypot(q[0] - start.x, q[1] - start.y), label(c)).toBeLessThan(0.02);
      for (const [a, b] of [[p, q], [q, r]]) expect(off(Math.atan2(b[1] - a[1], b[0] - a[0]), angleOf(finish.dir)), label(c)).toBeLessThan(1e-6);
      expect(insidePolygon(box, [finish.x, finish.y], 0.2), label(c)).toBe(true);
      // The way back gets into the box only across the start line: never across its back or sides.
      for (let k = 1; k < back.path.length; k++) {
        for (const s of [1, 2, 3]) expect(cross(back.path[k - 1], back.path[k], box[s], box[(s + 1) % 4]), label(c)).toBe(false);
      }
      expect(polylineEnters(back.path.slice(0, -2), box), label(c)).toBe(false);
    });
    expect(n).toBeGreaterThan(0);
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

  test(`at most one big element (core of ${BIG_ELEMENT_AREA} m² or more) per course, whatever was allowed`, () => {
    let seen = 0;
    each((c) => {
      // Zone corners are rounded to 1 cm, so the area is only good to about 0.2 m².
      const big = c.elements.filter((e) => coreArea(e) >= BIG_ELEMENT_AREA + 0.2).length;
      if (big) seen++;
      expect(big, label(c)).toBeLessThanOrEqual(1);
    });
    expect(seen).toBeGreaterThan(sweep(100, 0));
  });

  test('with only always-big types usable, the course has one element and says the rule is why', () => {
    for (const { name, courses } of generated) {
      const onlyBig = name.startsWith('only big types');
      for (const c of courses) {
        if (onlyBig) {
          expect(c.placed, `${name} ${label(c)}`).toBe(1);
          expect(c.limitedBy).toBe('big-elements');
          expect(coreArea(c.elements[0])).toBeGreaterThan(BIG_ELEMENT_AREA);
        } else {
          expect(c.limitedBy, `${name} ${label(c)}`).toBeUndefined();
        }
      }
    }
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
const TRAIN_CLEARANCE = 1.5; // metres; closer than this the riders can collide
const TRAIN_NEAR = 4.5; // metres of route; closer than this is the same stretch, not a crossing

describe('паровозик', () => {
  const trains = generated.filter(({ recipe }) => recipe.train);

  test('has no looped elements: no pivot turn, figure eight, box, small or fast circle, gate turn, box eight or keyhole', () => {
    for (const { courses } of trains) {
      for (const c of courses) {
        for (const e of c.elements) expect(LOOPED_TYPES).not.toContain(e.type);
      }
    }
  });

  test('rides a snail and a mirror', () => {
    const elements = trains.flatMap(({ courses }) => courses.flatMap((c) => c.elements));
    expect(elements.filter((e) => e.type === 'snail').length).toBeGreaterThan(sweep(5, 0));
    expect(elements.filter((e) => e.type === 'mirror').length).toBeGreaterThan(sweep(5, 0));
  });

  test(`the route never crosses itself or comes back within ${TRAIN_CLEARANCE} m of itself, except inside a snail or a mirror`, () => {
    for (const { name, courses } of trains) {
      for (const c of courses) {
        // Points of an exempt element carry its id: its own passes may meet.
        const byId = new Map(c.elements.map((e) => [e.id, e]));
        const pts = [];
        const owner = [];
        // A finish by the start comes back across the start line: by then the
        // whole column has ridden the start and the first element, so the way
        // back is not checked against them.
        const stretch = [];
        const { legs } = c.route;
        legs.forEach((leg, k) => {
          const e = leg.kind === 'connector' ? null : byId.get(leg.element);
          const dense = densify(e ? e.path : leg.path, 0.25);
          pts.push(...dense);
          owner.push(...dense.map(() => (e && TRAIN_EXEMPT_TYPES.includes(e.type) ? e.id : null)));
          const part = c.route.shape !== 'return' ? null : k <= 1 ? 'head' : k === legs.length - 1 ? 'back' : null;
          stretch.push(...dense.map(() => part));
        });
        const at = [0];
        for (let i = 1; i < pts.length; i++) at.push(at[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
        const total = at[at.length - 1];
        for (let i = 0; i < pts.length; i++) {
          for (let j = i + 1; j < pts.length; j++) {
            const along = at[j] - at[i];
            // A closed course is ridden round and round: count the way through the finish too.
            const gap = c.route.shape === 'closed' ? Math.min(along, total - along) : along;
            if (gap < TRAIN_NEAR || (owner[i] !== null && owner[i] === owner[j])) continue;
            if (stretch[i] === 'head' && stretch[j] === 'back') continue;
            const d = Math.hypot(pts[j][0] - pts[i][0], pts[j][1] - pts[i][1]);
            if (d < TRAIN_CLEARANCE) throw new Error(`${name} seed ${c.seed}: ${d.toFixed(2)} m apart after ${gap.toFixed(1)} m of route at (${pts[i].map((v) => v.toFixed(1))})`);
          }
        }
      }
    }
    }, timeout(30_000));

  slowTest('still lays out most of what was asked on a roomy site', () => {
    const [{ courses }] = trains;
    const placed = courses.reduce((n, c) => n + c.placed, 0) / courses.length;
    // About 5 of 8: a cruiser's connectors turn on 9 m, and in a column they
    // must keep clear of the whole route; a snail takes some 300 m² of the 2400.
    // 4.475 with the field sizes, where slalom steps grew to 4 m.
    expect(placed).toBeGreaterThan(4.4);
  });
});
