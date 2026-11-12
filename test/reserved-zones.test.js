// The reserved zones the plan draws are read back from the course, not invented.

import { describe, expect, test } from 'bun:test';
import { generateCourse, U_TURN_CONE_CLEARANCE, ZONE_PAD } from '../src/generator/index.js';
import { reservedZones } from '../src/render/reserved.js';
import { distanceToFootprint, footprintOf } from './helpers/course-geometry.js';

/** Point inside a simple polygon (even–odd ray cast). */
const inside = (poly, [x, y]) => {
  let odd = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) odd = !odd;
  }
  return odd;
};

const base = { width: '30', length: '45', elements: '8', difficulty: 'hard', bike: 'cruiser', closed: true, train: false };
const course = (recipe, seed) => {
  const r = generateCourse(recipe, seed);
  expect(r.ok).toBe(true);
  return r.course;
};

describe('reservedZones', () => {
  test('the outline of every element footprint, run-off zones of turning elements, one terminal on a closed course', () => {
    const c = course(base, 1);
    const zones = reservedZones(c);
    const of = (kind) => zones.filter((z) => z.kind === kind);
    const byId = new Map(c.cones.map((k) => [k.id, k]));
    for (const e of c.elements) {
      const loops = of('zone').filter((z) => z.element === e.id).map((z) => z.poly);
      expect(loops.length, e.id).toBeGreaterThan(0);
      // The outline runs ZONE_PAD from the cones and lines (traced on a 0.25 m grid, thinned to 3 cm)…
      const fp = footprintOf(c, e);
      for (const p of loops.flat()) {
        const d = distanceToFootprint(fp, p);
        expect(d, `${e.id} outline at ${p}`).toBeGreaterThan(ZONE_PAD - 0.06);
        expect(d, `${e.id} outline at ${p}`).toBeLessThan(ZONE_PAD + 0.06);
      }
      // …and every cone of the element is inside it.
      for (const id of e.cones) {
        const p = [byId.get(id).hx / 2, byId.get(id).hy / 2];
        expect(loops.filter((l) => inside(l, p)).length % 2, `${e.id} ${id}`).toBe(1);
      }
    }
    expect(of('runOff').map((z) => z.poly)).toEqual(c.elements.filter((e) => e.runOff).map((e) => e.runOff));
    expect(of('terminal').map((z) => z.poly)).toEqual([c.route.start.zone]);
  });

  test('an open course has a start and a finish zone', () => {
    const c = course({ ...base, closed: false }, 1);
    expect(reservedZones(c).filter((z) => z.kind === 'terminal').map((z) => z.poly)).toEqual([c.route.start.zone, c.route.finish.zone]);
  });

  test('every connector U-turn cone has its round keep-out, in the cone colour', () => {
    const c = course(base, 2);
    const ids = c.route.legs.flatMap((l) => l.cones ?? []);
    expect(ids.length).toBeGreaterThan(0);
    const squares = reservedZones(c).filter((z) => z.kind === 'turnCone');
    expect(squares.map((z) => z.cone)).toEqual(ids);
    for (const z of squares) {
      const cone = c.cones.find((k) => k.id === z.cone);
      const pass = c.passes.find((p) => p.cone === z.cone);
      for (const [x, y] of z.poly) expect(Math.hypot(x - cone.hx / 2, y - cone.hy / 2)).toBeCloseTo(U_TURN_CONE_CLEARANCE, 9);
      expect(z.color).toBe(pass.side === 'left' ? 'blue' : 'red');
    }
  });
});
