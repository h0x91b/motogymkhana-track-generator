// Safety margins (recipe.safety and an element's own in «Правка»): the free
// asphalt the generator keeps can be narrowed or switched off, the course
// keeps whatever is set, and the defaults are the field rules.

import { describe, expect, test } from 'bun:test';
import {
  canonicalJSON, generateCourse, parseRecipe, RUN_OFF_TYPES, SAFETY_DEFAULTS, SAFETY_OPTIONS, safetyValues,
} from '../src/generator/index.js';
import { elementSafety, layoutOf, moveElement, parseLayout, routeLayout, setElementSafety } from '../src/generator/layout.js';
import { reservedZones } from '../src/render/reserved.js';
import { courseDocument, courseFileText, readCourseFile } from '../src/file/course-file.js';
import { coneXY, conesById, insidePolygon } from './helpers/course-geometry.js';
import { seeds, slowTest, timeout } from './helpers/slow.js';

const ANTON = { width: 40, length: 38, elements: 6, difficulty: 'medium', bike: 'sport', shape: 'closed', train: true };
const course = (recipe, seed) => {
  const r = generateCourse(recipe, seed);
  if (!r.ok) throw new Error(`${JSON.stringify(recipe)} seed ${seed}: ${JSON.stringify(r.error)}`);
  return r.course;
};
const bare = ({ requested, placed, edited, limitedBy, ...c }) => c;
const span = (poly, k) => Math.max(...poly.map((p) => p[k])) - Math.min(...poly.map((p) => p[k]));
const placedMean = (recipe, seeds) => {
  let sum = 0;
  for (let s = 1; s <= seeds; s++) sum += course(recipe, s).placed;
  return sum / seeds;
};

describe('the recipe', () => {
  test('keeps only the values that differ from the defaults, so a recipe at defaults is unchanged', () => {
    expect(parseRecipe(ANTON).recipe.safety).toEqual({});
    expect(parseRecipe({ ...ANTON, safety: { ...SAFETY_DEFAULTS } }).recipe.safety).toEqual({});
    expect(parseRecipe({ ...ANTON, safety: { runOff: '2', pad: '0,5', edge: 0 } }).recipe.safety).toEqual({ runOff: 2, pad: 0.5, edge: 0 });
    expect(parseRecipe({ ...ANTON, safety: { runOff: '' } }).recipe.safety).toEqual({});
  });

  test('takes every value of every option and refuses the rest', () => {
    for (const o of SAFETY_OPTIONS) {
      for (const v of safetyValues(o)) expect(parseRecipe({ ...ANTON, safety: { [o.key]: v } }).ok).toBe(true);
      for (const bad of [o.max + o.step, -o.step, o.min + o.step / 2, 'x']) {
        const r = parseRecipe({ ...ANTON, safety: { [o.key]: bad } });
        expect(r.ok, `${o.key} = ${bad}`).toBe(false);
        expect(r.errors.safety).toContain(o.name);
      }
    }
    expect(parseRecipe({ ...ANTON, safety: { nope: 1 } }).ok).toBe(false);
  });

  test('a course at defaults is the same as one with every default spelled out', () => {
    for (const seed of seeds(3, [2])) {
      expect(canonicalJSON(course({ ...ANTON, safety: { ...SAFETY_DEFAULTS } }, seed))).toBe(canonicalJSON(course(ANTON, seed)));
    }
  }, timeout(30_000));
});

