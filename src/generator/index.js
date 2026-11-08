// Public API of the generator: generateCourse(recipe, seed).

import { BIKE_TURN_RADIUS, instantiate, minimalParams, RUN_OFF, TYPE_NAMES, ZONE_PAD } from './catalog.js';
import { alwaysBig, buildCourse, CLOSING_TURN_LIMITS, feasibleTypes, SITE_MARGIN, TYPE_TRY_LIMITS } from './generate.js';
import { parseRecipe, parseSeed, usableTypes } from './recipe.js';

export { parseRecipe, parseSeed, BIKES, SHAPES, SHAPE_NAMES, ELEMENT_TYPES, DIFFICULTIES, LOOPED_TYPES, SEED_MAX, TRAIN_EXEMPT_TYPES, TYPE_LEVELS } from './recipe.js';
export {
  BIG_ELEMENT_AREA, BIKE_TURN_RADIUS, RUN_OFF, RUN_OFF_TYPES, TYPE_NAMES, DIFFICULTY_TABLE, uTurnRadius, SIZE_OPTIONS, sizeDefault, sizeMinimum, sizeValues,
} from './catalog.js';
export { canonicalJSON } from './canonical.js';
export { U_TURN_CONE_CLEARANCE } from './generate.js';

const DIFFICULTY_NAMES = { easy: 'лёгкая', medium: 'средняя', hard: 'сложная' };
const BIKE_NAMES = { sport: 'спорт', cruiser: 'крузер' };
const fmt = (v) => String(Math.round(v * 10) / 10).replace('.', ',');

/**
 * Smallest footprint among the allowed types (side axis), reported when not
 * even one element can be laid out: the core inside the margin, and for a
 * turning type its run-off zone on the site, whichever needs more asphalt.
 */
function siteTooSmall(recipe) {
  const usable = { width: recipe.width - 2 * SITE_MARGIN, length: recipe.length - 2 * SITE_MARGIN };
  let smallest = null;
  for (const type of usableTypes(recipe)) {
    const p = minimalParams(type, recipe.difficulty, recipe.bike, recipe.sizes).side;
    const tpl = instantiate(type, p, false, false);
    const a = (tpl.core[2] - tpl.core[0]) * tpl.unit;
    const b = (tpl.core[3] - tpl.core[1]) * tpl.unit;
    const long = Math.max(a, b);
    const short = Math.min(a, b);
    const ra = tpl.runOff ? (tpl.runOff[2] - tpl.runOff[0]) * tpl.unit : 0;
    const rb = tpl.runOff ? (tpl.runOff[3] - tpl.runOff[1]) * tpl.unit : 0;
    const runOff = tpl.runOff ? { length: Math.max(ra, rb), width: Math.min(ra, rb) } : null;
    // Asphalt the element takes on the site: core + margins, or its run-off zone.
    const need = Math.max(long + 2 * SITE_MARGIN, runOff ? runOff.length : 0) * Math.max(short + 2 * SITE_MARGIN, runOff ? runOff.width : 0);
    if (!smallest || need < smallest.need) smallest = { type, name: TYPE_NAMES[type], long, short, runOff, need };
  }
  const radius = BIKE_TURN_RADIUS[recipe.bike];
  const fits = feasibleTypes(recipe).length > 0;
  const head = `Площадка ${recipe.width} × ${recipe.length} м мала для сложности «${DIFFICULTY_NAMES[recipe.difficulty]}» на мотоцикле «${BIKE_NAMES[recipe.bike]}»: `
    + `с отступом ${SITE_MARGIN} м от края остаётся ${usable.width} × ${usable.length} м.`;
  const tail = fits
    ? ` Элемент «${smallest.name}» (${fmt(smallest.long)} × ${fmt(smallest.short)} м) помещается, но не остаётся места `
      + `на старт, финиш и связки с радиусом поворота ${fmt(radius)} м.`
    : ` Самому компактному из разрешённых типов («${smallest.name}») нужно ${fmt(smallest.long)} × ${fmt(smallest.short)} м`
      + (smallest.runOff
        ? ` и ещё по ${fmt(RUN_OFF)} м свободного асфальта вокруг на выкат: площадка не меньше ${fmt(smallest.runOff.length)} × ${fmt(smallest.runOff.width)} м.`
        : '.');
  return {
    code: 'site-too-small',
    site: { width: recipe.width, length: recipe.length },
    usable,
    smallest: {
      type: smallest.type, length: smallest.long, width: smallest.short, ...(smallest.runOff ? { runOff: smallest.runOff } : {}),
    },
    clearance: ZONE_PAD,
    turnRadius: radius,
    message: head + tail,
  };
}

/**
 * Deterministic course for a recipe and seed. When the requested number of
 * elements does not fit, it is simplified: rebuilt with the same seed and one
 * element fewer until it fits, so (N, seed) simplified to K equals (K, seed).
 * A closed course, and one whose finish is by the start, is first sought with
 * a loop-free closing connector at every
 * size; only when none fits is the search repeated with the looser limit, and
 * only when none fits with either is it repeated trying every allowed type per
 * element. The equality still holds: every earlier build for K or fewer
 * already failed.
 *
 * A course has at most one big element, so when every usable type is big even
 * at its most compact sizes it has one element whatever was ordered; it says
 * so in `limitedBy`. Building from one directly is the same as simplifying
 * down to it: every larger build would fail on the rule.
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
  const limits = recipe.shape !== 'open' ? CLOSING_TURN_LIMITS : CLOSING_TURN_LIMITS.slice(0, 1);
  const onlyBig = usableTypes(recipe).every((t) => alwaysBig(t, recipe.difficulty, recipe.bike, recipe.sizes));
  const most = onlyBig ? 1 : recipe.elements;
  const limitedBy = onlyBig && recipe.elements > 1 ? { limitedBy: 'big-elements' } : {};
  for (const typeTries of TYPE_TRY_LIMITS) {
    for (const closingTurn of limits) {
      for (let k = most; k >= 1; k--) {
        const result = buildCourse(recipe, seed.seed, k, closingTurn, typeTries);
        if (result.ok) {
          return { ok: true, course: { ...result.course, requested: recipe.elements, placed: k, ...limitedBy } };
        }
      }
    }
  }
  return { ok: false, error: siteTooSmall(recipe) };
}
