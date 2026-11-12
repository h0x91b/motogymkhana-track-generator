// Recipe (all generation inputs except the seed) and seed parsing.
// Both accept raw form values (strings) as well as already-normalised values,
// and never substitute a default or random value for an invalid one.

import { SIZE_OPTIONS, sizeValues, TYPE_NAMES } from './catalog.js';

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
  'fast-circle',
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
export const LOOPED_TYPES = ['pivot-turn', 'figure-eight', 'box', 'circle', 'fast-circle', 'gate-turn', 'box-eight', 'keyhole'];

// Types a column rides although their line comes back close to or across
// itself, so in «паровозик» their own passes are not checked against each
// other: the snail's two corridors run with a wall of cones between them, the
// mirror's legs cross once, short of its line.
export const TRAIN_EXEMPT_TYPES = ['mirror', 'snail'];

/**
 * The types the generator may use: the ticked ones, without loops in
 * «паровозик». Every type is used at every difficulty, which changes only the
 * sizes inside the elements (ADR 0017).
 */
export const usableTypes = (recipe) => recipe.types.filter((t) => !(recipe.train && LOOPED_TYPES.includes(t)));

export const DIFFICULTIES = ['easy', 'medium', 'hard'];

export const BIKES = ['sport', 'cruiser'];

// Course shapes: open (start and finish wherever the generator puts them),
// closed (one line is both start and finish, the course is a loop) and return
// (two lines, but the finish is placed back by the start: the rider ends where
// they started without riding round into the start again).
export const SHAPES = ['open', 'closed', 'return'];
export const SHAPE_NAMES = { open: 'открытая', closed: 'замкнутая', return: 'финиш у старта' };

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

// Size options an older build offered and this one no longer has: a recipe
// that still names one (a saved course file) opens without it.
const RETIRED_SIZES = { 'figure-eight': ['loop'] }; // the loop radius, before ADR 0021

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
      if (RETIRED_SIZES[type]?.includes(key)) continue;
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

// Safety margins: the free asphalt the generator keeps, adjustable so that a
// tight lot can be packed by hand. Each is a distance in metres on its own
// step; 0 switches that rule off. Defaults are the field rules of ADR 0007.
export const SAFETY_OPTIONS = [
  { key: 'runOff', name: 'Выкат вокруг разворотов и петель', min: 0, max: 5, step: 0.5, default: 5 },
  { key: 'pad', name: 'Запас вокруг элемента', min: 0, max: 2, step: 0.25, default: 0.75 },
  { key: 'coneGap', name: 'Свободно у конуса разворота', min: 0, max: 3, step: 0.5, default: 1.5 },
  { key: 'trainGap', name: 'Зазор маршрута в паровозике', min: 0, max: 5, step: 0.5, default: 2 },
  { key: 'edge', name: 'Отступ от края площадки', min: 0, max: 3, step: 0.5, default: 1 },
];
export const SAFETY_DEFAULTS = Object.fromEntries(SAFETY_OPTIONS.map((o) => [o.key, o.default]));
// The ones an element in «Правка» can set for itself.
export const ELEMENT_SAFETY_KEYS = ['runOff', 'pad'];

/** Values a safety option takes: min to max on its step. */
export const safetyValues = (o) => Array.from({ length: Math.round((o.max - o.min) / o.step) + 1 }, (_, k) => o.min + k * o.step);

/** Every safety value of a recipe, defaults filled in. */
export const safetyOf = (recipe) => ({ ...SAFETY_DEFAULTS, ...(recipe?.safety ?? {}) });

/** A safety distance from a number or a form string, or null when it is not one of the option's values. */
export function parseSafetyValue(option, raw) {
  const metres = parseMetres(raw);
  if (metres === null || metres < option.min - 1e-9 || metres > option.max + 1e-9) return null;
  const k = (metres - option.min) / option.step;
  return Math.abs(k - Math.round(k)) < 1e-9 ? metres : null;
}

/**
 * Safety values the recipe sets, `{ [key]: metres }`; only the ones that
 * differ from the default are kept, so a recipe at defaults stays `{}`.
 * @returns {{ok: true, safety: object} | {ok: false, error: string}}
 */
