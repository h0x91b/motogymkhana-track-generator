// The reserved zones the plan draws are read back from the course, not invented.

import { describe, expect, test } from 'bun:test';
import { generateCourse, U_TURN_CONE_CLEARANCE } from '../src/generator/index.js';
import { reservedZones } from '../src/render/reserved.js';

const base = { width: '30', length: '45', elements: '8', difficulty: 'hard', bike: 'cruiser', closed: true, train: false };
const course = (recipe, seed) => {
  const r = generateCourse(recipe, seed);
  expect(r.ok).toBe(true);
  return r.course;
};

describe('reservedZones', () => {
  test('one zone per element, run-off zones of turning elements, one terminal on a closed course', () => {
    const c = course(base, 1);
    const zones = reservedZones(c);
    const of = (kind) => zones.filter((z) => z.kind === kind);
    expect(of('zone').map((z) => z.poly)).toEqual(c.elements.map((e) => e.zone));
    expect(of('runOff').map((z) => z.poly)).toEqual(c.elements.filter((e) => e.runOff).map((e) => e.runOff));
    expect(of('terminal').map((z) => z.poly)).toEqual([c.route.start.zone]);
  });

  test('an open course has a start and a finish zone', () => {
    const c = course({ ...base, closed: false }, 1);
    expect(reservedZones(c).filter((z) => z.kind === 'terminal').map((z) => z.poly)).toEqual([c.route.start.zone, c.route.finish.zone]);
  });

  test('every connector U-turn cone has its square keep-out, in the cone colour', () => {
    const c = course(base, 2);
    const ids = c.route.legs.flatMap((l) => l.cones ?? []);
    expect(ids.length).toBeGreaterThan(0);
    const squares = reservedZones(c).filter((z) => z.kind === 'turnCone');
    expect(squares.map((z) => z.cone)).toEqual(ids);
    for (const z of squares) {
      const cone = c.cones.find((k) => k.id === z.cone);
      const pass = c.passes.find((p) => p.cone === z.cone);
      const xs = z.poly.map((p) => p[0]);
      const ys = z.poly.map((p) => p[1]);
      expect([Math.min(...xs), Math.max(...xs)]).toEqual([cone.hx / 2 - U_TURN_CONE_CLEARANCE, cone.hx / 2 + U_TURN_CONE_CLEARANCE]);
      expect([Math.min(...ys), Math.max(...ys)]).toEqual([cone.hy / 2 - U_TURN_CONE_CLEARANCE, cone.hy / 2 + U_TURN_CONE_CLEARANCE]);
      expect(z.color).toBe(pass.side === 'left' ? 'blue' : 'red');
    }
  });
});
