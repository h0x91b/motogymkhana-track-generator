// The setup sheet must be enough to lay the course out with a tape measure:
// every cone position is recovered from the sheet's numbers alone.

import { describe, expect, test } from 'bun:test';
import { generateCourse } from '../src/generator/index.js';
import { buildSetupSheet } from '../src/sheet/setup-sheet.js';

const RECIPES = [
  { width: 40, length: 60, elements: 8, difficulty: 'medium', closed: true },
  { width: 40, length: 60, elements: 6, difficulty: 'easy', closed: false },
  { width: 30, length: 45, elements: 10, difficulty: 'hard', closed: true },
];
const courses = RECIPES.flatMap((r) => Array.from({ length: 40 }, (_, seed) => generateCourse(r, seed).course));

const key = ([x, y]) => `${x},${y}`;
const isHalf = (v) => Number.isInteger(v * 2);

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
  }
  for (const t of sheet.closed ? [sheet.start] : [sheet.start, sheet.finish]) {
    for (const c of t.cones) cones.push({ pos: [c.x, c.y], height: 'low', color: 'neutral' });
  }
  return cones;
}

describe('setup sheet', () => {
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
        for (const pass of course.passes.filter((p) => p.element === element.id)) {
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
    expect(seen).toBeGreaterThan(5);
  });

  test('turn direction is given only for elements that really turn one way', () => {
    for (const course of courses.slice(0, 30)) {
      for (const card of buildSetupSheet(course).cards) {
        if (['u-turn', 'pivot-turn', 'box'].includes(card.type)) expect(['left', 'right']).toContain(card.turn);
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

  test('a closed course lists one start-finish line, an open course two lines', () => {
    for (const course of courses) {
      const sheet = buildSetupSheet(course);
      expect(sheet.start.cones).toHaveLength(2);
      if (course.route.closed) expect(sheet.finish).toEqual(sheet.start);
      else expect(sheet.finish.cones).not.toEqual(sheet.start.cones);
    }
  });

  test('the sheet carries the site size and the simplification counts', () => {
    const course = generateCourse({ width: 25, length: 30, elements: 5, difficulty: 'easy', closed: true }, 42).course;
    const sheet = buildSetupSheet(course);
    expect(sheet.site).toEqual({ width: 25, length: 30 });
    expect(sheet.requested).toBe(5);
    expect(sheet.placed).toBe(course.placed);
  });
});
