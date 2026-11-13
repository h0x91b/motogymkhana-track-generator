// Turns round a lone cone (ADR 0031): «Конус слева/справа» turn round their
// cone by as much as the route needs (0–225°), «Малый разворот» by 135–225°,
// on a circle that holds the cone, chosen by `routeLayout` when the preferred
// turn (straight past, 180° centred on the cone) breaks a rule.

import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'bun:test';
import { canonicalJSON, generateCourse, SMALL_TURN_RADIUS_MIN } from '../src/generator/index.js';
import { CONE_TURN_STEP, CONE_TURNS, coneTurnRadius, elementParams, instantiate, passOffset } from '../src/generator/catalog.js';
import { coneTurns, freeHeadings, placeTemplate, pose } from '../src/generator/generate.js';
import { layoutOf, routeLayout } from '../src/generator/layout.js';
import { buildSetupSheet } from '../src/sheet/setup-sheet.js';
import { courseDocument, courseFileText, readCourseFile } from '../src/file/course-file.js';
import { sweep, timeout } from './helpers/slow.js';

const FIXTURE = readFileSync(new URL('./fixtures/edited-40x52.json', import.meta.url), 'utf8');
const userLayout = () => readCourseFile(FIXTURE).layout;
const placed = (type, sizes, x, y, mirrored = false) => placeTemplate(instantiate(type, elementParams(type, sizes, false, 'cruiser'), false, mirrored, { pad: 0.25, runOff: 0 }), 0, x, y);
// Problems on the connectors into and out of element 8 (7 → 8 is connector 7) or about elements 8 and 9.
const near8 = (problems) => problems.filter((p) => [7, 8].includes(p.connector) || p.elements.some((e) => ['e8', 'e9'].includes(e)));
const coneOf = (course, e) => {
  const c = course.cones.find((q) => q.id === e.cones[0]);
  return [c.hx / 2, c.hy / 2];
};

describe('the user\'s 40 × 52 course', () => {
  test('as saved, «Конус справа» at (33, 5) turns round its cone into the slalom: connectors 7 → 8 and 8 → 9 have no problem', () => {
    // Straight past the cone the way on to the slalom 2,35 m further, entered westwards, loops off the lot (ADR 0031).
    const { course, problems } = routeLayout(userLayout());
    const e8 = course.elements[7];
    expect(e8.type).toBe('pass-right');
    expect(coneOf(course, e8)).toEqual([33, 5]);
    expect(e8.params.turn).toBeGreaterThan(180);
    expect(e8.params.turn).toBeLessThanOrEqual(CONE_TURNS['pass-right'].max);
    expect(near8(problems)).toEqual([]);
    // Out of the turn straight into the slalom: no connector to speak of.
    const out = course.route.legs.find((l) => l.kind === 'connector' && l.from === 'e8');
    expect(out.path).toHaveLength(2);
    // The slalom and every other element stand where the user put them.
    const where = (els) => els.map(({ type, sizes, mirrored, x, y }) => ({ type, sizes, mirrored, x, y }));
    expect(where(layoutOf(course).elements)).toEqual(where(userLayout().elements));
  });

  test('a 3 m small U-turn at the same cone on the same side clears them too; on the cruiser\'s 4,5 m it cannot', () => {
    const at = (radius) => {
      const layout = userLayout();
      layout.elements[7] = { type: 'small-turn', sizes: { radius }, axis: 0, mirrored: true, x: 33, y: 5 };
      return routeLayout(layout);
    };
    const tight = at(SMALL_TURN_RADIUS_MIN);
    expect(near8(tight.problems)).toEqual([]);
    expect(tight.course.elements[7].params.turn).toBeGreaterThanOrEqual(CONE_TURNS['small-turn'].min);
    // On 4,5 m the circle that holds the cone and leads into the slalom reaches up into the crescent (element 6).
    expect(near8(at(4.5).problems).length).toBeGreaterThan(0);
  });

  test('the card says how far round the cone; the file opens to the same course', () => {
    const { course } = routeLayout(userLayout());
    const card = buildSetupSheet(course).cards[7];
    expect(card.notes[0]).toMatch(/^Один высокий конус, красный: объезд с разворотом ~\d+° направо, конус справа$/);
    // The file keeps the elements and the start put by hand, not the turn: the route finds it again.
    const read = readCourseFile(courseFileText(courseDocument({ ...layoutOf(course), start: userLayout().start }, {})));
    expect(read.ok).toBe(true);
    expect(canonicalJSON(routeLayout(read.layout).course)).toBe(canonicalJSON(course));
  });
});

