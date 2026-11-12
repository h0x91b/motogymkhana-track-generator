// The setup sheet must be enough to lay the course out with a tape measure:
// every cone position is recovered from the sheet's numbers alone.

import { describe, expect, test } from 'bun:test';
import { generateCourse } from '../src/generator/index.js';
import { buildSetupSheet, dist } from '../src/sheet/setup-sheet.js';
import { sweep } from './helpers/slow.js';

const RECIPES = [
  { width: 40, length: 60, elements: 8, difficulty: 'medium', shape: 'closed' },
  { width: 40, length: 60, elements: 6, difficulty: 'easy', shape: 'open' },
  { width: 30, length: 45, elements: 10, difficulty: 'hard', shape: 'closed' },
  { width: 40, length: 60, elements: 8, difficulty: 'hard', shape: 'return', train: true },
  // Puts on the course the types whose cards have their own checks, which a few
  // seeds of the mixed recipes can miss.
  { width: 40, length: 60, elements: 8, difficulty: 'medium', shape: 'closed', types: ['gate', 'figure-eight', 'box', 'lane-change', 'offset-slalom'] },
];
const SEEDS = sweep(40, 3);
const courses = RECIPES.flatMap((r) => Array.from({ length: SEEDS }, (_, seed) => generateCourse(r, seed).course));

const key = ([x, y]) => `${x},${y}`;
// Types laid out with a tape from a centre (or round one cone) rather than by dimension lines.
const LAID_FROM_CENTRES = ['pivot-turn', 'circle', 'fast-circle', 'snail', 'keyhole', 'crescent'];
const isHalf = (v) => Number.isInteger(v * 2);
/** A setup-sheet distance: always one decimal, decimal comma («12,0», «1,5»). */
const d1 = (v) => v.toFixed(1).replace('.', ',');

/** Rebuilds cone positions (metres) using nothing but the sheet. */
function reconstruct(sheet) {
  const cones = [];
  for (const card of sheet.cards) {
    for (const cone of card.cones) {
      let pos;
      if (card.axis.diagonal) {
        pos = [card.anchor.x + cone.dx, card.anchor.y + cone.dy];
      } else {
        const [ux, uy] = card.axis.vector;
        // across is measured to the left of the axis direction
        pos = [card.anchor.x + cone.along * ux - cone.across * uy, card.anchor.y + cone.along * uy + cone.across * ux];
      }
      cones.push({ pos, height: cone.height, color: cone.color });
    }
    // U-turn cones of the connector leaving the element, from its anchor.
    for (const t of card.turnCones) cones.push({ pos: [card.anchor.x + t.dx, card.anchor.y + t.dy], height: 'tall', color: t.color });
  }
  for (const t of sheet.shape === 'closed' ? [sheet.start] : [sheet.start, sheet.finish]) {
    for (const c of t.cones) cones.push({ pos: [c.x, c.y], height: 'low', color: 'neutral' });
  }
  return cones;
}

