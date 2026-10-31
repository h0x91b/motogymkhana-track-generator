// Public API of the generator: generateCourse(recipe, seed).

import { DIFFICULTY_TABLE, instantiate, minimalParams, TYPE_NAMES, ZONE_PAD } from './catalog.js';
import { buildCourse, feasibleTypes, SITE_MARGIN } from './generate.js';
import { parseRecipe, parseSeed } from './recipe.js';

export { GENERATOR_VERSION } from './version.js';
export { parseRecipe, parseSeed, ELEMENT_TYPES, DIFFICULTIES, SEED_MAX } from './recipe.js';
export { TYPE_NAMES, DIFFICULTY_TABLE } from './catalog.js';
export { canonicalJSON, courseHash } from './canonical.js';

const DIFFICULTY_NAMES = { easy: 'лёгкая', medium: 'средняя', hard: 'сложная' };
const fmt = (v) => String(Math.round(v * 10) / 10).replace('.', ',');

/**
 * Smallest footprint among the allowed types (core + clearance, side axis),
 * reported when not even one element can be laid out.
 */
function siteTooSmall(recipe) {
  const usable = { width: recipe.width - 2 * SITE_MARGIN, length: recipe.length - 2 * SITE_MARGIN };
  let smallest = null;
  for (const type of recipe.types) {
    const p = minimalParams(type, recipe.difficulty).side;
    const tpl = instantiate(type, p, false, false);
    const a = (tpl.core[2] - tpl.core[0]) * tpl.unit;
    const b = (tpl.core[3] - tpl.core[1]) * tpl.unit;
    const long = Math.max(a, b);
    const short = Math.min(a, b);
    if (!smallest || long * short < smallest.long * smallest.short) smallest = { type, name: TYPE_NAMES[type], long, short };
  }
  const radius = DIFFICULTY_TABLE[recipe.difficulty].turnRadius;
  const fits = feasibleTypes(recipe).length > 0;
  const head = `Площадка ${recipe.width} × ${recipe.length} м мала для сложности «${DIFFICULTY_NAMES[recipe.difficulty]}»: `
    + `с отступом ${SITE_MARGIN} м от края остаётся ${usable.width} × ${usable.length} м.`;
  const tail = fits
    ? ` Элемент «${smallest.name}» (${fmt(smallest.long)} × ${fmt(smallest.short)} м) помещается, но не остаётся места `
      + `на старт, финиш и связки с радиусом поворота ${fmt(radius)} м.`
    : ` Самому компактному из разрешённых элементов («${smallest.name}») нужно ${fmt(smallest.long)} × ${fmt(smallest.short)} м.`;
  return {
    code: 'site-too-small',
    site: { width: recipe.width, length: recipe.length },
    usable,
    smallest: { type: smallest.type, length: smallest.long, width: smallest.short },
    clearance: ZONE_PAD,
    turnRadius: radius,
    message: head + tail,
  };
}

/**
 * Deterministic course for a recipe and seed. When the requested number of
 * elements does not fit, it is simplified: rebuilt with the same seed and one
 * element fewer until it fits, so (N, seed) simplified to K equals (K, seed).
 *
 * @returns {{ok: true, course: object} | {ok: false, error: object}}
 */
export function generateCourse(recipeInput, seedInput) {
  const parsed = parseRecipe(recipeInput);
  const seed = parseSeed(seedInput);
  if (!parsed.ok || !seed.ok) {
    const fields = { ...(parsed.ok ? {} : parsed.errors), ...(seed.ok ? {} : { seed: seed.error }) };
    return { ok: false, error: { code: 'invalid-input', fields } };
  }
  const recipe = parsed.recipe;
  for (let k = recipe.elements; k >= 1; k--) {
    const result = buildCourse(recipe, seed.seed, k);
    if (result.ok) {
      return { ok: true, course: { ...result.course, requested: recipe.elements, placed: k } };
    }
  }
  return { ok: false, error: siteTooSmall(recipe) };
}