describe('the generated course keeps the values set', () => {
  const recipe = { width: 40, length: 50, elements: 6, difficulty: 'medium', bike: 'sport', shape: 'closed', train: false };

  test('run-off 2 m: every run-off side but a turnaround\'s entry lies 2 m out from the cones', () => {
    for (const seed of seeds(6, [2])) {
      const c = course({ ...recipe, safety: { runOff: 2 } }, seed);
      const byId = conesById(c);
      for (const e of c.elements.filter((el) => el.runOff)) {
        const xs = e.cones.map((id) => coneXY(byId.get(id)));
        // On the side axes the run-off box is at most 2 × 2 m wider than the cones and line.
        if (e.axis % 2 === 0) {
          const grown = [0, 1].map((k) => span(e.runOff, k) - span([...xs, ...e.path], k));
          expect(Math.max(...grown), `${e.type}`).toBeLessThanOrEqual(4 + 0.02);
        }
      }
    }
  }, timeout(30_000));

  test('run-off 0: no element has a run-off zone, and nothing is drawn for one', () => {
    for (const seed of seeds(6, [2])) {
      const c = course({ ...recipe, safety: { runOff: 0 } }, seed);
      expect(c.elements.some((e) => e.runOff)).toBe(false);
      expect(reservedZones(c).some((z) => z.kind === 'runOff')).toBe(false);
    }
  }, timeout(30_000));

  test('zone padding: the zone is the cones and line grown by exactly the value set', () => {
    for (const pad of [0, 0.5, 1.5]) {
      const c = course({ ...recipe, safety: { pad } }, 2);
      // An open single cone's line is only its two ends on the zone edge: nothing inside to grow.
      for (const e of c.elements.filter((el) => el.axis % 2 === 0 && el.path.length > 2)) {
        const byId = conesById(c);
        // The path's ends lie on the zone edge; its inside is the line ridden.
        const pts = [...e.cones.map((id) => coneXY(byId.get(id))), ...e.path.slice(1, -1)];
        for (const k of [0, 1]) expect(span(e.zone, k) - span(pts, k)).toBeCloseTo(2 * pad, 1);
      }
    }
  }, timeout(30_000));

  test('lot edge: every cone keeps the margin set, and the course says which', () => {
    for (const edge of [0, 3]) {
      for (const seed of seeds(4, [2])) {
        const c = course({ ...recipe, safety: { edge } }, seed);
        expect(c.site.margin).toBe(edge);
        for (const cone of c.cones) {
          const [x, y] = coneXY(cone);
          expect(x >= edge - 1e-9 && y >= edge - 1e-9 && x <= c.site.width - edge + 1e-9 && y <= c.site.length - edge + 1e-9).toBe(true);
        }
      }
    }
  }, timeout(30_000));

  test('U-turn cone keep-out: the square drawn is the one kept, and none at 0', () => {
    let seen = 0;
    for (const seed of seeds(8, [2])) {
      for (const coneGap of [0, 2.5]) {
        const c = course({ ...recipe, safety: { coneGap } }, seed);
        const squares = reservedZones(c).filter((z) => z.kind === 'turnCone');
        if (coneGap === 0) expect(squares).toEqual([]);
        for (const z of squares) {
          seen++;
          expect(span(z.poly, 0)).toBeCloseTo(2 * coneGap, 6);
          // No other route leg runs through it.
          for (const leg of c.route.legs.filter((l) => l.path && !(l.cones ?? []).includes(z.cone))) {
            for (const p of leg.path) expect(insidePolygon(z.poly, p, -0.05)).toBe(false);
          }
        }
      }
    }
    expect(seen).toBeGreaterThan(0);
  }, timeout(30_000));

  // Means over 15 seeds: statistics, run in the slow suite only.
  slowTest('«паровозик» clearance: a wider one never places more, 0 switches the check off', () => {
    const wide = placedMean({ ...ANTON, safety: { trainGap: 3 } }, 15);
    const normal = placedMean(ANTON, 15);
    const off = placedMean({ ...ANTON, safety: { trainGap: 0 } }, 15);
    expect(wide).toBeLessThanOrEqual(normal + 0.2);
    expect(off).toBeGreaterThanOrEqual(normal - 0.2);
  }, timeout(120_000));

  slowTest('a tight lot packs more with the margins narrowed', () => {
    const tight = { ...ANTON, train: false };
    expect(placedMean({ ...tight, safety: { runOff: 0, pad: 0.25 } }, 15)).toBeGreaterThan(placedMean(tight, 15));
  }, timeout(120_000));
});