describe('setup sheet', () => {
  test('distances are printed to 0.1 m, always with one decimal and a decimal comma', () => {
    expect(dist(12)).toBe('12,0');
    expect(dist(1.5)).toBe('1,5');
    expect(dist(3.54)).toBe('3,5');
    expect(dist(-2.5)).toBe('−2,5');
    expect(dist(-0)).toBe('0,0');
    expect(dist(-0.01)).toBe('0,0');
  });

  test('all cone positions are recovered from the sheet alone and match the course', () => {
    for (const course of courses) {
      const sheet = buildSetupSheet(course);
      const fromSheet = reconstruct(sheet);
      const expected = course.cones.map((c) => key([c.hx / 2, c.hy / 2])).sort();
      expect(fromSheet.map((c) => key(c.pos)).sort(), `seed ${course.seed}`).toEqual(expected);
    }
  });

  test('anchors are whole metres and every distance inside an element is a multiple of 0.5 m', () => {
    for (const course of courses) {
      for (const card of buildSetupSheet(course).cards) {
        expect(Number.isInteger(card.anchor.x) && Number.isInteger(card.anchor.y)).toBe(true);
        for (const cone of card.cones) {
          const values = card.axis.diagonal ? [cone.dx, cone.dy] : [cone.along, cone.across];
          for (const v of values) expect(isHalf(v), `seed ${course.seed} card ${card.number}`).toBe(true);
        }
        // The anchor is the element's first listed cone, at zero offset.
        const first = card.cones[0];
        expect(card.axis.diagonal ? [first.dx, first.dy] : [first.along, first.across]).toEqual([0, 0]);
      }
    }
  });

  test('cards follow the passing order and carry type, cone colours and the pivot angle', () => {
    for (const course of courses) {
      const sheet = buildSetupSheet(course);
      expect(sheet.cards.map((c) => c.number)).toEqual(course.elements.map((e) => e.order));
      sheet.cards.forEach((card, i) => {
        const element = course.elements[i];
        expect(card.type).toBe(element.type);
        expect(card.name.length).toBeGreaterThan(0);
        const pivot = course.passes.find((p) => p.element === element.id && p.angle);
        expect(card.angle ?? null).toBe(pivot ? pivot.angle : null);
        for (const cone of card.cones) {
          expect(cone.height === 'tall' ? ['blue', 'red'] : ['neutral']).toContain(cone.color);
        }
      });
    }
  });

  test('a cone that stays left is blue and one that stays right is red', () => {
    for (const course of courses.slice(0, 20)) {
      const sheet = buildSetupSheet(course);
      sheet.cards.forEach((card, i) => {
        const element = course.elements[i];
        const ids = element.cones;
        for (const pass of course.passes.filter((p) => p.element === element.id && p.kind !== 'line')) {
          const sides = pass.kind === 'gate' ? [[pass.left, 'left'], [pass.right, 'right']] : [[pass.cone, pass.side]];
          for (const [id, side] of sides) {
            expect(card.cones[ids.indexOf(id)].color).toBe(side === 'left' ? 'blue' : 'red');
          }
        }
      });
    }
  });

  test('a lane change says which way the second gate is shifted, from the cone positions', () => {
    let seen = 0;
    for (const course of courses) {
      const byId = new Map(course.cones.map((c) => [c.id, c]));
      for (const card of buildSetupSheet(course).cards.filter((c) => c.type === 'lane-change')) {
        seen++;
        const e = course.elements.find((x) => x.id === card.element);
        const [a, b, c, d] = e.cones.map((id) => [byId.get(id).hx / 2, byId.get(id).hy / 2]);
        const move = [(c[0] + d[0] - a[0] - b[0]) / 2, (c[1] + d[1] - a[1] - b[1]) / 2];
        const u = [Math.cos((e.entry.dir * Math.PI) / 4), Math.sin((e.entry.dir * Math.PI) / 4)];
        const left = u[0] * move[1] - u[1] * move[0] > 0;
        expect(card.notes.join(' ')).toContain(left ? 'смещены влево' : 'смещены вправо');
      }
    }
    expect(seen).toBeGreaterThan(sweep(5, 0));
  });

  test('an offset slalom note gives the same gap between the rows as the cone table', () => {
    let seen = 0;
    for (const course of courses) {
      for (const card of buildSetupSheet(course).cards.filter((c) => c.type === 'offset-slalom' && !c.axis.diagonal)) {
        seen++;
        const across = card.cones.map((c) => c.across);
        const gap = Math.max(...across) - Math.min(...across);
        expect(card.notes.join(' ')).toContain(`между рядами ${d1(gap)} м`);
      }
    }
    expect(seen).toBeGreaterThan(sweep(3, 0));
  });

  test('dimension lines run along or across the axis, are multiples of 0.5 m and are labelled with their length', () => {
    for (const course of courses) {
      for (const card of buildSetupSheet(course).cards) {
        expect(card.dims.length > 0, `${card.type}`).toBe(!LAID_FROM_CENTRES.includes(card.type));
        const [sx, sy] = card.axis.vector;
        for (const d of card.dims) {
          const dx = d.to.x - d.from.x;
          const dy = d.to.y - d.from.y;
          const parallel = Math.abs(dx * sy - dy * sx) < 1e-9;
          const perpendicular = Math.abs(dx * sx + dy * sy) < 1e-9;
          expect(parallel || perpendicular, `seed ${course.seed} ${card.type}`).toBe(true);
          for (const v of [d.from.x, d.from.y, d.to.x, d.to.y]) expect(isHalf(v)).toBe(true);
          if (card.axis.diagonal) {
            expect(Math.abs(dx)).toBe(Math.abs(dy));
            expect(d.value).toBe(Math.abs(dx));
            // Labelled with the true slant length, not the X/Y offset.
            expect(d.label).toBe(`${d1(Math.round(d.value * Math.SQRT2 * 10) / 10)} м`);
          } else {
            expect(d.value).toBe(Math.hypot(dx, dy));
            expect(d.label).toBe(`${d1(d.value)} м`);
          }
          expect(d.value > 0 && isHalf(d.value), `seed ${course.seed} ${card.type}`).toBe(true);
          // The sheet's notes give the same number.
          expect(card.notes.join(' '), `seed ${course.seed} ${card.type}`).toContain(d.label);
        }
      }
    }
  });

  test('the defining size of a gate, figure eight and box is dimensioned between its real cones', () => {
    const seen = new Set();
    for (const course of courses) {
      const byId = new Map(course.cones.map((c) => [c.id, [c.hx / 2, c.hy / 2]]));
      const defined = (c) => !c.axis.diagonal && ['gate', 'figure-eight', 'box'].includes(c.type);
      for (const card of buildSetupSheet(course).cards.filter(defined)) {
        const e = course.elements.find((x) => x.id === card.element);
        const [p0, p1] = e.cones.map((id) => byId.get(id));
        const between = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
        const lengths = card.dims.map((d) => d.value);
        if (card.type === 'gate' || card.type === 'figure-eight') expect(lengths).toEqual([between]);
        if (card.type === 'box') expect(lengths).toEqual([between, between]);
        seen.add(card.type);
      }
    }
    for (const type of ['gate', 'figure-eight', 'box']) expect(seen.has(type), type).toBe(true);
  });

  test('each element after the first is placed from the previous anchor, and that chain alone rebuilds every anchor', () => {
    const signed = (v) => (v > 0 ? `+${d1(v)}` : v < 0 ? `−${d1(-v)}` : '0,0');
    for (const course of courses) {
      const { cards } = buildSetupSheet(course);
      expect(cards[0].fromPrevious).toBeNull();
      let at = cards[0].anchor;
      for (const card of cards.slice(1)) {
        const step = card.fromPrevious;
        expect(step.from).toBe(card.number - 1);
        expect(Number.isInteger(step.dx) && Number.isInteger(step.dy)).toBe(true);
        at = { x: at.x + step.dx, y: at.y + step.dy };
        expect(at, `seed ${course.seed} card ${card.number}`).toEqual(card.anchor);
        expect(step.label).toBe(`От якоря ${step.from}: X ${signed(step.dx)} м · Y ${signed(step.dy)} м`);
      }
    }
  });

  test('turn direction is given only for elements that really turn one way', () => {
    for (const course of courses.slice(0, 30)) {
      for (const card of buildSetupSheet(course).cards) {
        if (['u-turn', 'pivot-turn', 'box', 'circle', 'fast-circle', 'mirror', 'gate-turn', 'keyhole'].includes(card.type)) {
          expect(['left', 'right']).toContain(card.turn);
        }
        else expect(card.turn).toBeNull();
      }
    }
  });

  test('the cone list counts each physical cone once, by kind', () => {
    for (const course of courses) {
      const { coneList } = buildSetupSheet(course);
      const cones = reconstruct(buildSetupSheet(course));
      expect(coneList.tallBlue).toBe(cones.filter((c) => c.height === 'tall' && c.color === 'blue').length);
      expect(coneList.tallRed).toBe(cones.filter((c) => c.height === 'tall' && c.color === 'red').length);
      expect(coneList.low).toBe(cones.filter((c) => c.height === 'low').length);
      expect(coneList.tallBlue + coneList.tallRed + coneList.low).toBe(course.cones.length);
    }
  });

  test('a U-turn cone is listed on the card its connector leaves, measured from that anchor', () => {
    let seen = 0;
    for (const course of courses) {
      const sheet = buildSetupSheet(course);
      const byId = new Map(course.cones.map((c) => [c.id, c]));
      for (const pass of course.passes.filter((p) => p.connector)) {
        seen++;
        const card = sheet.cards.find((c) => c.element === pass.connector.from);
        const t = card.turnCones.find((x) => x.cone === pass.cone);
        const cone = byId.get(pass.cone);
        expect([card.anchor.x + t.dx, card.anchor.y + t.dy]).toEqual([cone.hx / 2, cone.hy / 2]);
        expect(isHalf(t.dx) && isHalf(t.dy)).toBe(true);
        expect(t.color).toBe(pass.side === 'left' ? 'blue' : 'red');
        expect(card.notes).toContain(t.label);
        expect(t.label).toContain(`от якоря ${card.number}`);
      }
    }
    expect(seen).toBeGreaterThan(sweep(20, 0));
  });

  test('a closed course lists one start-finish line, an open course two lines', () => {
    for (const course of courses) {
      const sheet = buildSetupSheet(course);
      expect(sheet.start.cones).toHaveLength(2);
      if (course.route.shape === 'closed') expect(sheet.finish).toEqual(sheet.start);
      else expect(sheet.finish.cones).not.toEqual(sheet.start.cones);
    }
  });

  test('a finish by the start is measured from the start line, and the offset leads to it', () => {
    let n = 0;
    for (const course of courses) {
      const sheet = buildSetupSheet(course);
      expect(sheet.shape).toBe(course.route.shape);
      if (course.route.shape !== 'return') {
        expect(sheet.finish.fromStart).toBeUndefined();
        continue;
      }
      n++;
      const { dx, dy } = sheet.finish.fromStart;
      expect(sheet.start.center.x + dx).toBeCloseTo(sheet.finish.center.x, 9);
      expect(sheet.start.center.y + dy).toBeCloseTo(sheet.finish.center.y, 9);
      expect(Math.hypot(dx, dy)).toBeLessThanOrEqual(8);
    }
    expect(n).toBe(SEEDS);
  });

  test('the sheet carries the site size and the simplification counts', () => {
    const course = generateCourse({ width: 25, length: 30, elements: 5, difficulty: 'easy', shape: 'closed' }, 42).course;
    const sheet = buildSetupSheet(course);
    expect(sheet.site).toEqual({ width: 25, length: 30 });
    expect(sheet.requested).toBe(5);
    expect(sheet.placed).toBe(course.placed);
  });
});
