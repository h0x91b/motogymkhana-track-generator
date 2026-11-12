// The setup sheet must be enough to lay the course out with a tape measure:
// every cone position is recovered from the sheet's numbers alone.

import { describe, expect, test } from 'bun:test';
import { generateCourse } from '../src/generator/index.js';
import { editAxes } from '../src/generator/catalog.js';
import { ELEMENT_TYPES } from '../src/generator/recipe.js';
import { conesCsv } from '../src/file/course-file.js';
import { layoutOf, replaceElement, rotateElement, routeLayout, turnElementTo } from '../src/generator/layout.js';
import { buildSetupSheet, dist, lineCrossing } from '../src/sheet/setup-sheet.js';
import { sweep } from './helpers/slow.js';

const RECIPES = [
  { width: 40, length: 60, elements: 8, difficulty: 'medium', shape: 'closed' },
  { width: 40, length: 60, elements: 6, difficulty: 'easy', shape: 'open' },
  { width: 30, length: 45, elements: 10, difficulty: 'hard', shape: 'closed' },
  { width: 40, length: 60, elements: 8, difficulty: 'hard', shape: 'return', train: true },
  // Puts on the course the types whose cards have their own checks, which a few
  // seeds of the mixed recipes can miss.
  { width: 40, length: 60, elements: 8, difficulty: 'medium', shape: 'closed', types: ['gate', 'figure-eight', 'box', 'lane-change', 'offset-slalom'] },
  // Figure eights alone with small types: the recipe above rarely fits one beside its box.
  { width: 40, length: 60, elements: 8, difficulty: 'medium', shape: 'open', types: ['figure-eight', 'gate', 'straight-slalom'] },
];
const SEEDS = sweep(40, 3);
const courses = RECIPES.flatMap((r) => Array.from({ length: SEEDS }, (_, seed) => generateCourse(r, seed).course));

const key = ([x, y]) => `${x},${y}`;
// Types laid out with a tape from a centre (or round one cone) rather than by dimension lines.
// A single cone has no dimension line either: the card says its side or turn.
const LAID_FROM_CENTRES = ['pivot-turn', 'circle', 'fast-circle', 'snail', 'keyhole', 'crescent', 'pass-left', 'pass-right', 'small-turn'];
const isHalf = (v) => Number.isInteger(v * 2);
/** A setup-sheet distance: always one decimal, decimal comma («12,0», «1,5»). */
const d1 = (v) => v.toFixed(1).replace('.', ',');

