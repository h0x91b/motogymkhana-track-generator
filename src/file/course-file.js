// The course file and the cone list: what «Сохранить .json» writes, what
// «Открыть .json» reads back, and what «Конусы .csv» exports (ADR 0013).
//
// A course file is the course's layout (ADR 0012) — recipe, seed and the
// elements in route order — under a header that names the format and its
// version. The elements are written for every course, edited or not: a seed
// repeats a course only within one build (ADR 0009), so a file holding only
// the recipe and seed would open as a different course after the next deploy.
// Nothing here touches the DOM; the app only downloads and picks the files.

import { parseLayout } from '../generator/layout.js';
import { parseRecipe, parseSeed } from '../generator/recipe.js';
import { buildSetupSheet } from '../sheet/setup-sheet.js';
import { TYPE_NAMES, typeAxes } from '../generator/catalog.js';

export const COURSE_FILE_FORMAT = 'motogymkhana-course';
/**
 * The newest version this build reads and writes. Raised on a change an older
 * build cannot read; a reader refuses a newer version instead of half-opening
 * it. A file is written with the oldest version that can read it: 2 only for
 * a course with an element turned off the 45° lattice (ADR 0019), 1 otherwise.
 */
export const COURSE_FILE_VERSION = 2;

/** Is an axis one that version 1 knew: whole 45° steps, and only side axes for a side-only type? */
const firstVersionAxis = (e) => typeAxes(e.type).includes(e.axis);

/**
 * The document of a course file for a layout.
 * @param {object} layout `{recipe, seed, elements, start?, finish?}` (layoutOf or the editor's)
 * @param {{build?: string, edited?: boolean}} meta which build saved it, and whether the course was edited by hand
 */
export function courseDocument(layout, { build = '', edited = false } = {}) {
  return {
    format: COURSE_FILE_FORMAT,
    version: layout.elements.every(firstVersionAxis) ? 1 : COURSE_FILE_VERSION,
    build,
    edited,
    recipe: layout.recipe,
    seed: layout.seed,
    elements: layout.elements.map((e) => ({
      type: e.type,
      sizes: e.sizes,
      axis: e.axis,
      mirrored: e.mirrored,
      x: e.x,
      y: e.y,
      ...(e.pivot ? { pivot: e.pivot } : {}),
      // Margins the element sets for itself in «Правка» (ADR 0014).
      ...(e.safety ? { safety: { ...e.safety } } : {}),
    })),
    // A start or finish put by hand in «Правка»; without one it follows the first or the last element.
    // An older build skips these and opens the course with them where the generator puts them, so the version stays.
    ...Object.fromEntries(['start', 'finish'].filter((k) => layout[k]).map((k) => [k, { ...layout[k] }])),
  };
}

/** The file text: indented, one key per line, readable and diffable by hand. */
export const courseFileText = (doc) => `${JSON.stringify(doc, null, 2)}\n`;

const fail = (error) => ({ ok: false, error });

/**
 * A course file read back.
 *
 * With elements it is a layout, returned whole: the app shows exactly those
 * elements. Without them (a file written by hand, recipe and seed only) the
 * layout is null and the course is whatever this build generates for them.
 *
 * @returns {{ok: true, layout: object|null, recipe: object, seed: number, edited: boolean, build: string}
 *   | {ok: false, error: string}} the error is a sentence for the user
 */
export function readCourseFile(text) {
  let doc;
  try {
    doc = JSON.parse(String(text).replace(/^\uFEFF/, ''));
  } catch {
    return fail('Это не файл трассы: внутри не JSON');
  }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc) || doc.format !== COURSE_FILE_FORMAT) {
    return fail('Это не файл трассы мотоджимханы');
  }
  if (!Number.isInteger(doc.version) || doc.version < 1) return fail('В файле трассы нет версии формата');
  if (doc.version > COURSE_FILE_VERSION) return fail('Файл сохранён более новой версией приложения: обновите страницу и откройте его снова');
  const build = typeof doc.build === 'string' ? doc.build : '';
  if (doc.elements === undefined) {
    const recipe = parseRecipe(doc.recipe);
    if (!recipe.ok || !Number.isInteger(doc.seed) || !parseSeed(doc.seed).ok) return fail('В файле трассы неверный рецепт или seed');
    return { ok: true, layout: null, recipe: recipe.recipe, seed: doc.seed, edited: false, build };
  }
  // parseLayout takes any integer seed; a file must hold one the form can show.
  const layout = parseSeed(doc.seed).ok && Number.isInteger(doc.seed) ? parseLayout(doc) : null;
  if (!layout) return fail('Файл трассы испорчен: элементы, рецепт или seed не читаются');
  return { ok: true, layout, recipe: layout.recipe, seed: layout.seed, edited: doc.edited === true, build };
}