describe('the turns tried', () => {
  // A cone 10 m from the previous exit, the next entry 8 m on, at an angle.
  const from = pose([10, 20], 0);
  const to = pose([24, 26], 3);
  const cases = [['pass-left', {}, false], ['pass-right', {}, false], ['small-turn', { radius: 3 }, false], ['small-turn', { radius: 5 }, true]];

  test('every one holds its cone inside a circle of the type\'s radius, by the pass offset, turning towards it within CONE_TURNS', () => {
    for (const [type, sizes, mirrored] of cases) {
      const p = placed(type, sizes, 20, 20, mirrored);
      const turns = coneTurns(p, from, to, 4.5);
      expect(turns.length).toBeGreaterThan(20);
      const rho = coneTurnRadius(type, p.tpl.params);
      const off = passOffset(0.25);
      const left = type === 'pass-left' || (type === 'small-turn' && !mirrored);
      for (const q of turns) {
        const { turn } = q.tpl.params;
        expect(turn).toBeGreaterThanOrEqual(Math.max(CONE_TURNS[type].min, 1e-9));
        expect(turn).toBeLessThanOrEqual(CONE_TURNS[type].max + 1e-9);
        expect(q.tpl.point).toBe(true);
        // The heading turns by the turn, the way of the cone's side.
        const swing = ((((left ? 1 : -1) * (q.exitDir - q.entryDir) * 45) % 360) + 360) % 360;
        expect(Math.min(Math.abs(swing - turn), Math.abs(swing - turn + 360), Math.abs(swing - turn - 360))).toBeLessThan(1e-6);
        // Every point of the arc is rho from one centre, and the cone is at least `off` inside that circle.
        const [a, b, c] = [q.path[0], q.path[Math.floor(q.path.length / 2)], q.path.at(-1)];
        const centre = circumcentre(a, b, c);
        for (const pt of q.path) expect(Math.hypot(pt[0] - centre[0], pt[1] - centre[1])).toBeCloseTo(rho, 6);
        expect(rho - Math.hypot(20 - centre[0], 20 - centre[1])).toBeGreaterThanOrEqual(off - 1e-6);
        // The cone is on the turning side all the way round.
        for (let i = 1; i < q.path.length; i++) {
          const [p0, p1] = [q.path[i - 1], q.path[i]];
          const cross = (p1[0] - p0[0]) * (20 - p0[1]) - (p1[1] - p0[1]) * (20 - p0[0]);
          expect(left ? cross : -cross).toBeGreaterThan(0);
        }
      }
    }
  });

  test('the preferred turn comes first, the others after it, shortest first, and only when asked for', () => {
    for (const [type, sizes, mirrored] of cases) {
      const p = placed(type, sizes, 20, 20, mirrored);
      const all = [...freeHeadings(p, from, to, 4.5)];
      const plain = freeHeadings(p, from, to, 4.5, false);
      expect(all.slice(0, plain.length)).toEqual(plain);
      expect(plain.every((q) => q.tpl.params.turn === undefined)).toBe(true);
      expect(all.slice(plain.length).every((q) => q.tpl.params.turn !== undefined)).toBe(true);
    }
  });

  test('the turns step by CONE_TURN_STEP off the axes, and a passed cone straight past is never among them', () => {
    const p = placed('pass-right', {}, 20, 20);
    const turns = coneTurns(p, null, null, 4.5).map((q) => q.tpl.params.turn);
    expect(new Set(turns)).toEqual(new Set(Array.from({ length: 10 }, (_, k) => (k + 1) * CONE_TURN_STEP)));
  });
});

describe('generated courses', () => {
  test('keep the preferred turn: straight past a passed cone, 180° centred round a small U-turn\'s', () => {
    const recipe = { width: 40, length: 38, elements: 7, difficulty: 'medium', bike: 'sport', types: ['straight-slalom', 'gate', 'u-turn', 'box', 'pass-left', 'pass-right', 'small-turn'] };
    let fillers = 0;
    for (let seed = 1; seed <= sweep(40, 4); seed++) {
      const { course } = generateCourse(recipe, seed);
      for (const e of course.elements) {
        if (!CONE_TURNS[e.type]) continue;
        fillers++;
        expect(e.params.turn).toBeUndefined();
      }
      expect(routeLayout(layoutOf(course)).problems).toEqual([]);
    }
    expect(fillers).toBeGreaterThan(0);
  }, timeout(20000));
});

/** The centre of the circle through three points. */
function circumcentre([ax, ay], [bx, by], [cx, cy]) {
  const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
  const a2 = ax * ax + ay * ay;
  const b2 = bx * bx + by * by;
  const c2 = cx * cx + cy * cy;
  return [(a2 * (by - cy) + b2 * (cy - ay) + c2 * (ay - by)) / d, (a2 * (cx - bx) + b2 * (ax - cx) + c2 * (bx - ax)) / d];
}
