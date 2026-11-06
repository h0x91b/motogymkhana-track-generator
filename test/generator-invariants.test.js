// Hard rules of a course, checked on hundreds of seeds through generateCourse.

import { describe, expect, test } from 'bun:test';
import {
  BIG_ELEMENT_AREA, BIKE_TURN_RADIUS, generateCourse, LOOPED_TYPES, TRAIN_EXEMPT_TYPES, TYPE_LEVELS, uTurnRadius,
} from '../src/generator/index.js';

// Types whose U-turns are sized by the bike class (the rest keep difficulty sizes).
const CLASS_SIZED_TYPES = ['u-turn', 'box', 'pivot-turn', 'mirror', 'gate-turn', 'figure-eight'];
import {
  coneXY, conesById, densify, distanceToPath, fullRoute, insidePolygon, polylineEnters, sideOf, sweepAround, turns,
} from './helpers/course-geometry.js';

const RECIPES = [
  { name: '40×60 medium closed', recipe: { width: 40, length: 60, elements: 8, difficulty: 'medium', closed: true }, seeds: 150 },
  { name: '40×60 easy open', recipe: { width: 40, length: 60, elements: 6, difficulty: 'easy', closed: false }, seeds: 80 },
  { name: '30×45 hard closed', recipe: { width: 30, length: 45, elements: 10, difficulty: 'hard', closed: true }, seeds: 80 },
  { name: '40×60 hard closed sport', recipe: { width: 40, length: 60, elements: 8, difficulty: 'hard', bike: 'sport', closed: true }, seeds: 60 },
  { name: '60×80 hard open', recipe: { width: 60, length: 80, elements: 15, difficulty: 'hard', closed: false }, seeds: 80 },
  {
    name: 'eights and slaloms only',
    recipe: { width: 40, length: 60, elements: 8, difficulty: 'medium', closed: true, types: ['figure-eight', 'straight-slalom'] },
    seeds: 60,
  },
  { name: '25×30 easy closed (small)', recipe: { width: 25, length: 30, elements: 5, difficulty: 'easy', closed: true }, seeds: 60 },
  { name: '40×60 medium closed train', recipe: { width: 40, length: 60, elements: 8, difficulty: 'medium', closed: true, train: true }, seeds: 80 },
  { name: '60×80 hard open train', recipe: { width: 60, length: 80, elements: 12, difficulty: 'hard', closed: false, train: true }, seeds: 50 },
  {
    name: 'only big types',
    recipe: { width: 40, length: 60, elements: 6, difficulty: 'medium', closed: true, types: ['snail', 'crescent'] },
    seeds: 30,
  },
  {
    name: 'only big types, train',
    recipe: { width: 40, length: 60, elements: 4, difficulty: 'hard', closed: false, train: true, types: ['snail', 'crescent', 'figure-eight'] },
    seeds: 30,
  },
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

  test('figure-eight loops are circles round their cones', () => {
    each((c) => {
      const byId = conesById(c);
      for (const e of c.elements.filter((x) => x.type === 'figure-eight')) {
        const [p, q] = e.cones.map((id) => coneXY(byId.get(id)));
        const d = Math.hypot(q[0] - p[0], q[1] - p[1]);
        // Away from the crossing (and without the run-in from the zone edge) the
        // line ridden keeps one distance from the nearer cone.
        const mid = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
        const radii = e.path.slice(1, -1)
          .filter((pt) => Math.hypot(pt[0] - mid[0], pt[1] - mid[1]) > d / 2)
          .map((pt) => Math.min(Math.hypot(pt[0] - p[0], pt[1] - p[1]), Math.hypot(pt[0] - q[0], pt[1] - q[1])));
        expect(radii.length, `${label(c)} ${e.id}`).toBeGreaterThan(20);
        const r = d / (2 * Math.SQRT2);
        for (const x of radii) expect(Math.abs(x - r), `${label(c)} ${e.id}`).toBeLessThan(0.05);
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
      // Roomy for a cruiser's 9 m turns; on 30×45 it can take a loop to get back to the start.
      const roomy = recipe.width >= 40 && recipe.length >= 60;
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
    let circle = circleThrough(path[i - 2], path[i], path[i + 2]);
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
    if (prev && t.lo - prev.hi <= 1 && gap <= 1.02 && Math.abs(apart - gap) < 0.3 && Math.sign(prev.sweep) === Math.sign(t.sweep)) {
      joined[joined.length - 1] = {
        ...t, lo: prev.lo, sweep: prev.sweep + t.sweep, centre: [(prev.first[0] + t.centre[0]) / 2, (prev.first[1] + t.centre[1]) / 2], first: prev.first, last: t.centre,
      };
    } else joined.push({ ...t, first: t.centre, last: t.centre });
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
        for (const t of circularTurns(leg.path, radius)) {
          // The cone sits on the half-metre lattice: within 0.36 m of the true centre.
          const at = cones.find((k) => Math.hypot(k.hx / 2 - t.centre[0], k.hy / 2 - t.centre[1]) < 0.45);
          const where = `${label(c)} ${leg.from}→${leg.to} turn ${Math.round(t.sweep)}°`;
          // Arcs are sampled every 10° at most and rounded to 1 cm, so a run can
          // gain or lose one sample at its ends: within 12° of 160° it can go either way.
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
    expect(turns160).toBeGreaterThan(100);
  });

  test('a U-turn cone keeps 1.5 m from every element zone and every other route leg', () => {
    each((c) => {
      const byId = conesById(c);
      const elements = new Map(c.elements.map((e) => [e.id, e]));
      for (const leg of c.route.legs.filter((l) => l.cones)) {
        for (const id of leg.cones) {
          const p = coneXY(byId.get(id));
          for (const e of c.elements) {
            const d = insidePolygon(e.zone, p) ? 0 : distanceToPath([...e.zone, e.zone[0]], p);
            expect(d, `${label(c)} ${id} near ${e.id}`).toBeGreaterThan(1.45);
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

describe('cone sides, from the actual geometry of the route', () => {
  test('every tall-cone pass keeps the cone on its required side; blue left, red right', () => {
    each((c) => {
      const byId = conesById(c);
      const elements = new Map(c.elements.map((e) => [e.id, e]));
      const connectorPath = (k) => c.route.legs.find((l) => l.kind === 'connector' && l.from === k.from && l.to === k.to).path;
      for (const pass of c.passes.filter((p) => p.kind === 'cone')) {
        const path = pass.connector ? connectorPath(pass.connector) : elements.get(pass.element).path;
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
    expect(seen).toBeGreaterThan(20);
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
    expect(seen).toBeGreaterThan(20);
  });

  test('pivot angles follow the difficulty: easy 270°, hard 360° or two laps', () => {
    for (const { recipe, courses } of generated) {
      const angles = courses.flatMap((c) => c.passes.filter((p) => p.angle).map((p) => p.angle));
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
    expect(seen).toBeGreaterThan(10);
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
    expect(seen).toBeGreaterThan(10);
  });

  test('a snail, licence-test eight and keyhole appear only from medium difficulty', () => {
    each((c, recipe) => {
      for (const e of c.elements) {
        if (TYPE_LEVELS[e.type]) expect(TYPE_LEVELS[e.type], `${label(c)} ${e.type}`).toContain(recipe.difficulty);
      }
    });
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

  test(`at most one big element (core of ${BIG_ELEMENT_AREA} m² or more) per course, whatever was allowed`, () => {
    let seen = 0;
    each((c) => {
      // Zone corners are rounded to 1 cm, so the area is only good to about 0.2 m².
      const big = c.elements.filter((e) => coreArea(e) >= BIG_ELEMENT_AREA + 0.2).length;
      if (big) seen++;
      expect(big, label(c)).toBeLessThanOrEqual(1);
    });
    expect(seen).toBeGreaterThan(100);
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

  test('has no looped elements: no pivot turn, figure eight, box, circle, gate turn, box eight or keyhole', () => {
    for (const { courses } of trains) {
      for (const c of courses) {
        for (const e of c.elements) expect(LOOPED_TYPES).not.toContain(e.type);
      }
    }
  });

  test('rides a snail and a mirror', () => {
    const elements = trains.flatMap(({ courses }) => courses.flatMap((c) => c.elements));
    expect(elements.filter((e) => e.type === 'snail').length).toBeGreaterThan(5);
    expect(elements.filter((e) => e.type === 'mirror').length).toBeGreaterThan(5);
  });

  test(`the route never crosses itself or comes back within ${TRAIN_CLEARANCE} m of itself, except inside a snail or a mirror`, () => {
    for (const { name, courses } of trains) {
      for (const c of courses) {
        // Points of an exempt element carry its id: its own passes may meet.
        const byId = new Map(c.elements.map((e) => [e.id, e]));
        const pts = [];
        const owner = [];
        for (const leg of c.route.legs) {
          const e = leg.kind === 'connector' ? null : byId.get(leg.element);
          const dense = densify(e ? e.path : leg.path, 0.25);
          pts.push(...dense);
          owner.push(...dense.map(() => (e && TRAIN_EXEMPT_TYPES.includes(e.type) ? e.id : null)));
        }
        const at = [0];
        for (let i = 1; i < pts.length; i++) at.push(at[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
        const total = at[at.length - 1];
        for (let i = 0; i < pts.length; i++) {
          for (let j = i + 1; j < pts.length; j++) {
            const along = at[j] - at[i];
            // A closed course is ridden round and round: count the way through the finish too.
            const gap = c.route.closed ? Math.min(along, total - along) : along;
            if (gap < TRAIN_NEAR || (owner[i] !== null && owner[i] === owner[j])) continue;
            const d = Math.hypot(pts[j][0] - pts[i][0], pts[j][1] - pts[i][1]);
            if (d < TRAIN_CLEARANCE) throw new Error(`${name} seed ${c.seed}: ${d.toFixed(2)} m apart after ${gap.toFixed(1)} m of route at (${pts[i].map((v) => v.toFixed(1))})`);
          }
        }
      }
    }
    }, 30_000);

  test('still lays out most of what was asked on a roomy site', () => {
    const [{ courses }] = trains;
    const placed = courses.reduce((n, c) => n + c.placed, 0) / courses.length;
    // About 5 of 8: a cruiser's connectors turn on 9 m, and in a column they
    // must keep clear of the whole route; a snail takes some 300 m² of the 2400.
    expect(placed).toBeGreaterThan(4.5);
  });
});
