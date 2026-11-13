// A recipe changed under an edited course (`applyRecipe`): the elements stay
// where they are, the course is routed on the new lot, and what no longer fits
// is a problem, as in «Правка». Checked on the routed course and its problems.

import { describe, expect, test } from 'bun:test';
import { generateCourse, parseRecipe } from '../src/generator/index.js';
import { applyRecipe, layoutOf, moveElement, routeLayout } from '../src/generator/layout.js';

const RECIPE = { width: 40, length: 60, elements: 8, difficulty: 'medium', shape: 'closed' };
const recipeOf = (raw) => {
  const r = parseRecipe(raw);
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return r.recipe;
};

/** A generated course with one element moved by a metre: an edited layout. */
function edited(raw = RECIPE, seed = 3) {
  const result = generateCourse(raw, seed);
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  const layout = layoutOf(result.course);
  const el = layout.elements[0];
  return moveElement(layout, 0, el.x + 1, el.y);
}

const anchors = (layout) => layout.elements.map((e) => [e.type, e.x, e.y, e.axis, e.mirrored]);

describe('applyRecipe', () => {
  test('a smaller lot keeps every element where it is and reports those off it', () => {
    const layout = edited();
    const far = Math.max(...layout.elements.map((e) => e.y));
    // Short of the element farthest from A: it is off the lot now.
    const recipe = recipeOf({ ...RECIPE, length: Math.max(20, Math.floor(far) - 4) });
    const next = applyRecipe(layout, recipe);
    expect(next.recipe).toEqual(recipe);
    expect(anchors(next)).toEqual(anchors(layout));
    expect(next.start).toEqual(layout.start);
    const { course, problems } = routeLayout(next);
    expect(course.elements).toHaveLength(layout.elements.length);
    expect(course.site.length ?? course.recipe.length).toBe(recipe.length);
    expect(problems.some((p) => p.code === 'off-site' || p.code.endsWith('-off-site'))).toBe(true);
  });

  test('a bigger lot keeps the course as it was, without new problems', () => {
    const layout = edited();
    const before = routeLayout(layout).problems.length;
    const next = applyRecipe(layout, recipeOf({ ...RECIPE, width: 60, length: 80 }));
    expect(anchors(next)).toEqual(anchors(layout));
    expect(routeLayout(next).problems.length).toBeLessThanOrEqual(before);
  });

  test('fields that only steer the generator change nothing on the course', () => {
    const layout = edited();
    const recipe = recipeOf({ ...RECIPE, elements: 12, difficulty: 'hard', types: ['gate', 'u-turn'] });
    const next = applyRecipe(layout, recipe, layout.seed + 1);
    expect(next.seed).toBe(layout.seed + 1);
    expect(next.elements).toEqual(layout.elements);
    expect(routeLayout(next).course.cones).toEqual(routeLayout(layout).course.cones);
  });

  test('a fixed size goes onto the elements of its type, the others stay', () => {
    const layout = edited();
    const type = 'straight-slalom';
    expect(layout.elements.some((e) => e.type === type)).toBe(true);
    const recipe = recipeOf({ ...RECIPE, sizes: { [type]: { step: 6 } } });
    const next = applyRecipe(layout, recipe);
    expect(anchors(next)).toEqual(anchors(layout));
    next.elements.forEach((e, i) => {
      const was = layout.elements[i];
      if (e.type !== type) expect(e).toEqual(was);
      // The step is fixed; the count of cones stays the element's own.
      else expect(e.sizes).toEqual({ ...was.sizes, step: 6 });
    });
  });

  test('a fixed size dropped leaves the elements their sizes', () => {
    const sized = { ...RECIPE, sizes: { 'straight-slalom': { step: 6 } } };
    const layout = edited(sized);
    const next = applyRecipe(layout, recipeOf(RECIPE));
    expect(next.elements).toEqual(layout.elements);
  });

  test('an open course loses its own finish when it closes', () => {
    const open = { ...RECIPE, shape: 'open' };
    const layout = { ...edited(open), finish: { x: 5, y: 5, axis: 0 } };
    expect(applyRecipe(layout, recipeOf(open)).finish).toEqual(layout.finish);
    expect(applyRecipe(layout, recipeOf(RECIPE)).finish).toBeUndefined();
  });
});
