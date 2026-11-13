// The start and the finish in «Правка»: moved and turned like elements, the
// connectors re-routed from where they are put, the problems reported on
// «старт → 1» and «N → финиш», and the pose kept in the course file. Checked
// on what comes out — the course, its problems and the file — never on how
// the router got there.

import { describe, expect, test } from 'bun:test';
import { canonicalJSON, generateCourse, parseRecipe } from '../src/generator/index.js';
import { typicalSizes } from '../src/generator/catalog.js';
import {
  layoutOf, moveElement, parseLayout, resetTerminal, rotateElement, routeLayout, terminalPose, terminalsOf, turnElementTo,
} from '../src/generator/layout.js';
import { buildSetupSheet } from '../src/sheet/setup-sheet.js';
import { conesCsv, courseDocument, courseFileText, readCourseFile } from '../src/file/course-file.js';
import { coneXY, conesById } from './helpers/course-geometry.js';

const SHAPES = ['open', 'closed', 'return'];

/** A roomy empty site with one gate in the middle: the start stands 2 m before it, an open course's finish 2 m past it. */
function single(shape) {
  const recipe = parseRecipe({ width: 60, length: 60, elements: 1, difficulty: 'medium', bike: 'cruiser', shape }).recipe;
  return { recipe, seed: 0, elements: [{ type: 'gate', sizes: typicalSizes('gate', 'medium', 'cruiser'), axis: 0, mirrored: false, x: 30, y: 30 }] };
}

const generated = SHAPES.map((shape) => generateCourse({ width: 40, length: 60, elements: 6, difficulty: 'medium', shape }, 1).course);
const codes = (problems) => problems.map((p) => p.code);
const startCone = (course) => coneXY(conesById(course).get(course.route.start.cones[0]));
const saved = (layout) => readCourseFile(courseFileText(courseDocument(layout, { edited: true })));

describe('an untouched start', () => {
  test('is not in the layout of a generated course, and follows the first element', () => {
    for (const course of generated) {
      const layout = layoutOf(course);
      expect(layout.start).toBeUndefined();
      const pose = terminalPose(layout, 'start');
      expect(pose.pinned).toBe(false);
      expect([pose.x, pose.y, pose.axis]).toEqual([...startCone(course), course.route.start.dir]);
      const moved = routeLayout(moveElement(layout, 0, layout.elements[0].x - 2, layout.elements[0].y - 2)).course;
      expect(startCone(moved)).not.toEqual(startCone(course));
    }
  });

  test('put by hand exactly where the generator has it, or moved and moved back, gives the same course byte for byte', () => {
    for (const course of generated) {
      const layout = layoutOf(course);
      const same = canonicalJSON(routeLayout(layout).course);
      const { x, y, axis } = terminalPose(layout, 'start');
      expect(canonicalJSON(routeLayout({ ...layout, start: { x, y, axis } }).course), course.recipe.shape).toBe(same);
      const there = moveElement(layout, 'start', x + 3, y - 2);
      expect(canonicalJSON(routeLayout(moveElement(there, 'start', x, y)).course)).toBe(same);
      expect(canonicalJSON(routeLayout(resetTerminal(there, 'start')).course)).toBe(same);
    }
  });

  test('only an open course has a finish of its own', () => {
    expect(generated.map((c) => terminalsOf(layoutOf(c)))).toEqual([['start', 'finish'], ['start'], ['start']]);
  });
});

