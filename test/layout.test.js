// The editor's seam: a layout, the course `routeLayout` builds from it, and the
// edits. Checked on what comes out — the course and its problems — never on how
// the router got there.

import { describe, expect, test } from 'bun:test';
import { canonicalJSON, ELEMENT_TYPES, generateCourse } from '../src/generator/index.js';
import { SIZE_OPTIONS, SIZE_SPECS, sizeControls, sizeValues, typeAxes, typicalSizes } from '../src/generator/catalog.js';
import {
  ELEMENTS_MAX, elementControls, insertElement, layoutOf, mirrorElement, moveElement, parseLayout, removeElement, replaceElement, resizeElement,
  nearestAxis, rotateElement, routeLayout, shiftElement, turnElementTo,
} from '../src/generator/layout.js';
import { buildSetupSheet } from '../src/sheet/setup-sheet.js';
import { sweep } from './helpers/slow.js';
import { coneXY, conesById, distanceToPath, insidePolygon } from './helpers/course-geometry.js';

const RECIPES = [
  { width: 40, length: 60, elements: 8, difficulty: 'medium', shape: 'closed' },
  { width: 40, length: 60, elements: 6, difficulty: 'easy', shape: 'open' },
  { width: 30, length: 45, elements: 10, difficulty: 'hard', shape: 'closed' },
  { width: 40, length: 60, elements: 8, difficulty: 'hard', bike: 'sport', shape: 'closed' },
  { width: 60, length: 80, elements: 15, difficulty: 'hard', shape: 'open' },
  { width: 40, length: 60, elements: 8, difficulty: 'medium', shape: 'closed', train: true },
  { width: 60, length: 80, elements: 12, difficulty: 'hard', shape: 'open', train: true },
  { width: 40, length: 60, elements: 8, difficulty: 'medium', shape: 'return' },
  { width: 40, length: 60, elements: 6, difficulty: 'hard', shape: 'return', train: true },
];
const SEEDS = sweep(8, 2);

const generated = RECIPES.flatMap((recipe) => {
  const out = [];
  // The default run takes two seeds of the first recipe (tests edit generated[1]) and one of each other.
  const n = recipe === RECIPES[0] ? SEEDS : sweep(SEEDS, 1);
  for (let seed = 0; seed < n; seed++) {
    const result = generateCourse(recipe, seed);
    if (!result.ok) throw new Error(`${JSON.stringify(recipe)} seed ${seed}: ${JSON.stringify(result.error)}`);
    out.push(result.course);
  }
  return out;
});

/** A course without the bookkeeping that differs between a generated and an edited one. */
const bare = ({ requested, placed, edited, limitedBy, ...course }) => course;

/** A roomy empty site with one element in the middle, to edit from. */
function single(type, { bike = 'cruiser', shape = 'open', train = false, width = 100, length = 100, axis = 0 } = {}) {
  const recipe = generateCourse({ width, length, elements: 1, difficulty: 'medium', bike, shape, train }, 0).course.recipe;
  return { recipe, seed: 0, elements: [{ type, sizes: typicalSizes(type, 'medium', bike), axis, mirrored: false, x: width / 2, y: length / 2 }] };
}

const zoneCentre = (e) => [(e.zone[0][0] + e.zone[2][0]) / 2, (e.zone[0][1] + e.zone[2][1]) / 2];
const codes = (problems) => problems.map((p) => p.code);

