import { describe, expect, test } from 'bun:test';
import { ELEMENT_TYPES, generateCourse, parseRecipe } from '../src/generator/index.js';
import { DIFFICULTIES } from '../src/generator/recipe.js';
import { instantiate, isBig, minimalParams } from '../src/generator/catalog.js';

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
    ['unknown course shape', { shape: 'spiral' }, 'shape'],
    ['«Замкнутая» neither yes nor no', { closed: 'maybe' }, 'shape'],
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

  test('a recipe saved before shapes: «Замкнутая» on is a closed course, off or missing an open one', () => {
    const { closed, ...rest } = baseRecipe;
    expect(parseRecipe({ ...rest, closed: true }).recipe.shape).toBe('closed');
    expect(parseRecipe({ ...rest, closed: 'false' }).recipe.shape).toBe('open');
    expect(parseRecipe(rest).recipe.shape).toBe('open');
    expect(parseRecipe({ ...rest, closed: true, shape: 'return' }).recipe.shape).toBe('return');
    expect(parseRecipe(baseRecipe).recipe).not.toHaveProperty('closed');
    expect(geometry(generateCourse(baseRecipe, 4).course)).toBe(geometry(generateCourse({ ...rest, shape: 'closed' }, 4).course));
  });

  test('the order of ticked types does not matter', () => {
    const a = generateCourse({ ...baseRecipe, types: ['box', 'gate', 'pivot-turn'] }, 11);
    const b = generateCourse({ ...baseRecipe, types: ['pivot-turn', 'box', 'gate'] }, 11);
    expect(JSON.stringify(a.course)).toBe(JSON.stringify(b.course));
  });

  test('«паровозик» is off unless asked for, and takes form strings like «Замкнутая»', () => {
    expect(parseRecipe(baseRecipe).recipe.train).toBe(false);
    expect(parseRecipe({ ...baseRecipe, train: 'true' }).recipe.train).toBe(true);
    expect(parseRecipe({ ...baseRecipe, train: 'maybe' }).errors.train).toBeTruthy();
  });

  test('a course is for a cruiser unless a sport bike is asked for', () => {
    expect(parseRecipe(baseRecipe).recipe.bike).toBe('cruiser');
    expect(parseRecipe({ ...baseRecipe, bike: 'sport' }).recipe.bike).toBe('sport');
    expect(parseRecipe({ ...baseRecipe, bike: 'chopper' }).errors.bike).toBeTruthy();
  });

  test('«паровозик» with only looped types ticked is a types error, not an empty course', () => {
    const result = parseRecipe({ ...baseRecipe, train: true, types: ['pivot-turn', 'figure-eight', 'box'] });
    expect(result.ok).toBe(false);
    expect(result.errors.types).toBeTruthy();
    expect(generateCourse({ ...baseRecipe, train: true, types: ['box'] }, 1).error.code).toBe('invalid-input');
  });

  test('every type is allowed by default', () => {
    const result = generateCourse(baseRecipe, 1);
    expect(result.course.recipe.types).toEqual(ELEMENT_TYPES);
    expect(ELEMENT_TYPES).toHaveLength(20);
  });

  test('only the types kept for medium and hard, ticked at easy, are a types error', () => {
    const result = parseRecipe({ ...baseRecipe, difficulty: 'easy', types: ['snail', 'keyhole'] });
    expect(result.ok).toBe(false);
    expect(result.errors.types).toBeTruthy();
    expect(parseRecipe({ ...baseRecipe, difficulty: 'medium', types: ['snail', 'keyhole'] }).ok).toBe(true);
  });
});

const geometry = (c) => JSON.stringify({ cones: c.cones, elements: c.elements, passes: c.passes, route: c.route });

describe('determinism', () => {
  test('the same recipe and seed give byte-identical courses', () => {
    for (const seed of [0, 1, 99, 123456789, 4294967295]) {
      const a = generateCourse({ ...baseRecipe, elements: 10, closed: false }, seed);
      const b = generateCourse({ ...baseRecipe, elements: 10, closed: false }, seed);
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    }
  });

  test('different seeds give different courses', () => {
    const seen = new Set();
    for (let seed = 0; seed < 20; seed++) seen.add(geometry(generateCourse(baseRecipe, seed).course));
    expect(seen.size).toBe(20);
  });
});