/** Bytes; a course file is a few kilobytes, anything far bigger is not one. */
export const COURSE_FILE_MAX = 1_000_000;

/** readCourseFile for text from anywhere (a pasted clipboard), with the size check of a file. */
export function readCourseText(text) {
  if (String(text).length > COURSE_FILE_MAX) return fail('Это не файл трассы: он слишком большой');
  return readCourseFile(text);
}

/**
 * A picked or dropped file read as a course file: what «Открыть .json» and a
 * drop on the page share. `file` is a File or Blob (anything with size and text()).
 */
export async function readCourseUpload(file) {
  if (!file) return fail('Это не файл трассы');
  if (file.size > COURSE_FILE_MAX) return fail('Это не файл трассы: он слишком большой');
  let text;
  try {
    text = await file.text();
  } catch {
    return fail('Не удалось прочитать файл');
  }
  return readCourseFile(text);
}

/** File names without spaces or Cyrillic: messengers and file systems keep them as they are. */
export function courseFileName(recipe, seed, ext) {
  const what = ext === 'csv' ? 'konusy' : 'trassa';
  return `motogymkhana-${what}-${recipe.width}x${recipe.length}-seed-${seed}.${ext}`;
}

// ---------------------------------------------------------------- cone list

const CSV_HEAD = ['№', 'Где', '№ в элементе', 'Высота', 'Цвет', 'X, м', 'Y, м'];
const HEIGHT = { tall: 'высокий', low: 'низкий' };
const COLOUR = { blue: 'синий (слева)', red: 'красный (справа)', neutral: 'любой' };

/** Metres to 0.1 m with a decimal comma, as the setup sheet writes them. */
const decimetres = (v) => (Math.round(v * 10) / 10 + 0).toFixed(1).replace('.', ',');

const cell = (v) => {
  const s = String(v);
  return /[";\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
};

/**
 * The cone list as CSV: one row per physical cone in the order the course is
 * laid out — the start, then each element with the U-turn cones of the
 * connector leaving it, then the finish. X and Y are measured from the
 * reference corner, to 0.1 m. «№ в элементе» is the cone's number in the
 * element card's table.
 *
 * Semicolons and decimal commas, with a byte-order mark: that is what a
 * spreadsheet in a Russian locale opens straight into columns.
 */
export function conesCsv(course, sheet = buildSetupSheet(course)) {
  const byId = new Map(course.cones.map((c) => [c.id, c]));
  const done = new Set();
  const rows = [];
  const add = (id, where, n, colour) => {
    if (done.has(id)) return;
    done.add(id);
    const c = byId.get(id);
    rows.push([rows.length + 1, where, n, HEIGHT[c.height], COLOUR[c.height === 'tall' ? colour : 'neutral'], decimetres(c.hx / 2), decimetres(c.hy / 2)]);
  };
  const closed = course.route.shape === 'closed';
  const where = closed ? 'Старт и финиш' : course.route.shape === 'return' ? 'Коробка старта и финиша' : 'Старт';
  for (const id of course.route.start.cones) add(id, where, '', 'neutral');
  const orderOf = new Map(course.elements.map((e) => [e.id, e.order]));
  course.elements.forEach((e, i) => {
    const card = sheet.cards[i];
    e.cones.forEach((id, k) => add(id, `${e.order}. ${TYPE_NAMES[e.type]}`, card.cones[k].n, card.cones[k].color));
    for (const t of card.turnCones) {
      const pass = course.passes.find((p) => p.cone === t.cone && p.connector);
      const to = pass.connector.to === 'finish' ? (closed ? 'старт' : 'финиш') : orderOf.get(pass.connector.to);
      const from = pass.connector.from === 'start' ? 'старт' : e.order;
      add(t.cone, `Связка ${from} → ${to}: конус разворота`, '', t.color);
    }
  });
  if (!closed) for (const id of course.route.finish.cones) add(id, 'Финиш', '', 'neutral');
  // Anything the course has and the passes above missed still gets a row.
  for (const c of course.cones) add(c.id, '—', '', 'neutral');
  return `\uFEFF${[CSV_HEAD, ...rows].map((r) => r.map(cell).join(';')).join('\r\n')}\r\n`;
}
