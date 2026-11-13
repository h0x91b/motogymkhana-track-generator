// «Правка»: the course editor. It holds the layout being edited with its undo
// history, draws the edit panel and the type picker, and hands every new course
// back to the app. What an edit does to a course is decided in
// generator/layout.js; nothing here knows how a course is routed.

import {
  addBlocked, applyRecipe, axisDegrees, canonicalJSON, blockedMarginOf, BLOCKED_MAX, BLOCKED_NAMES, ELEMENT_TYPES, ELEMENTS_MAX, elementControls, elementSafety, insertElement, layoutOf, LOOPED_TYPES, mirrorElement, moveBlocked, moveElement, problemsWord,
  removeBlocked, removeElement, replaceElement, resetTerminal, resizeBlocked, resizeBlockedSide, resizeElement, rotateElement, routeLayout, safetyValues, setBlockedMargin, setElementSafety, setElementSize, shiftElement,
  freeHeading, insertWaypoint, SINGLE_CONE_TYPES, WAYPOINT, terminalPose, terminalsOf, turnElementTo, turnStep, TYPE_NAMES,
} from '../generator/index.js';

const UNDO_MAX = 100;
/** What the card says instead of an angle for a type whose heading the route chooses (ADR 0027). */
const FREE_NOTES = {
  'pass-left': 'проезд с любой стороны подхода, конус слева; если нужно — с разворотом вокруг него до 225°',
  'pass-right': 'проезд с любой стороны подхода, конус справа; если нужно — с разворотом вокруг него до 225°',
  'small-turn': 'заход с любой стороны подхода, разворот вокруг конуса на 135–225°',
  waypoint: 'конуса нет: маршрут проходит через точку, подход с любой стороны',
};
/** The type the picker offers first for an inserted element. */
const SUGGESTED_INSERT = 'gate';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

// One icon set, drawn in the text colour of its button.
const ICONS = {
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
  redo: '<path d="m15 14 5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>',
  left: '<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>',
  up: '<path d="m5 12 7-7 7 7"/><path d="M12 19V5"/>',
  down: '<path d="M12 5v14"/><path d="m19 12-7 7-7-7"/>',
  right: '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
  ccw: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>',
  cw: '<path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/>',
  mirror: '<path d="m3 7 5 5-5 5V7"/><path d="m21 7-5 5 5 5V7"/><path d="M12 20v2"/><path d="M12 14v2"/><path d="M12 8v2"/><path d="M12 2v2"/>',
  plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
  minus: '<path d="M5 12h14"/>',
};
const icon = (name) => `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${ICONS[name]}</svg>`;

const plural = (n, one, few, many) => (n % 10 === 1 && n % 100 !== 11 ? one : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100) ? few : many);
const comma = (v) => String(Math.round(v * 10) / 10).replace('.', ',');
/** Text as the panel sets it: a dash never starts a line. */
const tied = (s) => s.replace(/ —/g, '\u00a0—');

/** A size as the panel prints it: metres with a decimal comma, a count, an angle. */
function sizeText(c) {
  if (c.kind === 'count') return String(c.value);
  if (c.kind === 'choice') return `${c.value}°`;
  return `${comma(c.value)}\u00a0м`;
}

/** A size in metres — a length or a radius — is a field: type a value, or step it with − and +. */
const metric = (c) => c.kind === 'length' || c.kind === 'radius';
const sizeFieldId = (key) => `edit-size-${key}`;
function sizeInput(c) {
  return `<span class="size-field"><input id="${sizeFieldId(c.key)}" data-size="${c.key}" inputmode="decimal" autocomplete="off" enterkeyhint="done" value="${comma(c.value)}" aria-label="${esc(c.name)}, м"><span aria-hidden="true">м</span></span>`;
}

/** A safety margin as the panel prints it: «нет» for a rule switched off. */
const marginText = (v) => (v > 0 ? `${String(v).replace('.', ',')}\u00a0м` : 'нет');

/** A blocked area's margin as the panel says it: «отступ 2 м», or «… как край площадки» when it keeps the lot's. */
const blockedMarginText = (m) => `отступ ${marginText(m.value)}${m.own ? '' : ', как край площадки'}`;

/** The values one step down and up from a margin's, or null at an end. */
function marginSteps(m) {
  const values = safetyValues(m.option);
  const at = values.findIndex((v) => Math.abs(v - m.value) < 1e-9);
  return { less: at > 0 ? values[at - 1] : null, more: at >= 0 && at < values.length - 1 ? values[at + 1] : null };
}

/** The recipe and seed of a layout: the form changes them on an edited course (`applyRecipe`), the blocked areas «Правка» too. */
const recipeOf = (layout) => canonicalJSON({ recipe: layout.recipe, seed: layout.seed });
const elementsOf = (layout) => JSON.stringify([layout.elements, recipeOf(layout), layout.start, layout.finish]);
const unpivoted = (t) => (t ? (({ pivot, ...rest }) => rest)(t) : null);
/** The elements and the start and finish without the pivots turning leaves behind, and the recipe: two layouts with the same ones give the same course. */
const courseOf = (layout) => JSON.stringify([layout.elements.map(unpivoted), recipeOf(layout), unpivoted(layout.start), unpivoted(layout.finish)]);

/** Is `i` the start or the finish rather than an element's index? */
const isTerm = (i) => i === 'start' || i === 'finish';

const capital = (s) => s[0].toUpperCase() + s.slice(1);
/** «Вырез 1», «Препятствие 2»: blocked areas are numbered in the recipe's list. */
const blockedTitle = (layout, k) => `${capital(BLOCKED_NAMES[layout.recipe.blocked[k].kind])} ${k + 1}`;

// Arrow keys and the move buttons: one metre across the plan.
const NUDGES = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] };

/**
 * @param host what the editor needs from the app:
 *   show(course, problems, {dragging}) — the course to draw now;
 *   reveal(id) — an element was picked in the panel: bring it into view on the plan;
 *   leave() — «Готово»;
 *   facts(id) — {head, tail}: HTML of what the element's row says and cannot change (anchor, axis; notes, cone table);
 *   modal(open) — the type picker opened or closed: everything behind it goes inert;
 *   blocked(recipe) — the layout's blocked areas changed (an edit, undo or redo): the recipe now has these.
 */