describe('a layout taken from a generated course', () => {
  test('routes back to the same course, with no problems', () => {
    for (const course of generated) {
      const { course: again, problems } = routeLayout(layoutOf(course));
      expect(problems, `seed ${course.seed}`).toEqual([]);
      expect(canonicalJSON(bare(again)), `seed ${course.seed} ${course.site.width}×${course.site.length}`).toBe(canonicalJSON(bare(course)));
      expect(again.edited).toBe(true);
      expect([again.requested, again.placed]).toEqual([course.elements.length, course.elements.length]);
    }
  });

  test('survives storage: parsed back from JSON it is the same layout', () => {
    for (const course of generated.slice(0, 10)) {
      const layout = layoutOf(course);
      expect(parseLayout(JSON.parse(JSON.stringify(layout)))).toEqual(layout);
    }
  });

  test('is refused when it is not a layout this build can route', () => {
    const layout = layoutOf(generated[0]);
    const broken = (change) => {
      const copy = JSON.parse(JSON.stringify(layout));
      change(copy);
      return parseLayout(copy);
    };
    expect(parseLayout(null)).toBeNull();
    expect(parseLayout({})).toBeNull();
    expect(broken((l) => (l.elements = []))).toBeNull();
    expect(broken((l) => (l.elements[0].type = 'loop-the-loop'))).toBeNull();
    expect(broken((l) => (l.elements[0].axis = 9))).toBeNull();
    expect(broken((l) => (l.elements[0].x = 3.5))).toBeNull();
    expect(broken((l) => delete l.elements[0].sizes[SIZE_SPECS[l.elements[0].type][0].key])).toBeNull();
    expect(broken((l) => (l.recipe.width = 5))).toBeNull();
    expect(broken((l) => (l.elements = Array.from({ length: ELEMENTS_MAX + 1 }, () => l.elements[0])))).toBeNull();
  });
});

