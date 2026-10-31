import { describe, expect, test } from 'bun:test';
import { generateCourse } from '../src/generator/index.js';

const baseRecipe = {
  width: 40,
  length: 60,
  elements: 6,
  difficulty: 'medium',
  closed: true,
};

describe('seed input', () => {
  for (const bad of ['', '  ', '1.5', '12abc', 'abc', '-1', '+5', '4294967296', '1e3', 1.5, -1, 2 ** 32, NaN, null, undefined]) {
    test(`rejects ${JSON.stringify(bad)} with a seed error instead of a course`, () => {
      const result = generateCourse(baseRecipe, bad);
      expect(result.ok).toBe(false);
      expect(result.error.code).toBe('invalid-input');
      expect(Object.keys(result.error.fields)).toEqual(['seed']);
    });
  }

  test('seed 0 is an ordinary valid seed', () => {
    const result = generateCourse(baseRecipe, 0);
    expect(result.ok).toBe(true);
    expect(result.course.seed).toBe(0);
  });

  test('leading zeros are normalised: "007" is seed 7', () => {
    const a = generateCourse(baseRecipe, '007');
    const b = generateCourse(baseRecipe, 7);
    expect(a.ok).toBe(true);
    expect(a.course.seed).toBe(7);
    expect(JSON.stringify(a.course)).toBe(JSON.stringify(b.course));
  });

  test('the largest seed 4294967295 is accepted', () => {
    const result = generateCourse(baseRecipe, '4294967295');
    expect(result.ok).toBe(true);
    expect(result.course.seed).toBe(4294967295);
  });
});

describe('recipe input', () => {
  const cases = [
    ['elements below 1', { elements: 0 }, 'elements'],
    ['elements above 15', { elements: 16 }, 'elements'],
    ['fractional elements', { elements: '2.5' }, 'elements'],
    ['empty allowed types', { types: [] }, 'types'],
    ['unknown element type', { types: ['spiral'] }, 'types'],
    ['site too narrow', { width: 9 }, 'width'],
    ['site too long', { length: 101 }, 'length'],
    ['site width as text', { width: 'сорок' }, 'width'],
    ['unknown difficulty', { difficulty: 'extreme' }, 'difficulty'],
  ];
  for (const [name, patch, field] of cases) {
    test(`${name} is an explicit field error`, () => {
      const result = generateCourse({ ...baseRecipe, ...patch }, 1);
      expect(result.ok).toBe(false);
      expect(result.error.code).toBe('invalid-input');
      expect(Object.keys(result.error.fields)).toEqual([field]);
    });
  }

  test('form strings are normalised like numbers', () => {
    const fromForm = generateCourse({ ...baseRecipe, width: '40', length: ' 60 ', elements: '06', closed: 'true' }, '5');
    const fromNumbers = generateCourse(baseRecipe, 5);
    expect(fromForm.ok).toBe(true);
    expect(JSON.stringify(fromForm.course)).toBe(JSON.stringify(fromNumbers.course));
  });

  test('the order of ticked types does not matter', () => {
    const a = generateCourse({ ...baseRecipe, types: ['box', 'gate', 'pivot-turn'] }, 11);
    const b = generateCourse({ ...baseRecipe, types: ['pivot-turn', 'box', 'gate'] }, 11);
    expect(JSON.stringify(a.course)).toBe(JSON.stringify(b.course));
  });

  test('all eight types are allowed by default', () => {
    const result = generateCourse(baseRecipe, 1);
    expect(result.course.recipe.types).toHaveLength(8);
  });
});