export function createEditor(host) {
  const body = $('edit-body');
  const live = $('edit-live');
  let base = null; // the layout of the generated course the edits started from
  let layout = null;
  let routed = null; // { course, problems } of `layout`
  let selected = null; // index of the selected element
  let block = null; // index of the selected blocked area; never both at once
  let term = null; // 'start' or 'finish' when that is selected instead of an element or a blocked area
  let undo = []; // { layout, selected }: what an undo goes back to, with the element that was being edited
  let redo = [];
  let drag = null; // { from, i, x, y }: the layout and the anchor an element is dragged from
  let active = false;
  let picker = null; // 'replace' | 'insert' while the type picker is open
  let pickerAt = 0; // where in the route an inserted element goes
  let shownSelected = null; // the selection the list was last scrolled to
  let problemAt = 0; // which problem a phone shows
  let problemsKey = ''; // the problems it was counted in

  $('edit-undo').innerHTML = icon('undo');
  $('edit-redo').innerHTML = icon('redo');
  // The keys as this keyboard names them.
  const mod = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl+';
  $('edit-undo').title = `Отменить правку (${mod}Z)`;
  $('edit-redo').title = `Вернуть правку (${mod}Shift+Z)`;
  $('edit-keys').textContent = tied(`Стрелки — сдвинуть на 1\u00a0м, с\u00a0Shift — на 5\u00a0м · R — повернуть · Delete — удалить · ${mod}Z — отменить`);

  const idOf = (i) => (i === null ? null : `e${i + 1}`);
  const blockOf = (id) => {
    const k = typeof id === 'string' && id[0] === 'b' ? Number(id.slice(1)) - 1 : NaN;
    return Number.isInteger(k) && layout && k >= 0 && k < layout.recipe.blocked.length ? k : null;
  };
  const indexOf = (id) => {
    const i = id && id[0] === 'e' ? Number(id.slice(1)) - 1 : NaN;
    return Number.isInteger(i) && layout && i >= 0 && i < layout.elements.length ? i : null;
  };
  const termOf = (id) => (layout && (id === 'start' || id === 'finish') && terminalsOf(layout).includes(id) ? id : null);
  const name = (i) => TYPE_NAMES[layout.elements[i].type];
  /** «Старт · финиш» for a course that finishes on its start, «Старт» and «Финиш» for an open one. */
  const termTitle = (which) => (which === 'finish' ? 'Финиш' : layout.recipe.shape === 'open' ? 'Старт' : 'Старт · финиш');
  /** What an announcement calls the thing being edited. */
  const subject = () => (term ? termTitle(term) : `Элемент ${selected + 1}`);
  /** The element index, or 'start' / 'finish': what the layout's move and turn functions take. */
  const target = () => term ?? selected;
  /** The axis of what is being edited, in 45° steps. */
  const currentAxis = () => (term ? terminalPose(layout, term).axis : layout.elements[selected].axis);
  /** Is a problem about the start (or the finish of an open course): the line, or the connector out of or back into it? */
  const termProblem = (p, which) => {
    const n = layout.elements.length;
    if (which === 'finish') return p.code.startsWith('finish') || p.connector === n;
    return p.code.startsWith('start') || p.connector === 0 || p.code === 'finish-overlap' || (layout.recipe.shape !== 'open' && p.connector === n);
  };
  const say = (text) => (live.textContent = text);
  const sizeField = (key) => $(sizeFieldId(key));

  /** What the problems are now, for the end of an announcement. */
  function problemsNote(before) {
    const n = routed.problems.length;
    if (n) return ` ${problemsWord(n)[0].toUpperCase()}${problemsWord(n).slice(1)}.`;
    return before ? ' Проблем больше нет.' : '';
  }

  function show(dragging = false) {
    // The form first: the summary the course is shown with reads it.
    if (!dragging) host.recipe(layout);
    host.show(routed.course, routed.problems, { dragging });
  }

  /** Makes `next` the layout, with the old one to undo back to. */
  function commit(next, sel, text, nextBlock = null) {
    if (elementsOf(next) === elementsOf(layout)) return false;
    const before = routed.problems.length;
    undo.push({ layout, selected, block, term });
    if (undo.length > UNDO_MAX) undo.shift();
    redo = [];
    layout = next;
    selected = isTerm(sel) ? null : sel;
    block = nextBlock;
    term = isTerm(sel) ? sel : null;
    routed = routeLayout(layout);
    show();
    render();
    say(text + problemsNote(before));
    return true;
  }

  function step(from, to, text) {
    if (!from.length || drag) return;
    const before = routed.problems.length;
    to.push({ layout, selected, block, term });
    ({ layout, selected, block = null, term = null } = from.pop());
    routed = routeLayout(layout);
    show();
    render();
    say(text + problemsNote(before));
  }

  /** Selects element i, blocked area k, or with i = 'start' / 'finish' that line. */
  function select(i, k = null) {
    const t = isTerm(i) ? i : null;
    const el = t ? null : i;
    const b = el === null && t === null ? k : null;
    if (el === selected && t === term && b === block) return;
    selected = el;
    term = t;
    block = b;
    show();
    render();
  }

  function nudge(dx, dy) {
    if (block !== null) {
      const b = layout.recipe.blocked[block];
      const next = moveBlocked(layout, block, b.x + dx, b.y + dy);
      const to = next.recipe.blocked[block];
      if (!commit(next, null, `${blockedTitle(layout, block)}: X ${to.x}, Y ${to.y}\u00a0м.`, block)) say('Дальше край площадки: осталось на месте.');
      return;
    }
    if (term) {
      const p = terminalPose(layout, term);
      const next = moveElement(layout, term, p.x + dx, p.y + dy);
      const to = next[term];
      if (!commit(next, term, `${termTitle(term)}: первый конус X ${to.x}, Y ${to.y} м.`)) say('Дальше край площадки: осталось на месте.');
      return;
    }
    if (selected === null) return;
    const el = layout.elements[selected];
    const next = moveElement(layout, selected, el.x + dx, el.y + dy);
    const to = next.elements[selected];
    if (!commit(next, selected, `Элемент ${selected + 1}: якорь X ${to.x}, Y ${to.y} м.`)) say('Дальше край площадки: элемент остался на месте.');
  }

  const ACTIONS = {
    select: (arg) => {
      // The open row closes on a second tap.
      const i = isTerm(arg) ? arg : Number(arg);
      select(i === target() ? null : i);
      if (target() !== null) host.reveal(term ?? idOf(selected));
    },
    // A blocked area's row in the list: opens it; a second tap closes it.
    selectBlocked: (arg) => select(null, Number(arg) === block ? null : Number(arg)),
    resetTerminal: () => commit(resetTerminal(layout, term), term, term === 'finish' ? `Финиш снова за элементом ${layout.elements.length}.` : `${termTitle(term)} снова перед элементом 1.`),
    nudge: (arg) => nudge(...arg.split(',').map(Number)),
    rotate: (arg) => {
      const what = subject();
      if (!term && freeHeading(layout.elements[selected].type)) {
        say(`${what} не поворачивается: ${FREE_NOTES[layout.elements[selected].type]}.`);
        return;
      }
      const next = rotateElement(layout, target(), Number(arg));
      const axis = term ? next[term].axis : next.elements[selected].axis;
      commit(next, target(), `${what} повёрнут на ${comma(axisDegrees(axis))}°.`);
    },
    /** A typed angle: the nearest orientation the element can be turned to (22.5° steps); the field says where the element went. */
    angle: (text) => {
      const typed = Number(String(text).trim().replace(',', '.').replace(/°$/, ''));
      const field = $('edit-angle');
      const now = comma(axisDegrees(currentAxis()));
      const what = subject();
      if (String(text).trim() === '' || !Number.isFinite(typed)) {
        if (field) field.value = now;
        say(`Поворот — число градусов. ${what} стоит на ${now}°.`);
        return;
      }
      const next = turnElementTo(layout, target(), typed);
      const to = axisDegrees(term ? terminalPose(next, term).axis : next.elements[selected].axis);
      const snapped = ((typed % 360) + 360) % 360 === to ? '' : ` — ближайшее к ${comma(typed)}° с шагом ${comma(term ? 22.5 : turnStep(layout.elements[selected].type))}°`;
      if (!commit(next, target(), `${what} повёрнут на ${comma(to)}°${snapped}.`)) {
        if (field) field.value = now;
        say(`${what} уже стоит на ${now}°${snapped}.`);
      }
    },
    mirror: () => {
      const next = mirrorElement(layout, selected);
      const type = next.elements[selected].type;
      // A cone passed on one side mirrors into the cone passed on the other.
      commit(next, selected, type !== layout.elements[selected].type ? `Элемент ${selected + 1} отражён: теперь «${TYPE_NAMES[type]}».` : `Элемент ${selected + 1} отражён: повороты в другую сторону.`);
    },
    size: (arg) => {
      const [key, dir] = arg.split(':');
      const control = elementControls(layout, selected).find((c) => c.key === key);
      if (!control[dir]) return;
      const next = resizeElement(layout, selected, control[dir]);
      const now = elementControls(next, selected).find((c) => c.key === key);
      commit(next, selected, `${now.name}: ${sizeText(now)}.`);
    },
    /** A typed size in metres: the nearest the type allows; the field says what the element got. */
    typedSize: (arg) => {
      const [key, text] = [arg.slice(0, arg.indexOf(':')), arg.slice(arg.indexOf(':') + 1)];
      const before = elementControls(layout, selected).find((c) => c.key === key);
      const typed = Number(String(text).trim().replace(',', '.').replace(/\s*м$/, ''));
      const field = sizeField(key);
      if (String(text).trim() === '' || !Number.isFinite(typed)) {
        if (field) field.value = comma(before.value);
        say(`${before.name} — число метров. Сейчас ${sizeText(before)}.`);
        return;
      }
      const next = setElementSize(layout, selected, key, typed);
      const now = elementControls(next, selected).find((c) => c.key === key);
      const snapped = Math.abs(now.value - typed) < 0.05 ? '' : ` — ближайшее допустимое к ${comma(typed)}\u00a0м`;
      if (!commit(next, selected, `${now.name}: ${sizeText(now)}${snapped}.`)) {
        if (field) field.value = comma(before.value);
        say(`${before.name} уже ${sizeText(before)}${snapped}.`);
      }
    },
    shift: (arg) => {
      const to = selected + Number(arg);
      if (to < 0 || to >= layout.elements.length) return;
      commit(shiftElement(layout, selected, Number(arg)), to, `«${name(selected)}» теперь ${to + 1}-й по маршруту.`);
    },
    remove: () => {
      if (block !== null) {
        commit(removeBlocked(layout, block), null, `${blockedTitle(layout, block)} убран.`);
        return;
      }
      if (layout.elements.length <= 1) return;
      const text = `Элемент ${selected + 1}, «${name(selected)}», удалён. Осталось элементов: ${layout.elements.length - 1}.`;
      commit(removeElement(layout, selected), null, text);
    },
    margin: (arg) => {
      const [key, dir] = arg.split(':');
      const m = elementSafety(layout, selected).find((s) => s.key === key);
      const value = dir === 'recipe' ? null : marginSteps(m)[dir];
      if (value === undefined || (value === null && dir !== 'recipe')) return;
      const next = setElementSafety(layout, selected, key, value);
      const now = elementSafety(next, selected).find((s) => s.key === key);
      commit(next, selected, `${now.name}: ${marginText(now.value)}${now.own ? '' : ', как в рецепте'}.`);
    },
    replace: () => openPicker('replace'),
    // A new element under the selected one («＋» in its row), or before it («Вставить первым»).
    insert: (arg) => openPicker('insert', selected + (arg === 'after' ? 1 : 0), 'insert', arg),
    addBlocked: (kind) => {
      const next = addBlocked(layout, kind);
      const k = next.recipe.blocked.length - 1;
      commit(next, null, `${blockedTitle(next, k)} добавлен: перетащите его на место.`, k);
    },
    blockedSize: (arg) => {
      const [key, d] = arg.split(':');
      const b = layout.recipe.blocked[block];
      const next = resizeBlocked(layout, block, b.w + (key === 'w' ? Number(d) : 0), b.h + (key === 'h' ? Number(d) : 0));
      const to = next.recipe.blocked[block];
      commit(next, null, `${blockedTitle(layout, block)}: ${to.w} × ${to.h}\u00a0м.`, block);
    },
    /** A typed size of the selected blocked area: whole metres, kept on the lot; the field says what it got. */
    typedBlockedSize: (arg) => {
      const [key, text] = [arg.slice(0, arg.indexOf(':')), arg.slice(arg.indexOf(':') + 1)];
      const b = layout.recipe.blocked[block];
      const typed = Number(String(text).trim().replace(',', '.').replace(/\s*м$/, ''));
      const field = $(`edit-blocked-${key}`);
      if (String(text).trim() === '' || !Number.isFinite(typed)) {
        if (field) field.value = String(b[key]);
        say(`${key === 'w' ? 'По X' : 'По Y'} — число метров. Сейчас ${b[key]}\u00a0м.`);
        return;
      }
      const next = resizeBlocked(layout, block, key === 'w' ? typed : b.w, key === 'h' ? typed : b.h);
      const to = next.recipe.blocked[block];
      const snapped = to[key] === typed ? '' : ` — ближайшее допустимое к ${comma(typed)}\u00a0м`;
      if (!commit(next, null, `${blockedTitle(layout, block)}: ${to.w} × ${to.h}\u00a0м${snapped}.`, block) && field) field.value = String(to[key]);
    },
    /** The selected area's own margin a step down or up, or back to the lot edge margin (`edge`). */
    blockedMargin: (dir) => {
      const m = blockedMarginOf(layout, block);
      const value = dir === 'edge' ? null : marginSteps(m)[dir];
      if (value === undefined || (value === null && dir !== 'edge')) return;
      const next = setBlockedMargin(layout, block, value);
      commit(next, null, `${blockedTitle(layout, block)}: ${blockedMarginText(blockedMarginOf(next, block))}.`, block);
    },
    /** A typed margin for the selected area: the nearest step from 0 to 3 m; the field says what it got. */
    typedBlockedMargin: (text) => {
      const before = blockedMarginOf(layout, block);
      const field = $('edit-blocked-margin');
      const typed = Number(String(text).trim().replace(',', '.').replace(/\s*м$/, ''));
      if (String(text).trim() === '' || !Number.isFinite(typed)) {
        if (field) field.value = comma(before.value);
        say(`Отступ — число метров от 0 до 3. Сейчас ${blockedMarginText(before)}.`);
        return;
      }
      const next = setBlockedMargin(layout, block, typed);
      const now = blockedMarginOf(next, block);
      const snapped = Math.abs(now.value - typed) < 1e-9 ? '' : ` — ближайшее допустимое к ${comma(typed)}\u00a0м`;
      if (!commit(next, null, `${blockedTitle(layout, block)}: ${blockedMarginText(now)}${snapped}.`, block)) {
        if (field) field.value = comma(before.value);
        say(`${blockedTitle(layout, block)}: уже ${blockedMarginText(before)}${snapped}.`);
      }
    },
    // Back to the generated course; undo brings the edits back.
    reset: () => commit(base, null, 'Правки сброшены: трасса снова как от генератора.'),
  };

  // ---------------------------------------------------------------- panel

  /**
   * The problems, under the controls and never among them: one appearing must
   * not push a button from under a finger. Those of the selected element come
   * first. On a phone one is shown at a time, with a button to the next, and
   * the mark with the count stands in for the heading.
   */
  function renderProblems() {
    const box = $('edit-problems');
    const own = (p) => (term ? termProblem(p, term) : selected !== null && p.elements.includes(idOf(selected)));
    const problems = [...routed.problems.filter(own), ...routed.problems.filter((p) => !own(p))];
    box.hidden = !problems.length;
    if (!problems.length) {
      box.replaceChildren();
      problemsKey = '';
      return problems;
    }
    // A different set of problems starts from its first one.
    const key = JSON.stringify([target(), problems.map((p) => p.text)]);
    if (key !== problemsKey) problemAt = 0;
    problemsKey = key;
    problemAt %= problems.length;
    const many = problems.length > 1;
    const items = problems.map((p, i) => `<li${i === problemAt ? ' class="current"' : ''}>${esc(tied(p.text))}</li>`).join('');
    const next = many ? `<button type="button" id="problem-next" aria-label="Следующая проблема">${icon('right')}</button>` : '';
    const count = many ? `<span class="problems-count"><span class="problems-at">${problemAt + 1} из </span>${problems.length}</span>` : '';
    const title = `<p class="problems-title"><span class="mark" aria-hidden="true">!</span><span class="problems-word">${many ? 'Проблемы' : 'Проблема'}</span>${count}</p>`;
    box.innerHTML = `<div class="problems-text">${title}<ul>${items}</ul></div>${next}`;
    return problems;
  }

  /** «6 конусов · 3 м»: the sizes of element i at a glance, for its row. */
  function sizesSummary(i) {
    return elementControls(layout, i).map((c) => (c.kind === 'count' ? `${c.value} ${plural(c.value, 'конус', 'конуса', 'конусов')}` : sizeText(c))).join(' · ');
  }

  /**
   * The route as a list, one row an element in riding order: its number,
   * type, sizes and problem mark, with the buttons to move it earlier or later
   * in the route and to insert a new element under it. The selected row opens
   * with everything else the element can be told (`elementHtml`).
   */
  function listHtml() {
    const wrong = new Set(routed.problems.flatMap((p) => p.elements));
    const n = layout.elements.length;
    const full = n >= ELEMENTS_MAX;
    const fullTitle = full ? ` disabled title="На трассе не больше ${ELEMENTS_MAX} элементов"` : '';
    const finish = terminalsOf(layout).includes('finish') ? terminalRowHtml('finish') : '';
    const rows = layout.elements.map((el, i) => {
      const bad = wrong.has(idOf(i));
      const open = i === selected;
      const typeName = esc(TYPE_NAMES[el.type]);
      const rowTool = (act, arg, label, glyph, off) => `<button type="button" class="row-tool" data-act="${act}" data-arg="${arg}" data-row="${i}" aria-label="${label}" title="${label}"${off}>${icon(glyph)}</button>`;
      return `<li class="el-row${open ? ' open' : ''}${bad ? ' bad' : ''}">
        <div class="el-head">
          <button type="button" class="el-pick" data-act="select" data-arg="${i}" aria-expanded="${open}" aria-label="${i + 1}. ${typeName}${bad ? ', есть проблема' : ''}">`
        + `<b class="el-num">${i + 1}</b><span class="el-text"><span class="el-name">${typeName}</span><span class="el-sum">${esc(sizesSummary(i))}</span></span>${bad ? '<span class="mark" aria-hidden="true">!</span>' : ''}</button>
          ${rowTool('shift', '-1', `Элемент ${i + 1} раньше по маршруту`, 'up', i === 0 ? ' disabled' : '')}${rowTool('shift', '1', `Элемент ${i + 1} позже по маршруту`, 'down', i === n - 1 ? ' disabled' : '')}${rowTool('insert', 'after', `Вставить новый элемент под элементом ${i + 1}`, 'plus', full ? fullTitle : '')}
        </div>${open ? `<div class="el-detail">${elementHtml()}</div>` : ''}
      </li>`;
    }).join('');
    const first = `<button type="button" class="link insert-first" data-act="insert" data-arg="before" data-row="0"${fullTitle}>${icon('plus')}Вставить первым</button>`;
    return `<div class="list-head"><span class="muted">${n} ${plural(n, 'элемент', 'элемента', 'элементов')} по порядку</span>${first}</div><ol class="edit-list" aria-label="Элементы по порядку маршрута">${terminalRowHtml('start')}${rows}${finish}</ol>`;
  }

  /**
   * The start (row 0) or an open course's finish (after the last element): it
   * opens into its editor like an element's row, but stays where it is in the
   * route — nothing moves it up or down, removes it or goes before the start.
   */
  function terminalRowHtml(which) {
    const open = term === which;
    const bad = routed.problems.some((p) => termProblem(p, which));
    const title = termTitle(which);
    const p = terminalPose(layout, which);
    const kind = which === 'start' && layout.recipe.shape === 'return' ? 'коробка' : 'линия';
    const sum = `${kind} · ${comma(axisDegrees(p.axis))}°${p.pinned ? ' · вручную' : ''}`;
    return `<li class="el-row terminal-row${open ? ' open' : ''}${bad ? ' bad' : ''}">
        <div class="el-head">
          <button type="button" class="el-pick" data-act="select" data-arg="${which}" aria-expanded="${open}" aria-label="${title}${bad ? ', есть проблема' : ''}">`
      + `<b class="el-num">${which === 'start' ? 0 : '⚑'}</b><span class="el-text"><span class="el-name">${title}</span><span class="el-sum">${esc(sum)}</span></span>${bad ? '<span class="mark" aria-hidden="true">!</span>' : ''}</button>
        </div>${open ? `<div class="el-detail">${terminalHtml()}</div>` : ''}
      </li>`;
  }

  /** The start's or finish's editor: where its first cone stands, moving, turning in 22.5° steps and the typed angle. */
  function terminalHtml() {
    const p = terminalPose(layout, term);
    const tool = (act, arg, label, glyph) => `<button type="button" data-act="${act}" data-arg="${arg}" aria-label="${label}" title="${label}">${icon(glyph)}</button>`;
    const back = term === 'finish' ? `за элемент ${layout.elements.length}` : 'перед элементом 1';
    const angle = `<div class="size-row angle-row">
        <span class="size-name"><label for="edit-angle">Поворот, °</label><span class="angle-note muted" id="edit-angle-note">${tied('кратно 22,5°, 0° — вдоль ширины')}<span class="sr-only">, против часовой стрелки</span></span></span>
        <span class="angle-field"><input id="edit-angle" inputmode="decimal" autocomplete="off" enterkeyhint="done" value="${comma(axisDegrees(p.axis))}" aria-describedby="edit-angle-note"><span aria-hidden="true">°</span></span>
      </div>`;
    const hint = p.pinned ? '' : `<p class="edit-hint muted">${tied(`Сейчас стоит ${back} и ходит за ним. Сдвинутый или повёрнутый, остаётся там, куда поставлен.`)}</p>`;
    return `<div class="el-facts"><p class="anchor">Первый конус: X ${comma(p.x)} м · Y ${comma(p.y)} м</p></div>${hint}
      <div class="edit-tools">
        <span class="tool-group" role="group" aria-label="Сдвинуть">
          ${tool('nudge', '-1,0', 'Сдвинуть на 1 м влево', 'left')}${tool('nudge', '0,1', 'Сдвинуть на 1 м вверх', 'up')}${tool('nudge', '0,-1', 'Сдвинуть на 1 м вниз', 'down')}${tool('nudge', '1,0', 'Сдвинуть на 1 м вправо', 'right')}
        </span>
        <span class="tool-group" role="group" aria-label="Повернуть">
          ${tool('rotate', '1', 'Повернуть на 22,5° против часовой', 'ccw')}${tool('rotate', '-1', 'Повернуть на 22,5° по часовой', 'cw')}
        </span>
      </div>
      ${p.pinned ? `<div class="edit-actions"><button type="button" data-act="resetTerminal">Вернуть ${back}</button></div>` : ''}
      <div class="edit-sizes">${angle}</div>`;
  }

  /**
   * The lot's cutouts and obstacles, under the route: one row each, opened by
   * a tap into what can be changed (`blockedHtml`), and the buttons to add one.
   */
  function blockedListHtml() {
    const list = layout.recipe.blocked;
    const full = list.length >= BLOCKED_MAX;
    const add = (kind, label) => `<button type="button" class="link insert-first" data-act="addBlocked" data-arg="${kind}"${full ? ` disabled title="Не больше ${BLOCKED_MAX}"` : ''}>${icon('plus')}${label}</button>`;
    const rows = list.map((b, k) => {
      const open = k === block;
      const title = esc(blockedTitle(layout, k));
      return `<li class="el-row blocked-row${open ? ' open' : ''}">
        <div class="el-head">
          <button type="button" class="el-pick" data-act="selectBlocked" data-arg="${k}" aria-expanded="${open}" aria-label="${title}, ${b.w} на ${b.h} метров">`
        + `<span class="hatch ${b.kind}" aria-hidden="true"></span><span class="el-text"><span class="el-name">${title}</span><span class="el-sum">X ${b.x} · Y ${b.y} · ${b.w} × ${b.h}\u00a0м${b.margin === undefined ? '' : ` · отступ ${esc(marginText(b.margin))}`}</span></span></button>
        </div>${open ? `<div class="el-detail">${blockedHtml()}</div>` : ''}
      </li>`;
    }).join('');
    return `<div class="list-head blocked-head"><span class="muted">Вырезы и препятствия</span><span class="edit-blocked-add">${add('cutout', 'Вырез')}${add('obstacle', 'Препятствие')}</span></div>`
      + (rows ? `<ol class="edit-list" aria-label="Вырезы и препятствия">${rows}</ol>` : '');
  }

  function blockedHtml() {
    const b = layout.recipe.blocked[block];
    const tool = (act, arg, label, glyph) => `<button type="button" data-act="${act}" data-arg="${arg}" aria-label="${label}" title="${label}">${icon(glyph)}</button>`;
    const size = (key, name, value) => `<div class="size-row" role="group" aria-label="${name}">
        <span class="size-name">${name}</span>
        <button type="button" data-act="blockedSize" data-arg="${key}:-1" aria-label="${name}: меньше"${value <= 1 ? ' disabled' : ''}>${icon('minus')}</button>
        <span class="size-field"><input id="edit-blocked-${key}" data-blocked-size="${key}" inputmode="numeric" autocomplete="off" enterkeyhint="done" value="${value}" aria-label="${name}, м"><span aria-hidden="true">м</span></span>
        <button type="button" data-act="blockedSize" data-arg="${key}:1" aria-label="${name}: больше">${icon('plus')}</button>
      </div>`;
    return `<p class="edit-hint muted">Угол у «A (0,0)»: X ${b.x}, Y ${b.y}\u00a0м. Перетащите на плане или сдвиньте стрелками; от его краёв держится его отступ — пунктир вокруг.</p>
      <div class="edit-tools">
        <span class="tool-group" role="group" aria-label="Сдвинуть">
          ${tool('nudge', '-1,0', 'Сдвинуть на 1 м влево', 'left')}${tool('nudge', '0,1', 'Сдвинуть на 1 м вверх', 'up')}${tool('nudge', '0,-1', 'Сдвинуть на 1 м вниз', 'down')}${tool('nudge', '1,0', 'Сдвинуть на 1 м вправо', 'right')}
        </span>
      </div>
      <div class="edit-actions"><button type="button" class="danger" data-act="remove">Убрать</button></div>
      <div class="edit-sizes">${size('w', 'По X', b.w)}${size('h', 'По Y', b.h)}</div>
      ${blockedMarginHtml()}`;
  }

  /**
   * The selected area's own margin (ADR 0022): − and + on the lot edge
   * margin's steps, or typed; until set, the lot's, said so in the note.
   */
  function blockedMarginHtml() {
    const m = blockedMarginOf(layout, block);
    const { less, more } = marginSteps(m);
    const note = m.own
      ? `<button type="button" class="link margin-reset" data-act="blockedMargin" data-arg="edge" aria-label="Отступ: как край площадки, ${esc(marginText(m.edge))}">как край площадки</button>`
      : `<span class="margin-note muted" id="edit-blocked-margin-note">${esc(comma(m.edge))} (как край площадки)</span>`;
    return `<div class="edit-sizes edit-margins" role="group" aria-label="Отступ от краёв">
        <div class="size-row margin-row${m.own ? ' own' : ''}">
          <span class="size-name"><label for="edit-blocked-margin">Отступ, м</label>${note}</span>
          <button type="button" data-act="blockedMargin" data-arg="less" aria-label="Отступ: меньше"${less === null ? ' disabled' : ''}>${icon('minus')}</button>
          <span class="size-field"><input id="edit-blocked-margin" inputmode="decimal" autocomplete="off" enterkeyhint="done" value="${comma(m.value)}"${m.own ? '' : ' aria-describedby="edit-blocked-margin-note"'}><span aria-hidden="true">м</span></span>
          <button type="button" data-act="blockedMargin" data-arg="more" aria-label="Отступ: больше"${more === null ? ' disabled' : ''}>${icon('plus')}</button>
        </div>
      </div>`;
  }

  function elementHtml() {
    const i = selected;
    const el = layout.elements[i];
    const turn = comma(turnStep(el.type));
    const sizes = elementControls(layout, i).map((c) => `<div class="size-row" role="group" aria-label="${esc(c.name)}">
        <span class="size-name">${esc(c.name)}</span>
        <button type="button" data-act="size" data-arg="${c.key}:less" aria-label="${esc(c.name)}: меньше"${c.less ? '' : ' disabled'}>${icon('minus')}</button>
        ${metric(c) ? sizeInput(c) : `<span class="size-value">${esc(sizeText(c))}</span>`}
        <button type="button" data-act="size" data-arg="${c.key}:more" aria-label="${esc(c.name)}: больше"${c.more ? '' : ' disabled'}>${icon('plus')}</button>
      </div>`).join('');
    // The angle can be typed; whatever is typed lands on the nearest 22.5° step, 45° for a side-only type (ADR 0019).
    // A free-heading element has none: the route turns it (ADR 0027).
    const free = freeHeading(el.type);
    const angle = free ? `<p class="free-note muted">${esc(FREE_NOTES[el.type][0].toUpperCase() + FREE_NOTES[el.type].slice(1))}</p>` : `<div class="size-row angle-row">
        <span class="size-name"><label for="edit-angle">Поворот, °</label><span class="angle-note muted" id="edit-angle-note">${tied(`кратно ${turn}°, 0° — вдоль ширины`)}<span class="sr-only">, против часовой стрелки</span></span></span>
        <span class="angle-field"><input id="edit-angle" inputmode="decimal" autocomplete="off" enterkeyhint="done" value="${comma(axisDegrees(el.axis))}" aria-describedby="edit-angle-note"><span aria-hidden="true">°</span></span>
      </div>`;
    // The element's own margins: free asphalt round it, over the recipe's.
    const point = el.type === WAYPOINT;
    const margins = point ? '' : elementSafety(layout, i).map((m) => {
      const { less, more } = marginSteps(m);
      const note = m.own
        ? `<button type="button" class="link margin-reset" data-act="margin" data-arg="${m.key}:recipe" aria-label="${esc(m.name)}: как в рецепте, ${esc(marginText(m.recipe))}">как в рецепте</button>`
        : '<span class="margin-note muted">по рецепту</span>';
      return `<div class="size-row margin-row${m.own ? ' own' : ''}" role="group" aria-label="${esc(m.name)}">
        <span class="size-name">${esc(m.name)}${note}</span>
        <button type="button" data-act="margin" data-arg="${m.key}:less" aria-label="${esc(m.name)}: меньше"${less === null ? ' disabled' : ''}>${icon('minus')}</button>
        <span class="size-value">${esc(marginText(m.value))}</span>
        <button type="button" data-act="margin" data-arg="${m.key}:more" aria-label="${esc(m.name)}: больше"${more === null ? ' disabled' : ''}>${icon('plus')}</button>
      </div>`;
    }).join('');
    const tool = (act, arg, label, glyph) => `<button type="button" data-act="${act}"${arg === null ? '' : ` data-arg="${arg}"`} aria-label="${label}" title="${label}">${icon(glyph)}</button>`;
    const n = layout.elements.length;
    // Moving and the actions first: they stay where they are from one element
    // to the next. The angle and the sizes, one to three rows by type, come
    // after, then the margins. What the element is and where it stands, read only: the anchor follows from a drag or the arrows.
    const facts = host.facts?.(idOf(i)) || { head: '', tail: '' };
    return `<div class="el-facts">${facts.head}</div>
      <div class="edit-tools">
        <span class="tool-group" role="group" aria-label="Сдвинуть">
          ${tool('nudge', '-1,0', 'Сдвинуть на 1 м влево', 'left')}${tool('nudge', '0,1', 'Сдвинуть на 1 м вверх', 'up')}${tool('nudge', '0,-1', 'Сдвинуть на 1 м вниз', 'down')}${tool('nudge', '1,0', 'Сдвинуть на 1 м вправо', 'right')}
        </span>
        <span class="tool-group" role="group" aria-label="Повернуть и отразить">
          ${free ? '' : `${tool('rotate', '1', `Повернуть на ${turn}° против часовой`, 'ccw')}${tool('rotate', '-1', `Повернуть на ${turn}° по часовой`, 'cw')}`}${point ? '' : tool('mirror', null, free && el.type !== 'small-turn' ? 'Отразить: конус с другой стороны' : 'Отразить: повороты в другую сторону', 'mirror')}
        </span>
        ${facts.loops ?? ''}
      </div>
      <div class="edit-actions">
        ${point ? '' : '<button type="button" data-act="replace">Заменить</button>'}
        <button type="button" class="danger" data-act="remove"${n === 1 ? ' disabled title="Последний элемент трассы не удаляется"' : ''}>Удалить</button>
      </div>
      <div class="edit-sizes">${angle}${sizes}</div>
      ${point ? '' : `<div class="edit-sizes edit-margins" role="group" aria-label="Безопасность элемента">${margins}</div>`}
      <div class="el-facts">${facts.tail}</div>`;
  }

  function render() {
    if (!active) return;
    // The panel is rebuilt whole: keep the keyboard where it was.
    const focused = body.contains(document.activeElement) ? document.activeElement : null;
    const key = focused && [focused.dataset.act, focused.dataset.arg];
    const angleFocused = focused?.id === 'edit-angle';
    const sizeFocused = focused?.dataset.size;
    const scroll = body.scrollTop;
    // About the whole course, so it is offered with no element selected.
    const reset = courseOf(layout) === courseOf(base) ? '' : '<button type="button" class="link" data-act="reset">Сбросить все правки</button>';
    if (block !== null && block >= layout.recipe.blocked.length) block = null;
    if (term && !terminalsOf(layout).includes(term)) term = null;
    const hint = selected === null && block === null && term === null ? '<p class="edit-hint muted">Нажмите на строку или на элемент на плане, чтобы править его. Выбранный элемент перетаскивается по плану.</p>' : '';
    body.innerHTML = `${listHtml()}${blockedListHtml()}${hint}${reset}`;
    renderProblems();
    $('edit-title').textContent = selected !== null ? `${selected + 1}. ${name(selected)}` : term ? termTitle(term) : block !== null ? blockedTitle(layout, block) : 'Правка трассы';
    $('edit-undo').disabled = !undo.length;
    $('edit-redo').disabled = !redo.length;
    body.scrollTop = scroll;
    if (target() !== shownSelected) {
      shownSelected = target();
      // A newly opened row comes into view from its head down, as much of it as fits.
      const row = target() === null ? null : body.querySelector('.el-row.open');
      if (row) {
        const view = body.getBoundingClientRect();
        const box = row.getBoundingClientRect();
        if (box.top < view.top || box.bottom > view.bottom) body.scrollTop += Math.min(box.top - view.top, box.bottom - view.bottom) - 4;
        if (row.getBoundingClientRect().top < view.top) body.scrollTop += row.getBoundingClientRect().top - view.top - 4;
      }
    }
    hintMore();
    if (angleFocused && $('edit-angle')) {
      $('edit-angle').focus({ preventScroll: true });
      $('edit-angle').select();
    } else if (sizeFocused && sizeField(sizeFocused)) {
      sizeField(sizeFocused).focus({ preventScroll: true });
      sizeField(sizeFocused).select();
    } else if (key && key[0]) {
      const candidates = [...body.querySelectorAll('[data-act]')].filter((b) => b.dataset.act === key[0] && b.dataset.arg === key[1] && !b.disabled);
      // A row button follows its element to the row it moved to; a select button its own row.
      const same = key[0] === 'select' ? candidates[0]
        : candidates.find((b) => b.closest('.el-row.open')) ?? candidates.find((b) => !b.closest('.el-row'));
      const pick = body.querySelector('.el-row.open .el-pick');
      // The button is gone or at its limit: the open row, then undo, is the next thing wanted.
      const next = same ?? pick ?? [$('edit-undo'), $('edit-done')].find((b) => !b.disabled);
      next.focus({ preventScroll: true });
    }
  }

  /** Controls under the fold fade out there, so the panel does not look complete when it is not. */
  function hintMore() {
    body.classList.toggle('more-below', body.scrollHeight - body.scrollTop - body.clientHeight > 8);
  }
  body.addEventListener('scroll', hintMore, { passive: true });
  new ResizeObserver(hintMore).observe(body);

  body.addEventListener('click', (e) => {
    const button = e.target.closest('[data-act]');
    if (!button || button.disabled || drag) return;
    // A row's own buttons act on that row's element: it becomes the selected one.
    if (button.dataset.row !== undefined) select(Number(button.dataset.row));
    ACTIONS[button.dataset.act](button.dataset.arg);
  });
  // A blocked area's margin field: Enter or leaving it sets the margin; the arrows step it like − and +; Escape puts it back.
  body.addEventListener('change', (e) => {
    if (e.target.id === 'edit-blocked-margin' && block !== null && !drag) ACTIONS.typedBlockedMargin(e.target.value);
  });
  body.addEventListener('keydown', (e) => {
    if (e.target.id !== 'edit-blocked-margin' || block === null || drag) return;
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      ACTIONS.blockedMargin(e.key === 'ArrowUp' ? 'more' : 'less');
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (matchMedia('(pointer: coarse)').matches) e.target.blur();
      else ACTIONS.typedBlockedMargin(e.target.value);
    } else if (e.key === 'Escape') {
      e.stopPropagation();
      e.target.value = comma(blockedMarginOf(layout, block).value);
      e.target.blur();
    }
  });
  // The angle field: Enter or leaving it turns the element; the arrows step through the axes.
  body.addEventListener('change', (e) => {
    if (target() === null || drag) return;
    if (e.target.id === 'edit-angle') ACTIONS.angle(e.target.value);
    else if (e.target.dataset.size) ACTIONS.typedSize(`${e.target.dataset.size}:${e.target.value}`);
  });
  // A blocked area's size field: the same, in whole metres.
  body.addEventListener('change', (e) => {
    const key = e.target.dataset?.blockedSize;
    if (key && block !== null && !drag) ACTIONS.typedBlockedSize(`${key}:${e.target.value}`);
  });
  body.addEventListener('keydown', (e) => {
    const key = e.target.dataset?.blockedSize;
    if (!key || block === null || drag) return;
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      ACTIONS.blockedSize(`${key}:${e.key === 'ArrowUp' ? 1 : -1}`);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (matchMedia('(pointer: coarse)').matches) e.target.blur();
      else ACTIONS.typedBlockedSize(`${key}:${e.target.value}`);
    } else if (e.key === 'Escape') {
      e.stopPropagation();
      e.target.value = String(layout.recipe.blocked[block][key]);
      e.target.blur();
    }
  });
  // A size field: Enter or leaving it sets the size; the arrows step it like − and +.
  body.addEventListener('keydown', (e) => {
    const key = e.target.dataset?.size;
    if (!key || selected === null || drag) return;
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      ACTIONS.size(`${key}:${e.key === 'ArrowUp' ? 'more' : 'less'}`);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (matchMedia('(pointer: coarse)').matches) e.target.blur();
      else ACTIONS.typedSize(`${key}:${e.target.value}`);
    } else if (e.key === 'Escape') {
      e.stopPropagation();
      e.target.value = comma(elementControls(layout, selected).find((c) => c.key === key).value);
      e.target.blur();
    }
  });
  body.addEventListener('keydown', (e) => {
    if (e.target.id !== 'edit-angle' || target() === null || drag) return;
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      ACTIONS.rotate(e.key === 'ArrowUp' ? '1' : '-1');
    } else if (e.key === 'Enter') {
      e.preventDefault();
      // A phone hides its keyboard; at a desk the cursor stays in the field.
      if (matchMedia('(pointer: coarse)').matches) e.target.blur();
      else ACTIONS.angle(e.target.value);
    } else if (e.key === 'Escape') {
      e.stopPropagation();
      e.target.value = comma(axisDegrees(currentAxis()));
      e.target.blur();
    }
  });
  body.addEventListener('focusin', (e) => {
    if (e.target.id === 'edit-angle') e.target.select();
  });

  /** Undo or redo from its button; when that was the last step the keyboard moves to the other one. */
  const history = (button, other, run) => button.addEventListener('click', () => {
    run();
    if (button.disabled) [other, $('edit-done')].find((b) => !b.disabled).focus({ preventScroll: true });
  });
  history($('edit-undo'), $('edit-redo'), () => step(undo, redo, 'Правка отменена.'));
  history($('edit-redo'), $('edit-undo'), () => step(redo, undo, 'Правка возвращена.'));
  $('edit-problems').addEventListener('click', (e) => {
    if (!e.target.closest('#problem-next')) return;
    problemAt++;
    const problems = renderProblems();
    say(`Проблема ${problemAt + 1} из ${problems.length}: ${problems[problemAt].text}`);
    $('problem-next').focus({ preventScroll: true });
  });
  $('edit-done').addEventListener('click', () => host.leave());

  // ---------------------------------------------------------------- type picker

  let pickerOpener = null; // [act, arg] of the button that opened the picker
  let added = false; // the picker closed on a new element: the keyboard goes to it

  /** Where an element inserted at place `at` of the route goes, as the picker says it. */
  function insertPlace(at) {
    const n = layout.elements.length;
    if (at === 0) return 'перед элементом 1, первым по маршруту';
    if (at >= n) return `после элемента ${n}, последним по маршруту`;
    return `между элементами ${at} и ${at + 1}`;
  }

  function openPicker(mode, at = 0, act = mode, arg = null) {
    if (mode === 'replace' && selected === null) return;
    if (mode === 'insert' && layout.elements.length >= ELEMENTS_MAX) return;
    picker = mode;
    pickerAt = at;
    pickerOpener = [act, arg];
    added = false;
    const current = mode === 'replace' ? layout.elements[selected].type : null;
    // Gates are what an inserted element most often is: they show the way between two others.
    const suggested = mode === 'insert' ? SUGGESTED_INSERT : null;
    $('type-title').textContent = mode === 'replace' ? `Заменить элемент ${selected + 1}` : 'Вставить элемент';
    $('type-note').textContent = tied(mode === 'replace'
      ? `Сейчас это «${name(selected)}». Новый элемент встанет на то же место, размеры — по рецепту.`
      : `Встанет ${insertPlace(at)}, на свободное место у связки; маршрут пройдёт через него.`);
    const { train } = layout.recipe;
    // A waypoint is no element to replace with: it is only inserted.
    $('type-grid').innerHTML = (mode === 'insert' ? [...ELEMENT_TYPES, WAYPOINT] : ELEMENT_TYPES).map((t) => {
      const looped = train && LOOPED_TYPES.includes(t);
      const note = t === current ? '<span class="type-note">сейчас</span>'
        : looped ? '<span class="type-note">не для паровозика</span>'
          : t === suggested ? '<span class="type-note">показывают, куда ехать</span>'
            : SINGLE_CONE_TYPES.includes(t) ? '<span class="type-note">один конус</span>'
              : t === WAYPOINT ? '<span class="type-note">без конуса, маршрут через точку</span>' : '';
      const mark = t === current ? ' aria-current="true"' : t === suggested && !looped ? ' class="suggested"' : '';
      return `<button type="button" data-type="${t}"${mark}${looped ? ' disabled' : ''}><span>${esc(TYPE_NAMES[t])}</span>${note}</button>`;
    }).join('');
    host.modal(true);
    const sheet = $('type-sheet');
    sheet.hidden = false;
    sheet.scrollTop = 0;
    (sheet.querySelector('[aria-current], .suggested') ?? sheet).focus({ preventScroll: true });
  }

  function closePicker() {
    if (!picker) return;
    picker = null;
    document.activeElement?.blur?.();
    $('type-sheet').hidden = true;
    host.modal(false);
    // Back to the button that opened it, or on to the new element's row.
    const row = body.querySelector('.el-row.open .el-pick');
    const [act, arg] = pickerOpener;
    const opener = body.querySelector(`.el-row.open [data-act="${act}"][data-arg="${arg}"]:not(:disabled)`)
      ?? body.querySelector(`[data-act="${act}"]:not(:disabled)`);
    const back = (added && row) || opener || row || $('edit-done');
    back.focus({ preventScroll: true });
  }

  $('type-grid').addEventListener('click', (e) => {
    const button = e.target.closest('[data-type]');
    if (!button || button.disabled) return;
    const type = button.dataset.type;
    const mode = picker;
    if (mode === 'replace') {
      if (type !== layout.elements[selected].type) commit(replaceElement(layout, selected, type), selected, `Элемент ${selected + 1} теперь «${TYPE_NAMES[type]}».`);
    } else {
      const at = pickerAt;
      const text = `Вставлен элемент «${TYPE_NAMES[type]}» ${insertPlace(at)}: теперь он ${at + 1}-й. Перетащите его, если нужно.`;
      added = commit(insertElement(layout, at, type), at, text);
    }
    host.reveal(idOf(selected));
    closePicker();
  });
  $('close-type').addEventListener('click', closePicker);
  $('type-sheet').addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      closePicker();
    }
  });

  // ---------------------------------------------------------------- the app's side

  return {
    get active() { return active; },
    get layout() { return layout; },
    /** The course differs from the generated one. */
    get edited() { return !!layout && courseOf(layout) !== courseOf(base); },
    get problems() { return routed?.problems ?? []; },
    get selectedId() { return block !== null ? `b${block + 1}` : term ?? idOf(selected); },
    get dragging() { return !!drag; },
    get pickerOpen() { return !!picker; },

    /**
     * A generated course is on screen: start from its layout, forgetting the
     * history. With `edited` — a layout kept for the same recipe and seed — the
     * edits are put back on top; the generated course is one undo away.
     * Returns the course to show and its problems.
     */
    load(course, edited = null) {
      base = layoutOf(course);
      layout = base;
      undo = [];
      redo = [];
      selected = null;
      block = null;
      term = null;
      drag = null;
      routed = { course, problems: [] };
      if (edited && courseOf(edited) !== courseOf(base)) {
        undo = [{ layout: base, selected: null }];
        layout = edited;
        routed = routeLayout(layout);
      }
      render();
      return routed;
    },

    /**
     * The recipe form changed under an edited course: the layout takes the new
     * recipe and seed with its elements where they are (`applyRecipe`), as one
     * step «Правка» can undo. False when nothing changes.
     */
    adapt(recipe, seed) {
      if (!layout || drag) return false;
      return commit(applyRecipe(layout, recipe, seed), target(), 'Рецепт применён к трассе с правками.', block);
    },

    enter(id = null) {
      active = true;
      selected = indexOf(id);
      block = null;
      term = termOf(id);
      shownSelected = null;
      say('');
      show();
      render();
    },

    leave() {
      active = false;
      selected = null;
      block = null;
      term = null;
      drag = null;
    },

    /** A tap on the plan: the element under it, or nothing. */
    select(id) {
      select(termOf(id) ?? indexOf(id), blockOf(id));
    },

    /**
     * A finger went down on an element and moved: it is selected and follows the
     * finger until `dragEnd`. With `handle` ({sx, sy}, a blocked area's corner or
     * side, `blockedHandles`) that side moves instead and the opposite one stays.
     */
    /** A long press on the plan at (x, y), metres: a waypoint there, between the elements whose connector passes nearest. */
    addWaypoint(x, y) {
      if (!active) return false;
      const next = insertWaypoint(layout, x, y);
      const at = next.elements.findIndex((e, k) => e !== layout.elements[k]);
      if (at < 0) {
        say(`Больше ${ELEMENTS_MAX} элементов не поставить.`);
        return false;
      }
      const text = `Опорная точка поставлена ${insertPlace(at)}: теперь она ${at + 1}-я по маршруту. Перетащите её, если нужно.`;
      if (!commit(next, at, text)) return false;
      host.reveal(idOf(selected));
      return true;
    },
    dragStart(id, handle = null) {
      const k = blockOf(id);
      if (k !== null) {
        if (block !== k || selected !== null || term !== null) {
          selected = null;
          term = null;
          block = k;
          render();
        }
        const b = layout.recipe.blocked[k];
        drag = { from: layout, block: k, x: b.x, y: b.y, rect: { ...b }, handle: handle && (handle.sx || handle.sy) ? handle : null };
        return true;
      }
      const t = termOf(id);
      if (t) {
        if (term !== t) {
          selected = null;
          block = null;
          term = t;
          render();
        }
        const p = terminalPose(layout, t);
        drag = { from: layout, i: t, x: p.x, y: p.y };
        return true;
      }
      const i = indexOf(id);
      if (i === null) return false;
      if (selected !== i) {
        selected = i;
        term = null;
        render();
      }
      drag = { from: layout, i, x: layout.elements[i].x, y: layout.elements[i].y };
      return true;
    },

    /** The dragged element, (dx, dy) metres from where the drag began. */
    dragBy(dx, dy) {
      if (!drag) return;
      const next = drag.handle
        ? resizeBlockedSide(drag.from, drag.block, drag.rect, drag.handle.sx, drag.handle.sy, dx, dy)
        : drag.block !== undefined
          ? moveBlocked(drag.from, drag.block, drag.x + dx, drag.y + dy)
          : moveElement(drag.from, drag.i, drag.x + dx, drag.y + dy);
      if (elementsOf(next) === elementsOf(layout)) return;
      layout = next;
      routed = routeLayout(layout);
      show(true);
      render();
    },

    dragEnd() {
      if (!drag) return;
      const { from, i, block: k, handle } = drag;
      drag = null;
      if (elementsOf(from) !== elementsOf(layout)) {
        undo.push(k !== undefined ? { layout: from, selected: null, block: k } : isTerm(i) ? { layout: from, selected: null, block: null, term: i } : { layout: from, selected: i, block: null });
        if (undo.length > UNDO_MAX) undo.shift();
        redo = [];
        const before = routeLayout(from).problems.length;
        if (k !== undefined) {
          const b = layout.recipe.blocked[k];
          say(handle
            ? `${blockedTitle(layout, k)}: ${b.w} × ${b.h} м, угол X ${b.x}, Y ${b.y} м.${problemsNote(before)}`
            : `${blockedTitle(layout, k)}: X ${b.x}, Y ${b.y} м.${problemsNote(before)}`);
        } else if (isTerm(i)) {
          say(`${termTitle(i)}: первый конус X ${layout[i].x}, Y ${layout[i].y} м.${problemsNote(before)}`);
        } else {
          const el = layout.elements[i];
          say(`Элемент ${i + 1}: якорь X ${el.x}, Y ${el.y} м.${problemsNote(before)}`);
        }
      }
      show();
      render();
    },

    /** Esc during a drag: everything goes back to where the gesture began, no undo step. */
    dragCancel() {
      if (!drag) return;
      const changed = elementsOf(drag.from) !== elementsOf(layout);
      layout = drag.from;
      drag = null;
      if (changed) routed = routeLayout(layout);
      say('Перетаскивание отменено.');
      show();
      render();
    },

    /** Keys of the edit mode; true when the key was one of them. */
    key(e) {
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key;
      if (mod && !e.altKey && (k === 'z' || k === 'Z' || k === 'я' || k === 'Я')) {
        if (e.shiftKey) step(redo, undo, 'Правка возвращена.');
        else step(undo, redo, 'Правка отменена.');
        return true;
      }
      if (mod && !e.altKey && (k === 'y' || k === 'Y' || k === 'н' || k === 'Н')) {
        step(redo, undo, 'Правка возвращена.');
        return true;
      }
      if (mod || e.altKey || drag) return false;
      if (k === 'Escape') {
        if (selected !== null || block !== null || term !== null) select(null);
        else host.leave();
        return true;
      }
      if (block !== null) {
        if (NUDGES[k]) {
          const [dx, dy] = NUDGES[k];
          nudge(dx * (e.shiftKey ? 5 : 1), dy * (e.shiftKey ? 5 : 1));
          return true;
        }
        if (k === 'Delete' || k === 'Backspace') {
          ACTIONS.remove();
          return true;
        }
        return false;
      }
      if (term) {
        if (NUDGES[k]) {
          const [dx, dy] = NUDGES[k];
          nudge(dx * (e.shiftKey ? 5 : 1), dy * (e.shiftKey ? 5 : 1));
          return true;
        }
        if (k === 'r' || k === 'R' || k === 'к' || k === 'К') {
          ACTIONS.rotate(e.shiftKey ? '1' : '-1');
          return true;
        }
        return false;
      }
      if (selected === null) return false;
      if (NUDGES[k]) {
        const [dx, dy] = NUDGES[k];
        nudge(dx * (e.shiftKey ? 5 : 1), dy * (e.shiftKey ? 5 : 1));
        return true;
      }
      if (k === 'Delete' || k === 'Backspace') {
        ACTIONS.remove();
        return true;
      }
      if (k === 'r' || k === 'R' || k === 'к' || k === 'К') {
        ACTIONS.rotate(e.shiftKey ? '1' : '-1');
        return true;
      }
      return false;
    },

    closePicker,
  };
}