describe('sizes set by hand', () => {
  /** The sizes with one control stepped as far as it goes. */
  const toEnd = (type, sizes, diagonal, bike, key, dir) => {
    for (;;) {
      const control = sizeControls(type, sizes, diagonal, bike).find((c) => c.key === key);
      const next = dir < 0 ? control.less : control.more;
      if (!next) return sizes;
      sizes = next;
    }
  };

  // The tightest offset slalom a recipe can fix — a 3 m step with the rows 5 m
  // apart — passes its cones 0.496 m away, so that is the floor here too.
  test('every type is rideable at every corner of its ranges: the line keeps half a metre from its cones, no two cones on one spot', () => {
    let seen = 0;
    for (const bike of ['sport', 'cruiser']) {
      for (const type of ELEMENT_TYPES) {
        const keys = SIZE_SPECS[type].map((s) => s.key);
        for (const axis of typeAxes(type).slice(0, 2)) {
          for (let corner = 0; corner < 1 << keys.length; corner++) {
            let sizes = typicalSizes(type, 'medium', bike);
            keys.forEach((key, i) => (sizes = toEnd(type, sizes, axis % 2 === 1, bike, key, corner & (1 << i) ? 1 : -1)));
            for (const mirrored of [false, true]) {
              const layout = single(type, { bike, axis });
              layout.elements[0] = { ...layout.elements[0], sizes, mirrored };
              const { course } = routeLayout(layout);
              const [e] = course.elements;
              const byId = conesById(course);
              const spots = e.cones.map((id) => coneXY(byId.get(id)));
              const where = `${type} ${bike} axis ${axis} ${JSON.stringify(e.params)}`;
              expect(new Set(spots.map(String)).size, where).toBe(spots.length);
              expect(e.path.flat().every(Number.isFinite), where).toBe(true);
              for (const spot of spots) expect(distanceToPath(e.path, spot), where).toBeGreaterThan(0.49);
              seen++;
            }
          }
        }
      }
    }
    expect(seen).toBeGreaterThan(400);
  });

  test('a step up and back down is the same element, and the steps end at both ends of the range', () => {
    for (const type of ELEMENT_TYPES) {
      for (const diagonal of typeAxes(type).includes(1) ? [false, true] : [false]) {
        const start = typicalSizes(type, 'hard', 'cruiser');
        for (const { key } of SIZE_SPECS[type]) {
          const low = toEnd(type, start, diagonal, 'cruiser', key, -1);
          const value = (sizes) => sizeControls(type, sizes, diagonal, 'cruiser').find((c) => c.key === key);
          expect(value(low).less).toBeNull();
          const up = value(low).more;
          if (!up) continue; // a single value in this range
          expect(value(up).less && value(value(up).less).value, `${type} ${key}`).toBe(value(low).value);
          expect(value(toEnd(type, start, diagonal, 'cruiser', key, 1)).more).toBeNull();
        }
      }
    }
  });

  test('the U-turns inside elements never go under the bike class: a cruiser box is at least 11 m, a sport one 9.5 m', () => {
    const narrowest = (type, key, bike) => sizeControls(type, toEnd(type, typicalSizes(type, 'easy', bike), false, bike, key, -1), false, bike).find((c) => c.key === key).value;
    expect(narrowest('box', 'size', 'cruiser')).toBe(11);
    expect(narrowest('box', 'size', 'sport')).toBe(9.5);
    expect(narrowest('u-turn', 'width', 'cruiser')).toBe(11);
    expect(narrowest('pivot-turn', 'radius', 'cruiser')).toBe(5);
    expect(narrowest('pivot-turn', 'radius', 'sport')).toBe(4.25);
    expect(narrowest('figure-eight', 'distance', 'cruiser')).toBe(13); // 2√2 × 4.5 m, on the grid
  });

  test('a mirror line grows with the radius of its turn', () => {
    const layout = single('mirror');
    const radius = () => elementControls(layout, 0).find((c) => c.key === 'radius');
    const line = (l) => elementControls(l, 0).find((c) => c.key === 'line').value;
    const before = line(layout);
    let wider = layout;
    while (elementControls(wider, 0).find((c) => c.key === 'radius').more) wider = resizeElement(wider, 0, elementControls(wider, 0).find((c) => c.key === 'radius').more);
    expect(radius().value).toBeLessThan(elementControls(wider, 0).find((c) => c.key === 'radius').value);
    expect(line(wider)).toBeGreaterThan(before);
    expect(routeLayout(wider).problems).toEqual([]);
  });

  test('resizing changes the element on the course and keeps its anchor', () => {
    const layout = single('straight-slalom');
    const controls = elementControls(layout, 0);
    const more = resizeElement(layout, 0, controls.find((c) => c.key === 'count').more);
    const before = routeLayout(layout).course;
    const after = routeLayout(more).course;
    expect(after.elements[0].cones.length).toBe(before.elements[0].cones.length + 1);
    const anchor = (c) => coneXY(conesById(c).get(c.elements[0].anchor));
    expect(anchor(after)).toEqual(anchor(before));
  });
});