describe('a start moved or turned by hand', () => {
  test('stands where it was put; the way to the first element starts there and ends at its entry', () => {
    for (const shape of SHAPES) {
      const layout = moveElement(single(shape), 'start', 16, 40);
      const { course, problems } = routeLayout(layout);
      expect(layout.start).toEqual({ x: 16, y: 40, axis: 0 });
      expect(startCone(course)).toEqual([16, 40]);
      expect(problems, shape).toEqual([]);
      const first = course.route.legs[0];
      expect(first.from).toBe('start');
      expect(first.path[0]).toEqual([course.route.start.x, course.route.start.y]);
      const { entry } = course.elements[0];
      expect(first.path.at(-1)).toEqual([entry.x, entry.y]);
      // The element stays where it was.
      expect(course.elements[0].entry).toEqual(routeLayout(single(shape)).course.elements[0].entry);
    }
  });

  test('turns in 22.5° steps about the middle of its line, and a full turn ends where it began', () => {
    for (const shape of SHAPES) {
      const layout = single(shape);
      const turned = turnElementTo(layout, 'start', 67.5);
      expect(turned.start.axis).toBe(1.5);
      expect(routeLayout(turned).course.route.start.dir).toBe(1.5);
      expect(turnElementTo(layout, 'start', 70).start.axis).toBe(1.5);
      let round = layout;
      for (let k = 0; k < 16; k++) round = rotateElement(round, 'start', 1);
      const { x, y, axis } = terminalPose(layout, 'start');
      expect([round.start.x, round.start.y, round.start.axis]).toEqual([x, y, axis]);
    }
  });

  test('turned a half step, its cones stay on the 0.5 m grid, the first on whole metres', () => {
    for (const shape of SHAPES) {
      const { course } = routeLayout(turnElementTo(moveElement(single(shape), 'start', 16, 40), 'start', 22.5));
      const byId = conesById(course);
      const cones = course.route.start.cones.map((id) => byId.get(id));
      for (const c of cones) expect(Number.isInteger(c.hx) && Number.isInteger(c.hy), `${shape} ${c.id}`).toBe(true);
      expect(cones[0].hx % 2 === 0 && cones[0].hy % 2 === 0, shape).toBe(true);
    }
  });

  test('is kept on the site by a move, as an element is', () => {
    for (const shape of SHAPES) {
      const { start } = moveElement(single(shape), 'start', -10, 30);
      expect(start.x).toBeGreaterThanOrEqual(1);
      expect(routeLayout({ ...single(shape), start }).problems.some((p) => p.code === 'start-off-site')).toBe(false);
    }
  });

  test('says what is wrong with it: off the site, on an element, a way to the first element that cannot keep the rules', () => {
    for (const shape of SHAPES) {
      const layout = single(shape);
      const off = routeLayout({ ...layout, start: { x: 0, y: 30, axis: 0 } }).problems;
      expect(codes(off), shape).toContain('start-off-site');
      expect(off.find((p) => p.code === 'start-off-site').text).toMatch(/^Старт выходит за площадку/);
      const onto = routeLayout(moveElement(layout, 'start', 30, 30)).problems;
      expect(codes(onto), shape).toContain('start-overlap');
      expect(onto.find((p) => p.code === 'start-overlap').text).toBe('Старт накладывается на элемент 1 — отодвиньте старт или элемент 1');
      // Facing away from the gate it stands before: the way to it has to turn back through something.
      const away = routeLayout(turnElementTo(layout, 'start', 180)).problems;
      const connector = away.find((p) => p.connector === 0);
      expect(connector, shape).toBeDefined();
      expect(connector.text).toContain('старт → 1');
    }
  });

  test('a return course comes back across the line where it was put, into the box', () => {
    const layout = turnElementTo(moveElement(single('return'), 'start', 16, 40), 'start', 67.5);
    const { course, problems } = routeLayout(layout);
    const home = course.route.legs.at(-1).path;
    expect(course.route.finish.cones).toEqual(course.route.start.cones);
    // The way back ends at the stop in the box, 1.5 m past the middle of the line.
    expect(Math.hypot(home.at(-1)[0] - course.route.start.x, home.at(-1)[1] - course.route.start.y)).toBeCloseTo(1.5, 1);
    expect(problems.filter((p) => p.connector === 1).every((p) => p.text.includes('1 → финиш'))).toBe(true);
  });

  test('a closed course closes on the line where it was put', () => {
    const { course } = routeLayout(moveElement(single('closed'), 'start', 16, 40));
    expect(course.route.legs.at(-1).path.at(-1)).toEqual([course.route.start.x, course.route.start.y]);
  });
});