/** Rebuilds cone positions (metres) using nothing but the sheet. */
function reconstruct(sheet) {
  const cones = [];
  for (const card of sheet.cards) {
    for (const cone of card.cones) {
      let pos;
      if (card.axis.xy) {
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
  // A closed course finishes on its start line, a `return` one in its start box.
  for (const t of sheet.shape === 'open' ? [sheet.start, sheet.finish] : [sheet.start]) {
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

  test('anchors are whole metres (a ring centre on the 0.5 m grid) and every distance inside an element is a multiple of 0.5 m', () => {
    for (const course of courses) {
      for (const card of buildSetupSheet(course).cards) {
        const onGrid = card.anchorAtCentre ? isHalf : Number.isInteger;
        expect(onGrid(card.anchor.x) && onGrid(card.anchor.y)).toBe(true);
        for (const cone of card.cones) {
          const values = card.axis.diagonal ? [cone.dx, cone.dy] : [cone.along, cone.across];
          for (const v of values) expect(isHalf(v), `seed ${course.seed} card ${card.number}`).toBe(true);
        }
        // The anchor is the element's first listed cone, at zero offset; a ring's is its centre.
        if (card.anchorAtCentre) continue;
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
          expect(cone.height === 'tall' ? ['blue', 'red', 'striped'] : ['neutral']).toContain(cone.color);
        }
      });
    }
  });

  test('a cone that stays left is blue, one that stays right is red, the pivot turn\'s red with a yellow stripe', () => {
    for (const course of courses.slice(0, 20)) {
      const sheet = buildSetupSheet(course);
      sheet.cards.forEach((card, i) => {
        const element = course.elements[i];
        const ids = element.cones;
        for (const pass of course.passes.filter((p) => p.element === element.id && p.kind !== 'line')) {
          const sides = pass.kind === 'gate' ? [[pass.left, 'left'], [pass.right, 'right']] : [[pass.cone, pass.side]];
          for (const [id, side] of sides) {
            const expected = pass.angle > 180 ? 'striped' : side === 'left' ? 'blue' : 'red';
            expect(card.cones[ids.indexOf(id)].color, element.type).toBe(expected);
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
        expect(isHalf(step.dx) && isHalf(step.dy)).toBe(true);
        if (!card.anchorAtCentre && !cards[card.number - 2].anchorAtCentre) expect(Number.isInteger(step.dx) && Number.isInteger(step.dy)).toBe(true);
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
      expect(coneList.tallStriped).toBe(cones.filter((c) => c.height === 'tall' && c.color === 'striped').length);
      expect(coneList.low).toBe(cones.filter((c) => c.height === 'low').length);
      expect(coneList.tallBlue + coneList.tallRed + coneList.tallStriped + coneList.low).toBe(course.cones.length);
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

  test('a closed course lists one start-finish line, a finish by the start one box, an open course two lines', () => {
    for (const course of courses) {
      const sheet = buildSetupSheet(course);
      const { shape } = course.route;
      expect(sheet.start.cones).toHaveLength(shape === 'return' ? 4 : 2);
      if (shape === 'closed') expect(sheet.finish).toEqual(sheet.start);
      else if (shape === 'return') expect(sheet.finish.cones).toEqual(sheet.start.cones);
      else expect(sheet.finish.cones).not.toEqual(sheet.start.cones);
    }
  });

  test('a finish by the start names the box size and how the rider crosses the start line back', () => {
    let n = 0;
    for (const course of courses) {
      const sheet = buildSetupSheet(course);
      expect(sheet.shape).toBe(course.route.shape);
      if (course.route.shape !== 'return') {
        expect(sheet.finish.crossing).toBeUndefined();
        continue;
      }
      n++;
      expect([3, 2 * Math.SQRT2].some((size) => Math.abs(sheet.start.box.size - size) < 1e-9)).toBe(true);
      expect(sheet.finish.crossing).toBe(lineCrossing(sheet.start.dir, sheet.finish.dir));
      expect(['square', 'angled']).toContain(sheet.finish.crossing);
    }
    expect(n).toBe(SEEDS);
  });

  test('the sheet carries the site size and the simplification counts', () => {
    const course = generateCourse({ width: 25, length: 30, elements: 5, difficulty: 'easy', shape: 'closed' }, 42).course;
    const sheet = buildSetupSheet(course);
    expect(sheet.site).toEqual({ width: 25, length: 30, blocked: [] });
    expect(sheet.requested).toBe(5);
    expect(sheet.placed).toBe(course.placed);
  });

  test('an element laid out from arcs gives each arc by centre, radius and cone count, not a cone table', () => {
    const ARC_TYPES = ['circle', 'fast-circle', 'snail', 'keyhole', 'crescent'];
    const seen = new Set();
    for (const type of ARC_TYPES) {
      for (let seed = 0; seed < 6 && !seen.has(type); seed++) {
        const result = generateCourse({ width: 50, length: 70, elements: 3, difficulty: 'medium', shape: 'open', types: [type, 'gate'] }, seed);
        if (!result.ok) continue;
        const course = result.course;
        const byId = new Map(course.cones.map((c) => [c.id, c]));
        for (const card of buildSetupSheet(course).cards) {
          if (card.type !== type) continue;
          seen.add(type);
          const e = course.elements.find((el) => el.id === card.element);
          expect(card.table, type).toBe(false);
          expect(card.arcs.length, type).toBeGreaterThan(0);
          for (const arc of card.arcs) {
            // Every cone listed on an arc is that far from its centre, give or take lattice snapping.
            for (const n of arc.cones) {
              const c = byId.get(e.cones[n - 1]);
              expect(Math.abs(Math.hypot(c.hx / 2 - arc.center.x, c.hy / 2 - arc.center.y) - arc.radius), `${type} cone ${n}`).toBeLessThan(0.37);
            }
            expect(arc.count).toBe(arc.cones.length);
            // The centre from the anchor is where the centre is.
            expect([card.anchor.x + arc.fromAnchor.dx, card.anchor.y + arc.fromAnchor.dy]).toEqual([arc.center.x, arc.center.y]);
            expect(card.notes.join(' ')).toContain(`радиус ${d1(arc.radius)} м`);
            expect(card.notes.join(' ')).toContain(`${arc.count} конус`);
            // Neighbours on a full ring are the ring's length shared out between them.
            if (arc.full) expect(Math.abs(arc.step - (2 * Math.PI * arc.radius) / arc.count)).toBeLessThan(0.06);
          }
          // Every cone is on an arc or has its own line.
          const loose = new Set(card.loose.map((l) => l.n));
          for (const cone of card.cones) expect(cone.arc !== undefined || loose.has(cone.n), `${type} cone ${cone.n}`).toBe(true);
          if (type === 'crescent') {
            expect(card.arcs.map((a) => a.count)).toEqual([5]);
            expect(card.loose.map((l) => l.n)).toEqual([6]);
            expect(card.notes).toContain(card.loose[0].label);
          }
        }
      }
    }
    expect([...seen].sort()).toEqual([...ARC_TYPES].sort());
  });

  test('straight elements keep their cone table and have no arcs', () => {
    for (const course of courses) {
      for (const card of buildSetupSheet(course).cards) {
        if (LAID_FROM_CENTRES.includes(card.type)) continue;
        expect(card.table, card.type).toBe(true);
        expect(card.arcs).toEqual([]);
      }
    }
  });

  test('a ring is measured from its centre: a keyhole has a tall cone there, and the chain of anchors reaches it', () => {
    let found = 0;
    for (let seed = 0; seed < 8 && found < 2; seed++) {
      const result = generateCourse({ width: 50, length: 70, elements: 3, difficulty: 'medium', shape: 'open', types: ['keyhole', 'circle', 'gate'] }, seed);
      if (!result.ok) continue;
      const course = result.course;
      const byId = new Map(course.cones.map((c) => [c.id, c]));
      for (const card of buildSetupSheet(course).cards) {
        // A circle stretched into an oval is two half circles, not a ring.
        if (card.type !== 'keyhole' && !(card.type === 'circle' && card.arcs.length === 1)) continue;
        found++;
        const e = course.elements.find((el) => el.id === card.element);
        expect(card.anchorAtCentre).toBe(true);
        expect([card.anchor.x, card.anchor.y]).toEqual([e.guides[0].x, e.guides[0].y]);
        expect(card.arcs[0].fromAnchor).toEqual({ dx: 0, dy: 0 });
        if (card.type === 'keyhole') {
          const centre = e.cones.map((id) => byId.get(id)).filter((c) => c.hx / 2 === card.anchor.x && c.hy / 2 === card.anchor.y);
          expect(centre.map((c) => c.height)).toEqual(['tall']);
          expect(e.cones.filter((id) => byId.get(id).height === 'low').length).toBe(12);
        }
      }
    }
    expect(found).toBeGreaterThan(0);
  });
});

describe('the setup sheet of an element turned by 22.5°', () => {
  // Every element turned one step in «Правка»: 22.5°, or 45° for a side-only type, off the lattice either way.
  const turned = [courses[0], courses[courses.length - 1]].map((course) => {
    let layout = layoutOf(course);
    for (let i = 0; i < layout.elements.length; i++) layout = rotateElement(layout, i, 1);
    return routeLayout(layout).course;
  });
  const near = (v) => Math.round(v * 1e6) / 1e6 + 0;

  test('its cones are laid out by X and Y from the anchor, and the sheet alone rebuilds them', () => {
    for (const course of turned) {
      const sheet = buildSetupSheet(course);
      expect(JSON.stringify(sheet)).not.toMatch(/NaN|undefined/);
      for (const card of sheet.cards) {
        expect(card.axis.offLattice && card.axis.xy, card.type).toBe(true);
        expect(card.axis.diagonal).toBe(false);
        expect(card.axis.label).toMatch(/^под углом \d+(,5)?° к ширине/);
        expect(Number.isInteger(card.anchor.x) && Number.isInteger(card.anchor.y)).toBe(true);
        expect([card.cones[0].dx, card.cones[0].dy]).toEqual([0, 0]);
      }
      const fromSheet = reconstruct(sheet).map((c) => key(c.pos.map(near))).sort();
      expect(fromSheet).toEqual(course.cones.map((c) => key([near(c.hx / 2), near(c.hy / 2)])).sort());
    }
  });

  test('its dimension lines run along or across the turned axis and say true lengths in 0.5 m steps', () => {
    let checked = 0;
    for (const course of turned) {
      for (const card of buildSetupSheet(course).cards) {
        expect(card.dims.length > 0, card.type).toBe(!LAID_FROM_CENTRES.includes(card.type));
        const [sx, sy] = card.axis.vector;
        expect(Math.hypot(sx, sy)).toBeCloseTo(1, 12);
        for (const d of card.dims) {
          const dx = d.to.x - d.from.x;
          const dy = d.to.y - d.from.y;
          expect(Math.abs(dx * sy - dy * sx) < 1e-9 || Math.abs(dx * sx + dy * sy) < 1e-9, card.type).toBe(true);
          expect(d.value).toBeCloseTo(Math.hypot(dx, dy), 9);
          expect(d.value > 0 && isHalf(near(d.value)), `${card.type} ${d.value}`).toBe(true);
          expect(d.label).toBe(`${d1(Math.round(d.value * 10) / 10)} м`);
          expect(card.notes.join(' '), card.type).toContain(d.label);
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(5);
  });

  test('every type at every orientation of «Правка» gives a sheet and a cone list without a hole', () => {
    const base = layoutOf(courses[0]);
    for (const type of ELEMENT_TYPES) {
      let layout = replaceElement(base, 0, type);
      for (const axis of editAxes(type)) {
        layout = turnElementTo(layout, 0, axis * 45);
        expect(layout.elements[0].axis).toBe(axis);
        const { course } = routeLayout(layout);
        const sheet = buildSetupSheet(course);
        expect(`${JSON.stringify(course)}${JSON.stringify(sheet)}${conesCsv(course, sheet)}`, `${type} ${axis * 45}°`).not.toMatch(/NaN|undefined|Infinity/);
      }
    }
  });
});