describe('simplification', () => {
  const tight = { width: 30, length: 40, elements: 6, difficulty: 'easy', closed: true };

  test('a course simplified from N to K elements is exactly the course ordered with K', () => {
    let simplified = 0;
    for (let seed = 0; seed < 40; seed++) {
      const full = generateCourse(tight, seed).course;
      expect(full.requested).toBe(6);
      if (full.placed === 6) continue;
      simplified++;
      const direct = generateCourse({ ...tight, elements: full.placed }, seed).course;
      expect(direct.placed).toBe(full.placed);
      expect(geometry(full)).toBe(geometry(direct));
    }
    expect(simplified).toBeGreaterThan(5);
  }, 30_000);

  test('the same holds for a course finishing by the start', () => {
    const home = { ...tight, shape: 'return' };
    let simplified = 0;
    for (let seed = 0; seed < 40; seed++) {
      const full = generateCourse(home, seed).course;
      if (full.placed === 6) continue;
      simplified++;
      const direct = generateCourse({ ...home, elements: full.placed }, seed).course;
      expect(geometry(full)).toBe(geometry(direct));
    }
    expect(simplified).toBeGreaterThan(5);
  }, 30_000);

  test('a site too small for any allowed element is an error with the computed numbers, not an empty course', () => {
    const result = generateCourse({ width: 10, length: 10, elements: 3, difficulty: 'easy', closed: false, types: ['straight-slalom'] }, 1);
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('site-too-small');
    expect(result.error.usable).toEqual({ width: 8, length: 8 });
    // Four cones 4.5 m apart: 13.5 m between the end cones, plus the weave run-in and run-out.
    expect(result.error.smallest.type).toBe('straight-slalom');
    expect(result.error.smallest.length).toBeGreaterThan(13.5);
    expect(result.error.message).toContain('10 × 10 м');
    expect(result.error.message).toContain('8 × 8 м');
    expect(result.error.message).toContain('Прямой слалом');
  });

  test('a turning element that fits but whose run-off zone does not: the error gives the run-off size', () => {
    const result = generateCourse({ width: 10, length: 10, elements: 1, difficulty: 'easy', closed: true, types: ['box'] }, 3);
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('site-too-small');
    // A box sized for a cruiser's U-turn (13 m) with 5 m of free asphalt on every side.
    expect(result.error.smallest.runOff).toEqual({ length: 23, width: 23 });
    expect(result.error.message).toContain('Коробка');
    expect(result.error.message).toContain('23 × 23 м');
  });

  test('when the element fits but its approaches do not, the error says so', () => {
    const result = generateCourse({ width: 10, length: 10, elements: 1, difficulty: 'easy', closed: true, types: ['gate'] }, 3);
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('site-too-small');
    expect(result.error.message).toContain('радиусом поворота 4,5 м');
  });
});

describe('field-measured element sizes', () => {
  const metres = (tpl, [lo, hi]) => (hi - lo) * tpl.unit;
  const build = (type, difficulty, bike) => {
    const { side } = minimalParams(type, difficulty, bike);
    return instantiate(type, side, false, false);
  };

  test('slaloms take 4 m steps at the medium and hard levels', () => {
    for (const d of ['medium', 'hard']) {
      expect(build('straight-slalom', d, 'cruiser').params.step * 0.5).toBe(4);
      expect(build('offset-slalom', d, 'cruiser').params.step * 0.5).toBe(4);
    }
  });

  test('the keyhole ring is 4 m on a sport bike and 4.5 m on a cruiser', () => {
    for (const d of ['medium', 'hard']) {
      expect(build('keyhole', d, 'sport').params.radius * 0.5).toBe(4);
      expect(build('keyhole', d, 'cruiser').params.radius * 0.5).toBe(4.5);
    }
  });

  test('the box eight rectangle is 13 × 8 m', () => {
    for (const d of ['medium', 'hard']) {
      const tpl = build('box-eight', d, 'cruiser');
      const corners = tpl.cones.slice(4);
      expect((corners[1].a - corners[0].a) * 0.5).toBe(13);
      expect((corners[2].b - corners[1].b) * 0.5).toBe(8);
    }
  });

  test('the small circle rings at 4 m, the fast circle at 12 m and is always a big element', () => {
    for (const d of DIFFICULTIES) {
      const small = build('circle', d, 'cruiser');
      const fast = build('fast-circle', d, 'sport');
      expect(small.params.radius * 0.5).toBe(4);
      expect(fast.params.radius * 0.5).toBe(12);
      expect(metres(fast, [fast.core[1], fast.core[3]])).toBeGreaterThanOrEqual(26);
      expect(isBig(fast)).toBe(true);
    }
  });
});