describe('the finish of an open course moved by hand', () => {
  test('stands where it was put and the way from the last element reaches it', () => {
    const layout = moveElement(single('open'), 'finish', 40, 20);
    const { course, problems } = routeLayout(layout);
    const finish = coneXY(conesById(course).get(course.route.finish.cones[0]));
    expect(finish).toEqual([40, 20]);
    expect(course.route.legs.at(-1).path.at(-1)).toEqual([course.route.finish.x, course.route.finish.y]);
    expect(problems).toEqual([]);
  });

  test('its problems are on «N → финиш» and on the finish line', () => {
    const layout = single('open');
    const onto = routeLayout(moveElement(layout, 'finish', 30, 30)).problems;
    expect(codes(onto)).toContain('finish-overlap');
    // Against the left edge and crossed towards the lot: there is no room to line up before it.
    const wall = routeLayout({ ...layout, finish: { x: 3, y: 20, axis: 0 } }).problems;
    expect(wall.map((p) => `${p.code}:${p.connector}`)).toEqual(['connector-off-site:1']);
    expect(wall[0].text).toContain('1 → финиш');
  });

  test('a closed or return course has none to move: its pose in a layout is ignored', () => {
    const layout = single('return');
    const same = canonicalJSON(routeLayout(layout).course);
    expect(canonicalJSON(routeLayout({ ...layout, finish: { x: 40, y: 20, axis: 0 } }).course)).toBe(same);
    expect(parseLayout(JSON.parse(JSON.stringify({ ...layout, finish: { x: 40, y: 20, axis: 0 } }))).finish).toBeUndefined();
  });
});

describe('the start and finish in the course file and on the sheet', () => {
  test('a start and finish put by hand open back where they were, and the file version stays', () => {
    let layout = single('open');
    layout = turnElementTo(moveElement(layout, 'start', 16, 40), 'start', 67.5);
    layout = moveElement(layout, 'finish', 40, 20);
    const doc = courseDocument(layout, { edited: true });
    expect(doc.version).toBe(1);
    const read = saved(layout);
    expect(read.ok).toBe(true);
    expect(read.layout.start).toEqual(layout.start);
    expect(read.layout.finish).toEqual(layout.finish);
    const [a, b] = [routeLayout(read.layout), routeLayout(layout)];
    expect(canonicalJSON(a.course)).toBe(canonicalJSON(b.course));
    expect(canonicalJSON(a.problems)).toBe(canonicalJSON(b.problems));
  });

  test('a file without them opens with the start where the generator puts it; a broken pose is refused', () => {
    const layout = layoutOf(generated[2]);
    const read = saved(layout);
    expect(read.layout.start).toBeUndefined();
    expect(canonicalJSON(routeLayout(read.layout).course)).toBe(canonicalJSON(routeLayout(layout).course));
    for (const start of [{ x: 1.5, y: 3, axis: 0 }, { x: 1, y: 3, axis: 0.25 }, { x: 1, y: 3 }, 'here']) {
      expect(parseLayout(JSON.parse(JSON.stringify({ ...layout, start })))).toBeNull();
    }
  });

  test('U-turn cones on the way from the start are laid out with element 1, in the sheet and the CSV', () => {
    // Facing away from the gate, 10 m off: the way to it turns round a cone.
    const layout = { ...single('open'), start: { x: 20, y: 28, axis: 4 } };
    const { course } = routeLayout(layout);
    const cones = course.passes.filter((p) => p.connector?.from === 'start');
    expect(cones.length).toBeGreaterThan(0);
    const sheet = buildSetupSheet(course);
    expect(sheet.cards[0].turnCones.map((t) => t.cone)).toEqual(cones.map((p) => p.cone));
    expect(sheet.cards[0].notes.some((n) => n.startsWith('Связка от старта к элементу 1'))).toBe(true);
    expect(conesCsv(course, sheet)).toContain('Связка старт → 1: конус разворота');
  });
});
