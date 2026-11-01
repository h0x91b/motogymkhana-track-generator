// Recipe (all generation inputs except the seed) and seed parsing.
// Both accept raw form values (strings) as well as already-normalised values,
// and never substitute a default or random value for an invalid one.

import { GENERATOR_VERSION } from './version.js';

export const ELEMENT_TYPES = [
  'straight-slalom',
  'offset-slalom',
  'gate',
  'lane-change',
  'u-turn',
  'pivot-turn',
  'figure-eight',
  'box',
];

export const DIFFICULTIES = ['easy', 'medium', 'hard'];

export const SITE_MIN = 10;
export const SITE_MAX = 100;
export const ELEMENTS_MIN = 1;
export const ELEMENTS_MAX = 15;
export const SEED_MAX = 4294967295;

const INTEGER = /^\d+$/;

function parseInteger(value) {
  if (typeof value === 'number') return Number.isInteger(value) ? value : null;
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!INTEGER.test(text)) return null;
  // Leading zeros are fine; Number() of a long digit string stays exact up to
  // 2^53, far beyond every range we accept.
  return Number(text);
}

function parseIntegerInRange(value, min, max) {
  const n = parseInteger(value);
  return n !== null && n >= min && n <= max ? n : null;
}

export function parseSeed(value) {
  const seed = parseIntegerInRange(value, 0, SEED_MAX);
  if (seed === null) return { ok: false, error: `Введите целое число от 0 до ${SEED_MAX}` };
  return { ok: true, seed };
}

function parseBoolean(value) {
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return null;
}

/**
 * @returns {{ok: true, recipe: object} | {ok: false, errors: Record<string, string>}}
 */
export function parseRecipe(input) {
  const errors = {};
  const src = input && typeof input === 'object' ? input : {};

  const width = parseIntegerInRange(src.width, SITE_MIN, SITE_MAX);
  if (width === null) errors.width = `Введите ширину целым числом метров от ${SITE_MIN} до ${SITE_MAX}`;

  const length = parseIntegerInRange(src.length, SITE_MIN, SITE_MAX);
  if (length === null) errors.length = `Введите длину целым числом метров от ${SITE_MIN} до ${SITE_MAX}`;

  const elements = parseIntegerInRange(src.elements, ELEMENTS_MIN, ELEMENTS_MAX);
  if (elements === null) errors.elements = `Введите число элементов от ${ELEMENTS_MIN} до ${ELEMENTS_MAX}`;

  const difficulty = DIFFICULTIES.includes(src.difficulty) ? src.difficulty : null;
  if (difficulty === null) errors.difficulty = 'Выберите сложность';

  const closed = parseBoolean(src.closed ?? false);
  if (closed === null) errors.closed = 'Замкнутость — да или нет';

  let types = null;
  if (src.types === undefined) {
    types = [...ELEMENT_TYPES];
  } else if (Array.isArray(src.types) && src.types.every((t) => ELEMENT_TYPES.includes(t))) {
    // Canonical order, duplicates dropped: the order the user ticked boxes in
    // must not change the course.
    types = ELEMENT_TYPES.filter((t) => src.types.includes(t));
  }
  if (!types || types.length === 0) errors.types = 'Отметьте хотя бы один тип элемента';

  if (Object.keys(errors).length) return { ok: false, errors };
  return {
    ok: true,
    recipe: { width, length, elements, types, difficulty, closed, generatorVersion: GENERATOR_VERSION },
  };
}