describe('editing a layout', () => {
  const base = layoutOf(generated[0]); // 40×60 medium closed
  const routed = (layout) => routeLayout(layout).course;

  test('moving an element puts its anchor where asked, on whole metres', () => {
    const layout = single('gate');
    const moved = moveElement(layout, 0, 30.4, 61.6);
    expect([moved.elements[0].x, moved.elements[0].y]).toEqual([30, 62]);
    const course = routed(moved);
    expect(coneXY(conesById(course).get(course.elements[0].anchor))).toEqual([30, 62]);
  });

  test('an element dragged past the edge stops inside the margin, a turning one with its run-off zone on the site', () => {
    for (const type of ['straight-slalom', 'figure-eight', 'u-turn']) {
      for (const [x, y] of [[-50, -50], [500, 500], [-50, 500]]) {
        const { course, problems } = routeLayout(moveElement(single(type, { width: 60, length: 60 }), 0, x, y));
        expect(codes(problems).filter((c) => c === 'off-site' || c === 'run-off-site'), `${type} ${x},${y}`).toEqual([]);
        for (const c of course.cones.filter((k) => course.elements[0].cones.includes(k.id))) {
          const [cx, cy] = coneXY(c);
          expect(cx >= 1 && cx <= 59 && cy >= 1 && cy <= 59, `${type} cone at ${cx},${cy}`).toBe(true);
        }
      }
    }
  });

  test('turning goes round all eight axes and back, about the middle of the element', () => {
    let layout = single('offset-slalom');
    const centre = zoneCentre(routed(layout).elements[0]);
    const axes = [];
    for (let k = 0; k < 8; k++) {
      layout = rotateElement(layout, 0, 1);
      const [e] = routed(layout).elements;
      axes.push(e.axis);
      const c = zoneCentre(e);
      expect(Math.hypot(c[0] - centre[0], c[1] - centre[1])).toBeLessThanOrEqual(0.75);
    }
    expect(axes).toEqual([1, 2, 3, 4, 5, 6, 7, 0]);
    // A full turn ends exactly where it began.
    expect(bare(routed(layout))).toEqual(bare(routed(single('offset-slalom'))));
    expect(rotateElement(layout, 0, -1).elements[0].axis).toBe(7);
  });

  test('a type that stands only along the site sides turns by 90°', () => {
    let layout = single('snail');
    const axes = [];
    for (let k = 0; k < 4; k++) {
      layout = rotateElement(layout, 0, 1);
      axes.push(layout.elements[0].axis);
    }
    expect(axes).toEqual([2, 4, 6, 0]);
  });

  test('a typed angle snaps to the nearest axis the type stands on', () => {
    expect([0, 20, 30, 44, 90, 179, 315, 359, 360, 405, -45, -90].map((d) => nearestAxis('offset-slalom', d))).toEqual([0, 0, 1, 1, 2, 4, 7, 0, 0, 1, 7, 6]);
    expect([30, 46, 134, 136, 271, -45.5].map((d) => nearestAxis('snail', d))).toEqual([0, 2, 2, 4, 6, 6]);
    // Halfway between two axes: the one nearer the current axis, then counter-clockwise.
    expect(nearestAxis('offset-slalom', 22.5, 0)).toBe(0);
    expect(nearestAxis('offset-slalom', 22.5, 1)).toBe(1);
    expect(nearestAxis('snail', 45, 0)).toBe(0);
    expect(nearestAxis('snail', 45, 2)).toBe(2);
    expect(nearestAxis('snail', 45, 5)).toBe(2);
    expect(nearestAxis('offset-slalom', Number.NaN)).toBeNull();
  });

  test('turning to an angle is the same edit as turning step by step', () => {
    for (const type of ['offset-slalom', 'snail']) {
      let stepped = single(type);
      const step = typeAxes(type)[1] * 45;
      for (let k = 1; k <= typeAxes(type).length; k++) {
        stepped = rotateElement(stepped, 0, 1);
        const typed = turnElementTo(single(type), 0, (k * step) % 360);
        // Both turn about the middle of the zone the element started from.
        expect(bare(routed(typed)), `${type} ${k * step}°`).toEqual(bare(routed(stepped)));
        expect(typed.elements[0].axis).toBe(stepped.elements[0].axis);
      }
    }
    const layout = single('offset-slalom');
    expect(turnElementTo(layout, 0, 10)).toBe(layout);
    expect(turnElementTo(layout, 0, Number.NaN)).toBe(layout);
  });

  test('a turn onto a diagonal and back keeps the sizes', () => {
    for (const type of ELEMENT_TYPES.filter((t) => typeAxes(t).includes(1))) {
      const layout = single(type);
      const back = rotateElement(rotateElement(layout, 0, 1), 0, -1);
      expect(routed(back).elements[0].params, type).toEqual(routed(layout).elements[0].params);
    }
  });

  test('mirroring swaps the colours of the cones and stays in place', () => {
    const layout = single('straight-slalom');
    const sides = (course) => course.passes.filter((p) => p.element === 'e1').map((p) => p.side);
    const before = routed(layout);
    const after = routed(mirrorElement(layout, 0));
    expect(sides(after)).toEqual(sides(before).map((s) => (s === 'left' ? 'right' : 'left')));
    const [a, b] = [zoneCentre(before.elements[0]), zoneCentre(after.elements[0])];
    expect(Math.hypot(a[0] - b[0], a[1] - b[1])).toBeLessThanOrEqual(0.75);
    expect(bare(routed(mirrorElement(mirrorElement(layout, 0), 0)))).toEqual(bare(before));
  });

  test('replacing puts any type in the same place, entered the same way', () => {
    const was = routed(base).elements[2];
    for (const type of ELEMENT_TYPES) {
      const course = routed(replaceElement(base, 2, type));
      const now = course.elements[2];
      expect(now.type).toBe(type);
      expect(course.elements.map((e) => e.type).filter((_, i) => i !== 2)).toEqual(routed(base).elements.map((e) => e.type).filter((_, i) => i !== 2));
      // Entered along the old direction, or the nearest one a side-only type can take.
      const off = Math.min((now.entry.dir - was.entry.dir + 8) % 8, (was.entry.dir - now.entry.dir + 8) % 8);
      expect(off, type).toBeLessThanOrEqual(typeAxes(type).length === 8 ? 0 : 1);
    }
  });

  test('a type used from medium can be put on an easy course', () => {
    const easy = layoutOf(generated.find((c) => c.recipe.difficulty === 'easy' && c.route.shape === 'open')); // the easy open recipe
    for (const type of ['snail', 'box-eight', 'keyhole']) expect(routed(replaceElement(easy, 0, type)).elements[0].type).toBe(type);
  });

  test('removing drops the element and renumbers the rest; the last one stays', () => {
    const types = base.elements.map((e) => e.type);
    const course = routed(removeElement(base, 1));
    expect(course.elements.map((e) => e.type)).toEqual(types.filter((_, i) => i !== 1));
    expect(course.elements.map((e) => e.order)).toEqual(course.elements.map((_, i) => i + 1));
    const one = single('gate');
    expect(removeElement(one, 0)).toBe(one);
  });

  test('moving an element earlier or later swaps it with its neighbour in the route', () => {
    const types = base.elements.map((e) => e.type);
    const later = routed(shiftElement(base, 0, 1)).elements.map((e) => e.type);
    expect(later.slice(0, 2)).toEqual([types[1], types[0]]);
    expect(shiftElement(shiftElement(base, 3, -1), 2, 1)).toEqual(base);
    expect(shiftElement(base, 0, -1)).toBe(base);
    expect(shiftElement(base, types.length - 1, 1)).toBe(base);
  });

  test('a new element goes where it is free: on a roomy site every type lands without a problem', () => {
    for (const type of ELEMENT_TYPES) {
      const layout = insertElement(single('straight-slalom'), 1, type);
      const { course, problems } = routeLayout(layout);
      expect(course.elements.map((e) => e.type)).toEqual(['straight-slalom', type]);
      expect(problems.map((p) => p.text), type).toEqual([]);
    }
  });

  test('a new element can go first or between two others, and a full course takes no more', () => {
    const first = routed(insertElement(base, 0, 'gate'));
    expect(first.elements[0].type).toBe('gate');
    expect(first.elements.length).toBe(base.elements.length + 1);
    const between = routed(insertElement(base, 3, 'gate'));
    expect(between.elements[3].type).toBe('gate');
    let full = single('gate');
    while (full.elements.length < ELEMENTS_MAX) full = insertElement(full, full.elements.length, 'gate');
    expect(insertElement(full, 0, 'gate')).toBe(full);
  });

  test('edits never touch the layout they start from', () => {
    const frozen = JSON.stringify(base);
    moveElement(base, 0, 3, 3);
    rotateElement(base, 0, 1);
    mirrorElement(base, 0);
    replaceElement(base, 0, 'gate');
    removeElement(base, 0);
    shiftElement(base, 0, 1);
    insertElement(base, 1, 'gate');
    resizeElement(base, 0, base.elements[0].sizes);
    expect(JSON.stringify(base)).toBe(frozen);
  });
});

