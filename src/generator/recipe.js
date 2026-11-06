// Recipe (all generation inputs except the seed) and seed parsing.
// Both accept raw form values (strings) as well as already-normalised values,
// and never substitute a default or random value for an invalid one.

import { SIZE_OPTIONS, sizeValues, TYPE_NAMES } from './catalog.js';
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
  'circle',
  'mirror',
  'gate-turn',
  'snail',
  'tunnel',
  'zigzag',
  'corridor-slalom',
  'box-eight',
  'keyhole',
  'crescent',
  'swerve',
];

// Types whose trajectory passes the same spot twice a few metres of route
// apart: in «паровозик», a column of riders, they would meet there.
export const LOOPED_TYPES = ['pivot-turn', 'figure-eight', 'box', 'circle', 'gate-turn', 'box-eight', 'keyhole'];

// Types a column rides although their line comes back close to or across
// itself, so in «паровозик» their own passes are not checked against each
// other: the snail's two corridors run with a wall of cones between them, the
// mirror's legs cross once, short of its line.
export const TRAIN_EXEMPT_TYPES = ['mirror', 'snail'];

// Types too tight or too long for a beginner: the generator uses them from
// these difficulties only. The other types are used at every difficulty.
export const TYPE_LEVELS = { snail: ['medium', 'hard'], 'box-eight': ['medium', 'hard'], keyhole: ['medium', 'hard'] };

const atLevel = (type, difficulty) => !TYPE_LEVELS[type] || TYPE_LEVELS[type].includes(difficulty);

/**
 * The types the generator may use: the allowed ones at this difficulty,
 * without loops in «паровозик».
 */
export const usableTypes = (recipe) =>
  recipe.types.filter((t) => atLevel(t, recipe.difficulty) && !(recipe.train && LOOPED_TYPES.includes(t)));

export const DIFFICULTIES = ['easy', 'medium', 'hard'];

export const BIKES = ['sport', 'cruiser'];

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

const METRES = /^\d+(?:[.,]\d+)?$/;

/** A size in metres from a number or a form string with a decimal comma or point; null otherwise. */
function parseMetres(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string' || !METRES.test(value.trim())) return null;
  return Number(value.trim().replace(',', '.'));
}

const fmtMetres = (v) => String(v).replace('.', ',');

/**
 * Size options the recipe fixes, `{ [type]: { [key]: metres } }` (SIZE_OPTIONS).
 * Only ticked types keep theirs, in canonical order, so a size left on an
 * unticked type does not change the recipe.
 * @returns {{ok: true, sizes: object} | {ok: false, error: string}}
 */
function parseSizes(value, types) {
  if (value === undefined || value === null) return { ok: true, sizes: {} };
  if (typeof value !== 'object' || Array.isArray(value)) return { ok: false, error: 'Размеры элементов заданы неверно' };
  for (const type of Object.keys(value)) {
    if (!SIZE_OPTIONS[type]) return { ok: false, error: `У типа «${TYPE_NAMES[type] ?? type}» нет настраиваемых размеров` };
    const chosen = value[type];
    if (!chosen || typeof chosen !== 'object' || Array.isArray(chosen)) return { ok: false, error: `Размеры «${TYPE_NAMES[type]}» заданы неверно` };
    for (const key of Object.keys(chosen)) {
      if (!SIZE_OPTIONS[type].some((o) => o.key === key)) return { ok: false, error: `У типа «${TYPE_NAMES[type]}» нет размера «${key}»` };
    }
  }
  const sizes = {};
  for (const type of types ?? []) {
    if (!SIZE_OPTIONS[type] || !value[type]) continue;
    const own = {};
    for (const option of SIZE_OPTIONS[type]) {
      const raw = value[type][option.key];
      if (raw === undefined || raw === null || raw === '') continue;
      const metres = parseMetres(raw);
      if (metres === null || !sizeValues(option).includes(metres)) {
        return {
          ok: false,
          error: `${TYPE_NAMES[type]}, ${option.name.toLowerCase()}: от ${fmtMetres(option.min)} до ${fmtMetres(option.max)} м с шагом 0,5 м`,
        };
      }
      own[option.key] = metres;
    }
    if (Object.keys(own).length) sizes[type] = own;
  }
  return { ok: true, sizes };
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

  // Without a class the course is for a cruiser: every bike rides that.
  const bike = BIKES.includes(src.bike ?? 'cruiser') ? (src.bike ?? 'cruiser') : null;
  if (bike === null) errors.bike = 'Выберите мотоцикл: спорт или крузер';

  const closed = parseBoolean(src.closed ?? false);
  if (closed === null) errors.closed = 'Замкнутость — да или нет';

  const train = parseBoolean(src.train ?? false);
  if (train === null) errors.train = 'Паровозик — да или нет';

  let types = null;
  if (src.types === undefined) {
    types = [...ELEMENT_TYPES];
  } else if (Array.isArray(src.types) && src.types.every((t) => ELEMENT_TYPES.includes(t))) {
    // Canonical order, duplicates dropped: the order the user ticked boxes in
    // must not change the course.
    types = ELEMENT_TYPES.filter((t) => src.types.includes(t));
  }
  if (!types || types.length === 0) errors.types = 'Отметьте хотя бы один тип элемента';
  else if (train && types.every((t) => LOOPED_TYPES.includes(t))) {
    errors.types = 'В паровозике нет элементов с петлями и встречной ездой: отметьте другой тип';
  } else if (difficulty && types.every((t) => !atLevel(t, difficulty))) {
    errors.types = 'Улитка, восьмёрка в габарите и замочная скважина — только для средней и сложной: отметьте другой тип';
  } else if (difficulty && train && usableTypes({ types, difficulty, train }).length === 0) {
    errors.types = 'Ни один отмеченный тип не подходит для паровозика на этой сложности: отметьте другой тип';
  }

  const sizes = parseSizes(src.sizes, types);
  if (!sizes.ok) errors.sizes = sizes.error;

  if (Object.keys(errors).length) return { ok: false, errors };
  return {
    ok: true,
    recipe: { width, length, elements, types, difficulty, bike, closed, train, sizes: sizes.sizes, generatorVersion: GENERATOR_VERSION },
  };
}