describe('in «Правка»', () => {
  const recipe = { width: 40, length: 60, elements: 6, difficulty: 'medium', bike: 'sport', shape: 'closed', train: true, safety: { runOff: 3, coneGap: 1, trainGap: 2.5, edge: 2 } };

  /** A course of the recipe with a turning element in it, and that element's index. */
  const withTurn = (r) => {
    // From seed 4: the seeds before it take longer to lay out.
    for (let seed = 4; ; seed++) {
      const c = course(r, seed);
      const i = c.elements.findIndex((e) => RUN_OFF_TYPES[e.type]);
      if (i >= 0) return { c, i };
    }
  };

  test('a layout taken from a course with safety set routes back to the same course', () => {
    for (const seed of seeds(4, [4])) {
      const c = course(recipe, seed);
      const { course: again, problems } = routeLayout(layoutOf(c));
      expect(problems).toEqual([]);
      expect(canonicalJSON(bare(again))).toBe(canonicalJSON(bare(c)));
    }
  }, timeout(30_000));

  test('an element sets its own run-off and padding over the recipe\'s; null gives the recipe\'s back', () => {
    const { c, i } = withTurn(recipe);
    const layout = layoutOf(c);
    expect(elementSafety(layout, i).map((s) => [s.key, s.value, s.own])).toEqual([['runOff', 3], ['pad', 0.75]].map(([k, v]) => [k, v, false]));

    const own = setElementSafety(setElementSafety(layout, i, 'runOff', 0), i, 'pad', 0.25);
    expect(own.elements[i].safety).toEqual({ runOff: 0, pad: 0.25 });
    expect(elementSafety(own, i).map((s) => [s.key, s.value, s.own])).toEqual([['runOff', 0, true], ['pad', 0.25, true]]);
    const routed = routeLayout(own).course;
    expect(routed.elements[i].runOff).toBeUndefined();
    expect(routed.elements[i].safety).toEqual({ runOff: 0, pad: 0.25 });
    expect(span(routed.elements[i].zone, 0)).toBeLessThan(span(c.elements[i].zone, 0));
    // The others keep the recipe's.
    for (const [k, e] of routed.elements.entries()) if (k !== i) expect(e.safety).toBeUndefined();

    // Read back from the course and from storage without loss.
    expect(layoutOf(routed).elements[i].safety).toEqual({ runOff: 0, pad: 0.25 });
    expect(parseLayout(JSON.parse(JSON.stringify(own)))).toEqual(own);

    const back = setElementSafety(setElementSafety(own, i, 'runOff', null), i, 'pad', null);
    expect(back.elements[i].safety).toBeUndefined();
    expect(canonicalJSON(bare(routeLayout(back).course))).toBe(canonicalJSON(bare(c)));
  }, timeout(30_000));

  test('a course file keeps the recipe\'s margins and an element\'s own', () => {
    const { c, i } = withTurn(recipe);
    const own = setElementSafety(layoutOf(c), i, 'runOff', 1);
    const read = readCourseFile(courseFileText(courseDocument(own, { edited: true })));
    expect(read.ok).toBe(true);
    expect(read.recipe.safety).toEqual(recipe.safety);
    expect(read.layout).toEqual(own);
    expect(canonicalJSON(bare(routeLayout(read.layout).course))).toBe(canonicalJSON(bare(routeLayout(own).course)));
  }, timeout(30_000));

  test('a type without a turn has no run-off to set', () => {
    const c = course(recipe, 4);
    const i = c.elements.findIndex((e) => !RUN_OFF_TYPES[e.type]);
    if (i < 0) return;
    expect(elementSafety(layoutOf(c), i).map((s) => s.key)).toEqual(['pad']);
  });

  test('a broken own margin in storage is refused', () => {
    const layout = layoutOf(course(recipe, 4));
    const broken = (safety) => parseLayout({ ...layout, elements: layout.elements.map((e, k) => (k === 0 ? { ...e, safety } : e)) });
    expect(broken({ runOff: 7 })).toBeNull();
    expect(broken({ pad: '1' })).toBeNull();
    expect(broken({ edge: 1 })).toBeNull();
    expect(broken(null)).toBeNull();
  });

  test('problems quote the margin that is broken, not the field rule', () => {
    const { c, i } = withTurn({ ...recipe, safety: { runOff: 3 } });
    const layout = layoutOf(c);
    const other = i === 0 ? 1 : 0;
    // Walk another element towards i until it stands in i's run-off but not on i.
    const centre = (poly) => [0, 1].map((k) => poly.reduce((sum, p) => sum + p[k], 0) / poly.length);
    const [cx, cy] = centre(c.elements[i].zone);
    let texts = [];
    for (let d = 30; d >= 0 && !texts.length; d--) {
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const el = layout.elements[other];
        const [ox, oy] = centre(c.elements[other].zone);
        const moved = moveElement(layout, other, el.x + Math.round(cx + dx * d - ox), el.y + Math.round(cy + dy * d - oy));
        texts = routeLayout(moved).problems.filter((p) => p.code === 'in-run-off').map((p) => p.text);
        if (texts.length) break;
      }
    }
    expect(texts.length).toBeGreaterThan(0);
    for (const t of texts) expect(t).toContain('3\u00a0м');
  }, timeout(30_000));
});