function parseSafety(value) {
  if (value === undefined || value === null) return { ok: true, safety: {} };
  if (typeof value !== 'object' || Array.isArray(value)) return { ok: false, error: 'Безопасность задана неверно' };
  for (const key of Object.keys(value)) {
    if (!SAFETY_OPTIONS.some((o) => o.key === key)) return { ok: false, error: `Нет такого правила безопасности: «${key}»` };
  }
  const safety = {};
  for (const o of SAFETY_OPTIONS) {
    const raw = value[o.key];
    if (raw === undefined || raw === null || raw === '') continue;
    const metres = parseSafetyValue(o, raw);
    if (metres === null) return { ok: false, error: `${o.name}: от ${fmtMetres(o.min)} до ${fmtMetres(o.max)} м с шагом ${fmtMetres(o.step)} м` };
    if (metres !== o.default) safety[o.key] = metres;
  }
  return { ok: true, safety };
}

// Blocked areas (`recipe.blocked`): rectangles of the lot nothing may use —
// a cutout, where the lot is not asphalt at all (a П-shaped lot is a rectangle
// with one), or an obstacle standing on it (a parked car, a pillar, a kerb
// island). Whole metres from the reference corner: x, y of the corner nearest
// to it, then the size along x and y. The generator keeps the site margin from
// their edges as from the lot's.
export const BLOCKED_KINDS = ['cutout', 'obstacle'];
export const BLOCKED_NAMES = { cutout: 'вырез', obstacle: 'препятствие' };
export const BLOCKED_MAX = 8;

/**
 * @returns {{ok: true, blocked: object[]} | {ok: false, error: string}}
 */
function parseBlocked(value, width, length) {
  if (value === undefined || value === null) return { ok: true, blocked: [] };
  if (!Array.isArray(value)) return { ok: false, error: 'Вырезы и препятствия заданы неверно' };
  if (value.length > BLOCKED_MAX) return { ok: false, error: `Не больше ${BLOCKED_MAX} вырезов и препятствий` };
  const blocked = [];
  for (const [i, raw] of value.entries()) {
    const n = i + 1;
    if (!raw || typeof raw !== 'object' || !BLOCKED_KINDS.includes(raw.kind)) return { ok: false, error: `Вырез или препятствие ${n} задан неверно` };
    const name = raw.kind === 'cutout' ? `Вырез ${n}` : `Препятствие ${n}`;
    const x = parseInteger(raw.x);
    const y = parseInteger(raw.y);
    const w = parseInteger(raw.w);
    const h = parseInteger(raw.h);
    if ([x, y, w, h].includes(null)) return { ok: false, error: `${name}: X, Y и размеры — целые метры` };
    if (w < 1 || h < 1) return { ok: false, error: `${name}: размеры не меньше 1 м` };
    if (width !== null && x + w > width) return { ok: false, error: `${name} выходит за площадку по X: X + ширина не больше ${width} м` };
    if (length !== null && y + h > length) return { ok: false, error: `${name} выходит за площадку по Y: Y + длина не больше ${length} м` };
    blocked.push({ kind: raw.kind, x, y, w, h });
  }
  return { ok: true, blocked };
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

  // A recipe saved before shapes had only `closed`: true is a closed course,
  // false or missing an open one. `shape` wins when both are given.
  let shape = null;
  if (src.shape !== undefined) shape = SHAPES.includes(src.shape) ? src.shape : null;
  else {
    const closed = parseBoolean(src.closed ?? false);
    if (closed !== null) shape = closed ? 'closed' : 'open';
  }
  if (shape === null) errors.shape = 'Выберите форму трассы: открытая, замкнутая или финиш у старта';

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
  }

  const sizes = parseSizes(src.sizes, types);
  if (!sizes.ok) errors.sizes = sizes.error;

  const safety = parseSafety(src.safety);
  if (!safety.ok) errors.safety = safety.error;
  const blocked = parseBlocked(src.blocked, width, length);
  if (!blocked.ok) errors.blocked = blocked.error;

  if (Object.keys(errors).length) return { ok: false, errors };
  return {
    ok: true,
    recipe: { width, length, elements, types, difficulty, bike, shape, train, sizes: sizes.sizes, safety: safety.safety, blocked: blocked.blocked },
  };
}