describe('sizes as the editor prints them', () => {
  test('read as the setup sheet measures them', () => {
    const slalom = single('offset-slalom');
    const rows = elementControls(slalom, 0).find((c) => c.key === 'shift');
    expect(rows.name).toBe('Между рядами');
    expect(rows.value).toBe(2 * slalom.elements[0].sizes.shift);
    const sheet = buildSetupSheet(routeLayout(slalom).course);
    expect(sheet.cards[0].notes.join(' ')).toContain(`между рядами ${String(rows.value).replace('.', ',')} м`);
  });

  test('on a diagonal a length is what a tape shows between the cones', () => {
    const gate = rotateElement(single('gate'), 0, 1);
    const width = elementControls(gate, 0)[0];
    const { course } = routeLayout(gate);
    const [a, b] = course.elements[0].cones.map((id) => course.cones.find((c) => c.id === id));
    expect(width.value).toBeCloseTo(Math.hypot(a.hx - b.hx, a.hy - b.hy) / 2, 9);
    expect(width.diagonal).toBe(true);
  });
});

describe('a recipe that fixes sizes', () => {
  const fixing = (type, sizes, extra = {}) => {
    const result = generateCourse({ width: 60, length: 80, elements: 4, types: [type], difficulty: 'medium', shape: 'open', sizes: { [type]: sizes }, ...extra }, 1);
    return result.ok ? result.course : null;
  };

  test('routes back to the same course at both ends of every size', () => {
    let checked = 0;
    for (const [type, options] of Object.entries(SIZE_OPTIONS)) {
      for (const option of options) {
        const values = sizeValues(option);
        for (const value of [values[0], values[values.length - 1]]) {
          for (const bike of ['cruiser', 'sport']) {
            const course = fixing(type, { [option.key]: value }, { bike });
            if (!course) continue;
            const layout = layoutOf(course);
            expect(parseLayout(JSON.parse(JSON.stringify(layout)))).toEqual(layout);
            const { course: again, problems } = routeLayout(layout);
            expect(problems, `${type} ${option.key} ${value} ${bike}`).toEqual([]);
            expect(canonicalJSON(bare(again)), `${type} ${option.key} ${value} ${bike}`).toBe(canonicalJSON(bare(course)));
            checked++;
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(40);
  });

  test('gives a new element of that type the fixed size', () => {
    const layout = layoutOf(fixing('gate', {}, { sizes: { 'straight-slalom': { step: 4.5 } }, types: ['gate', 'straight-slalom'] }));
    expect(insertElement(layout, 0, 'straight-slalom').elements[1].sizes.step).toBe(4.5);
    expect(replaceElement(layout, 0, 'straight-slalom').elements[0].sizes.step).toBe(4.5);
  });

  test('is quoted on the setup sheet only for the elements that still have that size', () => {
    const layout = layoutOf(fixing('straight-slalom', { step: 4.5 }));
    const quoted = (l) => buildSetupSheet(routeLayout(l).course).cards.map((c) => c.notes.some((n) => n.startsWith('Задано в рецепте')));
    expect(quoted(layout)).toEqual(layout.elements.map(() => true));
    const step = elementControls(layout, 1).find((c) => c.key === 'step');
    expect(quoted(resizeElement(layout, 1, step.more))).toEqual(layout.elements.map((_, i) => i !== 1));
  });
});

describe('problems of a layout', () => {
  /** Two gates on a 60 × 60 site, the second where the test puts it. */
  const pair = (second, opts = {}) => {
    const layout = single('gate', { width: 60, length: 60, ...opts });
    layout.elements[0] = { ...layout.elements[0], x: 15, y: 30 };
    layout.elements.push({ ...layout.elements[0], ...second });
    return layout;
  };

  test('a clean layout has none', () => {
    expect(routeLayout(pair({ x: 35, y: 30 })).problems).toEqual([]);
  });

  test('two elements on one spot overlap, and the problem names both', () => {
    const { course, problems } = routeLayout(pair({ x: 15, y: 31 }));
    const overlap = problems.find((p) => p.code === 'overlap');
    expect(overlap.elements).toEqual(['e1', 'e2']);
    expect(overlap.text).toContain('Элементы 1 и 2');
    expect(course.elements.length).toBe(2); // the course is built all the same
  });

  test('an element off the site is reported, and still drawn where it was put', () => {
    const layout = pair({ x: 35, y: 30 });
    layout.elements[1] = { ...layout.elements[1], x: 59, y: 30 };
    const { course, problems } = routeLayout(layout);
    expect(problems.find((p) => p.code === 'off-site').elements).toEqual(['e2']);
    expect(coneXY(conesById(course).get(course.elements[1].anchor))).toEqual([59, 30]);
  });

  test('an element inside the run-off zone of a turning one is reported', () => {
    const layout = single('u-turn', { width: 60, length: 60 });
    const [turn] = routeLayout(layout).course.elements;
    // A gate beside the U-turn: clear of its zone, inside its 5 m of free asphalt.
    const gate = { type: 'gate', sizes: typicalSizes('gate', 'medium', 'cruiser'), axis: 0, mirrored: false, x: 30, y: 0 };
    const beside = Math.ceil(Math.max(...turn.zone.map((p) => p[1])) + 3);
    const { problems } = routeLayout({ ...layout, elements: [...layout.elements, { ...gate, y: beside }] });
    expect(codes(problems)).not.toContain('overlap');
    const runOff = problems.find((p) => p.code === 'in-run-off');
    expect(runOff.elements).toEqual(['e1', 'e2']);
    expect(runOff.text).toContain('Элемент 2 стоит в зоне выката элемента 1');
    // Far enough away it is fine.
    expect(codes(routeLayout({ ...layout, elements: [...layout.elements, { ...gate, y: beside + 6 }] }).problems)).not.toContain('in-run-off');
  });

  test('a connector with no clear way is still drawn, and says what is in its way', () => {
    // The second gate sits right behind the first and faces back at it.
    const { course, problems } = routeLayout(pair({ x: 21, y: 30, axis: 4 }));
    const connectors = course.route.legs.filter((l) => l.kind === 'connector');
    expect(connectors.length).toBe(3);
    expect(connectors[1].path.length).toBeGreaterThan(1);
    const problem = problems.find((p) => p.connector === 1);
    expect(problem.code).toMatch(/^connector-/);
    expect(problem.text).toContain('Связка 1 → 2');
    expect(problem.elements).toEqual(['e1', 'e2']);
  });

  test('every problem says what to do about it', () => {
    for (const second of [{ x: 15, y: 31 }, { x: 21, y: 30, axis: 4 }, { x: 59, y: 30 }]) {
      const layout = pair({ x: 35, y: 30 });
      layout.elements[1] = { ...layout.elements[1], ...second };
      const { problems } = routeLayout(layout);
      expect(problems.length).toBeGreaterThan(0);
      for (const p of problems) expect(p.text, p.code).toMatch(/ — (раздвиньте|отодвиньте|освободите|переставьте)/);
    }
  });

  test('a closed course always comes back to its start line', () => {
    for (const second of [{ x: 35, y: 30 }, { x: 21, y: 30, axis: 4 }, { x: 15, y: 31 }]) {
      const { course } = routeLayout(pair(second, { shape: 'closed' }));
      const last = course.route.legs.at(-1);
      expect(last.kind).toBe('connector');
      expect(last.to).toBe('finish');
      const end = last.path.at(-1);
      expect(Math.hypot(end[0] - course.route.start.x, end[1] - course.route.start.y)).toBeLessThan(0.02);
      expect(course.route.finish).toEqual(course.route.start);
    }
  });

  test('a finish by the start stays by the start while there is room, and says so when there is none', () => {
    const near = routeLayout(pair({ x: 35, y: 30 }, { shape: 'return' }));
    expect(near.problems).toEqual([]);
    const { start, finish } = near.course.route;
    expect(Math.hypot(finish.x - start.x, finish.y - start.y)).toBeLessThanOrEqual(8);
    // A strip just wide enough for the gates leaves no room for a second line beside the start.
    const tight = pair({ x: 35, y: 6 }, { shape: 'return' });
    tight.recipe = { ...tight.recipe, length: 12 };
    tight.elements[0] = { ...tight.elements[0], x: 10, y: 6 };
    const away = routeLayout(tight);
    expect(codes(away.problems)).toContain('finish-away');
    expect(away.course.route.legs.at(-1).path.length).toBeGreaterThan(1);
  });

  test('in «паровозик» an element that rides over itself is reported', () => {
    const layout = pair({ x: 40, y: 30 }, { train: true });
    expect(routeLayout(layout).problems).toEqual([]);
    const { problems } = routeLayout(replaceElement(layout, 1, 'figure-eight'));
    expect(codes(problems)).toContain('train');
    expect(problems.find((p) => p.code === 'train').elements).toEqual(['e2']);
  });

  test('every problem points at an element or a connector of the course', () => {
    const layouts = [pair({ x: 15, y: 31 }), pair({ x: 21, y: 30, axis: 4 }), pair({ x: 21, y: 30, axis: 4 }, { shape: 'closed' })];
    for (const layout of layouts) {
      const { course, problems } = routeLayout(layout);
      const ids = new Set(course.elements.map((e) => e.id));
      const connectors = course.route.legs.filter((l) => l.kind === 'connector').length;
      expect(problems.length).toBeGreaterThan(0);
      for (const p of problems) {
        expect(p.elements.length + (p.connector === null ? 0 : 1)).toBeGreaterThan(0);
        for (const e of p.elements) expect(ids.has(e)).toBe(true);
        if (p.connector !== null) expect(p.connector).toBeLessThan(connectors);
      }
    }
  });
});

describe('the setup sheet of an edited course', () => {
  test('lists every cone once and puts each element where the layout has it', () => {
    let layout = layoutOf(generated[0]);
    layout = replaceElement(layout, 1, 'snail');
    layout = insertElement(layout, 2, 'zigzag');
    layout = rotateElement(layout, 0, 1);
    const { course } = routeLayout(layout);
    const sheet = buildSetupSheet(course);
    expect(sheet.cards.map((c) => c.type)).toEqual(course.elements.map((e) => e.type));
    expect(sheet.coneList.tallBlue + sheet.coneList.tallRed + sheet.coneList.low).toBe(course.cones.length);
    sheet.cards.forEach((card, i) => expect([card.anchor.x, card.anchor.y]).toEqual([layout.elements[i].x, layout.elements[i].y]));
  });

  test('cones of an edited course stay on the 0.5 m grid, anchors on whole metres, elements inside their zones', () => {
    let layout = layoutOf(generated[1]);
    for (let i = 0; i < layout.elements.length; i++) layout = rotateElement(mirrorElement(layout, i), i, 1);
    const { course } = routeLayout(layout);
    const byId = conesById(course);
    for (const c of course.cones) expect(Number.isInteger(c.hx) && Number.isInteger(c.hy)).toBe(true);
    for (const e of course.elements) {
      const anchor = byId.get(e.anchor);
      expect(anchor.hx % 2 === 0 && anchor.hy % 2 === 0, e.type).toBe(true);
      for (const id of e.cones) expect(insidePolygon(e.zone, coneXY(byId.get(id)), 0.5), `${e.type} ${id}`).toBe(true);
    }
  });
});
