// Size options: a size fixed in the recipe is the size the element gets, the
// bike class still sets the minimum of a U-turn, and bad values are field errors.

import { describe, expect, test } from 'bun:test';
import { buildSetupSheet } from '../src/sheet/setup-sheet.js';
import {
  generateCourse, parseRecipe, SIZE_OPTIONS, sizeMinimum, sizeValues, uTurnRadius,
} from '../src/generator/index.js';
import { seeds, sweep, timeout } from './helpers/slow.js';

const SITE = { width: 60, length: 80, shape: 'open' };
// The slow run lays out each size on two seeds, the default run on one.
const SEEDS = sweep([1, 2], [1]);
const unitOf = (e) => (e.axis % 2 === 1 ? 0.5 * Math.SQRT2 : 0.5);

/** The size an option gave this element, in metres along its axis. */
function sizeOf(e, option) {
  return e.params[option.key] * (option.plain ? 1 : unitOf(e));
}

/** The size an element should get for a chosen value: raised to the class minimum, then on the lattice. */
function expected(type, option, value, difficulty, bike) {
  const min = sizeMinimum(type, option.key, difficulty, bike);
  return Math.max(value, min ?? 0);
}

describe('size options', () => {
  for (const [type, options] of Object.entries(SIZE_OPTIONS)) {
    for (const option of options) {
      test(`${type} ${option.key}: every offered value is the size the element gets`, () => {
        const difficulty = 'hard';
        let seen = 0;
        for (const bike of ['cruiser', 'sport']) {
          for (const value of sizeValues(option)) {
            for (const seed of SEEDS) {
              // A keyhole never starts or ends a course (its way out is its way in): gates either side.
              const recipe = { ...SITE, elements: 3, difficulty, bike, types: type === 'keyhole' ? [type, 'gate'] : [type], sizes: { [type]: { [option.key]: value } } };
              const result = generateCourse(recipe, seed);
              expect(result.ok, `${bike} ${value} m seed ${seed}`).toBe(true);
              expect(result.course.recipe.sizes).toEqual({ [type]: { [option.key]: value } });
              for (const e of result.course.elements.filter((el) => el.type === type)) {
                const got = sizeOf(e, option);
                const want = expected(type, option, value, difficulty, bike);
                const label = `${bike} ${value} m seed ${seed} axis ${e.axis}`;
                if (sizeMinimum(type, option.key, difficulty, bike) !== null) {
                  // A U-turn size is a minimum: the shortest lattice length not below it.
                  expect(got, label).toBeGreaterThanOrEqual(want - 1e-9);
                  expect(got, label).toBeLessThan(want + unitOf(e) + 1e-9);
                } else if (e.axis % 2 === 0 || option.plain) {
                  expect(got, label).toBeCloseTo(want, 9);
                } else {
                  // On a diagonal: the nearest lattice length, within a quarter metre (ADR 0005).
                  expect(Math.abs(got - want), label).toBeLessThanOrEqual(0.25 + 1e-9);
                }
                seen++;
              }
            }
          }
        }
        expect(seen).toBeGreaterThan(0);
      }, timeout(30_000));
    }
  }

  test('the class radius sizes the loops of a figure eight, not the distance between its cones (ADR 0021)', () => {
    const eight = (difficulty, bike) => {
      const recipe = { ...SITE, elements: 1, difficulty, bike, types: ['figure-eight'] };
      let e;
      for (let seed = 0; seed < 30 && !(e?.axis % 2 === 0); seed++) e = generateCourse(recipe, seed).course.elements[0];
      return { distance: e.params.distance * unitOf(e), radius: e.params.radius };
    };
    for (const bike of ['cruiser', 'sport']) {
      for (const [difficulty, distance] of [['easy', 10], ['medium', 8], ['hard', 6.5]]) {
        expect(eight(difficulty, bike), `${difficulty} ${bike}`).toEqual({ distance, radius: uTurnRadius(difficulty, bike) });
      }
    }
    expect(eight('hard', 'cruiser')).toEqual({ distance: 6.5, radius: 4.5 });
  });

  test('a recipe from before ADR 0021 that fixed the eight loop radius still reads, without it', () => {
    const result = parseRecipe({ ...SITE, elements: 3, difficulty: 'hard', types: ['figure-eight'], sizes: { 'figure-eight': { loop: 7 } } });
    expect(result.ok).toBe(true);
    expect(result.recipe.sizes).toEqual({});
  });

  test('closed figures still grow with the bike class: a cruiser U-turn and box are wider than a sport one', () => {
    const size = (type, key, bike) => {
      const e = generateCourse({ ...SITE, elements: 1, difficulty: 'hard', bike, types: [type] }, 1).course.elements[0];
      return e.params[key] * unitOf(e);
    };
    for (const [type, key] of [['u-turn', 'width'], ['box', 'size']]) {
      expect(size(type, key, 'cruiser'), type).toBeGreaterThan(size(type, key, 'sport'));
      expect(size(type, key, 'cruiser'), type).toBeGreaterThanOrEqual(2 * (uTurnRadius('hard', 'cruiser') + 1) - 1e-9);
    }
  });

  test('a straight slalom of 3, 4 or 5 m is laid out at exactly that step', () => {
    for (const step of [3, 4, 5]) {
      const recipe = { width: 40, length: 60, elements: 8, difficulty: 'medium', shape: 'closed', sizes: { 'straight-slalom': { step } } };
      for (let seed = 0; seed < sweep(20, 1); seed++) {
        const course = generateCourse(recipe, seed).course;
        for (const e of course.elements.filter((x) => x.type === 'straight-slalom' && x.axis % 2 === 0)) {
          expect(e.params.step * 0.5).toBe(step);
        }
      }
    }
  }, timeout(30_000));

  test('the bike class raises a U-turn that is too tight, and the recipe keeps the chosen value', () => {
    const recipe = { ...SITE, elements: 1, difficulty: 'hard', bike: 'cruiser', types: ['u-turn'], sizes: { 'u-turn': { width: 8 } } };
    const course = generateCourse(recipe, 1).course;
    expect(course.recipe.sizes['u-turn'].width).toBe(8);
    const e = course.elements[0];
    expect(e.params.width * unitOf(e)).toBeGreaterThanOrEqual(2 * (uTurnRadius('hard', 'cruiser') + 1));
  });

  test('no sizes and empty sizes are the same recipe', () => {
    const base = { width: 40, length: 60, elements: 8, difficulty: 'medium', shape: 'closed' };
    const a = generateCourse(base, 9).course;
    const b = generateCourse({ ...base, sizes: {} }, 9).course;
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.recipe.sizes).toEqual({});
  });

  test('a size on an unticked type does not change the recipe or the course', () => {
    const base = { width: 40, length: 60, elements: 6, difficulty: 'medium', shape: 'closed', types: ['gate', 'zigzag'] };
    const a = generateCourse(base, 3).course;
    const b = generateCourse({ ...base, sizes: { 'straight-slalom': { step: 6 } } }, 3).course;
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  test('form strings with a decimal comma are read as metres', () => {
    const r = parseRecipe({ width: 40, length: 60, elements: 6, difficulty: 'medium', sizes: { circle: { radius: '2,5' }, gate: { width: '' } } });
    expect(r.ok).toBe(true);
    expect(r.recipe.sizes).toEqual({ circle: { radius: 2.5 } });
  });

  const bad = [
    ['off the 0.5 m step', { 'straight-slalom': { step: 3.25 } }],
    ['below the range', { 'straight-slalom': { step: 2.5 } }],
    ['above the range', { 'straight-slalom': { step: 6.5 } }],
    ['not a number', { 'straight-slalom': { step: 'abc' } }],
    ['an unknown size', { 'straight-slalom': { width: 3 } }],
    ['a type without size options', { snail: { corridor: 2 } }],
    ['not an object', 'big'],
  ];
  for (const [name, sizes] of bad) {
    test(`a size ${name} is a sizes field error`, () => {
      const result = generateCourse({ width: 40, length: 60, elements: 6, difficulty: 'medium', sizes }, 1);
      expect(result.ok).toBe(false);
      expect(Object.keys(result.error.fields)).toEqual(['sizes']);
    });
  }

  test('a course simplified from N to K elements with fixed sizes is the course ordered with K', () => {
    const tight = {
      width: 25, length: 35, elements: 7, difficulty: 'medium', shape: 'closed',
      sizes: { 'straight-slalom': { step: 6 }, 'offset-slalom': { step: 7 }, circle: { radius: 5 }, 'corridor-slalom': { width: 6, step: 5 } },
    };
    let simplified = 0;
    // Fast: a seed that simplifies and takes the least time to.
    for (const seed of seeds(30, [1], 0)) {
      const full = generateCourse(tight, seed).course;
      if (!full || full.placed === tight.elements) continue;
      simplified++;
      const direct = generateCourse({ ...tight, elements: full.placed }, seed).course;
      expect({ ...direct, requested: 0 }).toEqual({ ...full, requested: 0, recipe: { ...full.recipe, elements: full.placed } });
    }
    expect(simplified).toBeGreaterThan(sweep(3, 0));
  }, timeout(30_000));

  test('the setup sheet card says which sizes the recipe fixed and what the class raised', () => {
    const recipe = {
      ...SITE, elements: 3, difficulty: 'hard', bike: 'cruiser', types: ['u-turn', 'straight-slalom'],
      sizes: { 'u-turn': { width: 8 }, 'straight-slalom': { step: 4.5 } },
    };
    const sheet = buildSetupSheet(generateCourse(recipe, 2).course);
    const slalom = sheet.cards.find((c) => c.type === 'straight-slalom');
    const uTurn = sheet.cards.find((c) => c.type === 'u-turn');
    expect(slalom.fixed).toEqual([{ key: 'step', name: 'Шаг', value: 4.5, label: 'Задано в рецепте: шаг 4,5 м' }]);
    expect(slalom.notes[0]).toBe('Задано в рецепте: шаг 4,5 м');
    expect(uTurn.fixed[0].raisedTo).toBe(11);
    expect(uTurn.notes[0]).toBe('Задано в рецепте: ширина 8,0 м — мало для мотоцикла «крузер», взято не меньше 11,0 м');
    const plain = buildSetupSheet(generateCourse({ ...recipe, sizes: {} }, 2).course);
    expect(plain.cards.every((c) => c.fixed.length === 0)).toBe(true);
  });
});
