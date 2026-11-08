// «Правка»: the course editor. It holds the layout being edited with its undo
// history, draws the edit panel and the type picker, and hands every new course
// back to the app. What an edit does to a course is decided in
// generator/layout.js; nothing here knows how a course is routed.

import {
  ELEMENT_TYPES, ELEMENTS_MAX, elementControls, insertElement, layoutOf, LOOPED_TYPES, mirrorElement, moveElement, problemsWord, removeElement,
  replaceElement, resizeElement, rotateElement, routeLayout, shiftElement, typeAxes, TYPE_NAMES,
} from '../generator/index.js';

const UNDO_MAX = 100;

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

const comma = (v) => String(Math.round(v * 10) / 10).replace('.', ',');
/** Text as the panel sets it: a dash never starts a line. */
const tied = (s) => s.replace(/ —/g, '\u00a0—');

/** A size as the panel prints it: metres with a decimal comma, a count, an angle. */
function sizeText(c) {
  if (c.kind === 'count') return String(c.value);
  if (c.kind === 'choice') return `${c.value}°`;
  return `${comma(c.value)}\u00a0м`;
}

const elementsOf = (layout) => JSON.stringify(layout.elements);
/** The elements without the pivots turning leaves behind: two layouts with the same ones give the same course. */
const courseOf = (layout) => JSON.stringify(layout.elements.map(({ pivot, ...e }) => e));

// Arrow keys and the move buttons: one metre across the plan.
const NUDGES = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] };

/**
 * @param host what the editor needs from the app:
 *   show(course, problems, {dragging}) — the course to draw now;
 *   reveal(id) — an element was picked in the panel: bring it into view on the plan;
 *   leave() — «Готово»;
 *   modal(open) — the type picker opened or closed: everything behind it goes inert.
 */
export function createEditor(host) {
  const body = $('edit-body');
  const live = $('edit-live');
  let base = null; // the layout of the generated course the edits started from
  let layout = null;
  let routed = null; // { course, problems } of `layout`
  let selected = null; // index of the selected element
  let undo = []; // { layout, selected }: what an undo goes back to, with the element that was being edited
  let redo = [];
  let drag = null; // { from, i, x, y }: the layout and the anchor an element is dragged from
  let active = false;
  let picker = null; // 'replace' | 'add' while the type picker is open
  let shownSelected = null; // the selection the chip row was last scrolled to
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
  const indexOf = (id) => {
    const i = id ? Number(id.slice(1)) - 1 : NaN;
    return Number.isInteger(i) && layout && i >= 0 && i < layout.elements.length ? i : null;
  };
  const name = (i) => TYPE_NAMES[layout.elements[i].type];
  const say = (text) => (live.textContent = text);

  /** What the problems are now, for the end of an announcement. */
  function problemsNote(before) {
    const n = routed.problems.length;
    if (n) return ` ${problemsWord(n)[0].toUpperCase()}${problemsWord(n).slice(1)}.`;
    return before ? ' Проблем больше нет.' : '';
  }

  function show(dragging = false) {
    host.show(routed.course, routed.problems, { dragging });
  }

  /** Makes `next` the layout, with the old one to undo back to. */
  function commit(next, sel, text) {
    if (elementsOf(next) === elementsOf(layout)) return false;
    const before = routed.problems.length;
    undo.push({ layout, selected });
    if (undo.length > UNDO_MAX) undo.shift();
    redo = [];
    layout = next;
    selected = sel;
    routed = routeLayout(layout);
    show();
    render();
    say(text + problemsNote(before));
    return true;
  }

  function step(from, to, text) {
    if (!from.length || drag) return;
    const before = routed.problems.length;
    to.push({ layout, selected });
    ({ layout, selected } = from.pop());
    routed = routeLayout(layout);
    show();
    render();
    say(text + problemsNote(before));
  }

  function select(i) {
    if (i === selected) return;
    selected = i;
    show();
    render();
  }

  function nudge(dx, dy) {
    if (selected === null) return;
    const el = layout.elements[selected];
    const next = moveElement(layout, selected, el.x + dx, el.y + dy);
    const to = next.elements[selected];
    if (!commit(next, selected, `Элемент ${selected + 1}: якорь X ${to.x}, Y ${to.y} м.`)) say('Дальше край площадки: элемент остался на месте.');
  }

  const ACTIONS = {
    select: (arg) => {
      select(Number(arg));
      host.reveal(idOf(selected));
    },
    nudge: (arg) => nudge(...arg.split(',').map(Number)),
    rotate: (arg) => commit(rotateElement(layout, selected, Number(arg)), selected, `Элемент ${selected + 1} повёрнут.`),
    mirror: () => commit(mirrorElement(layout, selected), selected, `Элемент ${selected + 1} отражён: повороты в другую сторону.`),
    size: (arg) => {
      const [key, dir] = arg.split(':');
      const control = elementControls(layout, selected).find((c) => c.key === key);
      if (!control[dir]) return;
      const next = resizeElement(layout, selected, control[dir]);
      const now = elementControls(next, selected).find((c) => c.key === key);
      commit(next, selected, `${now.name}: ${sizeText(now)}.`);
    },
    shift: (arg) => {
      const to = selected + Number(arg);
      if (to < 0 || to >= layout.elements.length) return;
      commit(shiftElement(layout, selected, Number(arg)), to, `«${name(selected)}» теперь ${to + 1}-й по маршруту.`);
    },
    remove: () => {
      if (layout.elements.length <= 1) return;
      const text = `Элемент ${selected + 1}, «${name(selected)}», удалён. Осталось элементов: ${layout.elements.length - 1}.`;
      commit(removeElement(layout, selected), null, text);
    },
    replace: () => openPicker('replace'),
    add: () => openPicker('add'),
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
    const own = (p) => selected !== null && p.elements.includes(idOf(selected));
    const problems = [...routed.problems.filter(own), ...routed.problems.filter((p) => !own(p))];
    box.hidden = !problems.length;
    if (!problems.length) {
      box.replaceChildren();
      problemsKey = '';
      return problems;
    }
    // A different set of problems starts from its first one.
    const key = JSON.stringify([selected, problems.map((p) => p.text)]);
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

  function chipsHtml() {
    const wrong = new Set(routed.problems.flatMap((p) => p.elements));
    const chips = layout.elements.map((el, i) => {
      const bad = wrong.has(idOf(i));
      return `<button type="button" class="chip${bad ? ' bad' : ''}" data-act="select" data-arg="${i}" aria-pressed="${i === selected}" aria-label="${i + 1}. ${esc(TYPE_NAMES[el.type])}${bad ? ', есть проблема' : ''}">`
        + `<b>${i + 1}</b><span class="chip-name">${esc(TYPE_NAMES[el.type])}</span>${bad ? '<span class="mark" aria-hidden="true">!</span>' : ''}</button>`;
    }).join('');
    const full = layout.elements.length >= ELEMENTS_MAX;
    const where = selected === null ? 'в конец маршрута' : `после элемента ${selected + 1}`;
    const add = `<button type="button" class="chip add" data-act="add" aria-label="Добавить элемент ${where}" title="${full ? `На трассе не больше ${ELEMENTS_MAX} элементов` : `Добавить элемент ${where}`}"${full ? ' disabled' : ''}>${icon('plus')}</button>`;
    return `<div class="edit-chips" role="group" aria-label="Элементы по порядку маршрута">${chips}${add}</div>`;
  }

  function elementHtml() {
    const i = selected;
    const el = layout.elements[i];
    const turn = typeAxes(el.type).length === 8 ? 45 : 90;
    const sizes = elementControls(layout, i).map((c) => `<div class="size-row" role="group" aria-label="${esc(c.name)}">
        <span class="size-name">${esc(c.name)}</span>
        <button type="button" data-act="size" data-arg="${c.key}:less" aria-label="${esc(c.name)}: меньше"${c.less ? '' : ' disabled'}>${icon('minus')}</button>
        <span class="size-value">${esc(sizeText(c))}</span>
        <button type="button" data-act="size" data-arg="${c.key}:more" aria-label="${esc(c.name)}: больше"${c.more ? '' : ' disabled'}>${icon('plus')}</button>
      </div>`).join('');
    const tool = (act, arg, label, glyph) => `<button type="button" data-act="${act}"${arg === null ? '' : ` data-arg="${arg}"`} aria-label="${label}" title="${label}">${icon(glyph)}</button>`;
    const n = layout.elements.length;
    // Moving and the route actions first: they stay where they are from one
    // element to the next. The sizes, one to three rows by type, come last.
    return `<div class="edit-tools">
        <span class="tool-group" role="group" aria-label="Сдвинуть">
          ${tool('nudge', '-1,0', 'Сдвинуть на 1 м влево', 'left')}${tool('nudge', '0,1', 'Сдвинуть на 1 м вверх', 'up')}${tool('nudge', '0,-1', 'Сдвинуть на 1 м вниз', 'down')}${tool('nudge', '1,0', 'Сдвинуть на 1 м вправо', 'right')}
        </span>
        <span class="tool-group" role="group" aria-label="Повернуть и отразить">
          ${tool('rotate', '1', `Повернуть на ${turn}° против часовой`, 'ccw')}${tool('rotate', '-1', `Повернуть на ${turn}° по часовой`, 'cw')}${tool('mirror', null, 'Отразить: повороты в другую сторону', 'mirror')}
        </span>
      </div>
      <div class="edit-actions">
        <button type="button" data-act="replace">Заменить</button>
        <button type="button" data-act="shift" data-arg="-1" aria-label="Раньше по маршруту"${i === 0 ? ' disabled' : ''}>Раньше</button>
        <button type="button" data-act="shift" data-arg="1" aria-label="Позже по маршруту"${i === n - 1 ? ' disabled' : ''}>Позже</button>
        <button type="button" class="danger" data-act="remove"${n === 1 ? ' disabled title="Последний элемент трассы не удаляется"' : ''}>Удалить</button>
      </div>
      <div class="edit-sizes">${sizes}</div>`;
  }

  function render() {
    if (!active) return;
    // The panel is rebuilt whole: keep the keyboard where it was.
    const focused = body.contains(document.activeElement) ? document.activeElement : null;
    const key = focused && [focused.dataset.act, focused.dataset.arg];
    const scroll = body.querySelector('.edit-chips')?.scrollLeft ?? 0;
    const hint = '<p class="edit-hint muted">Нажмите на элемент на плане или на его номер. Выбранный элемент перетаскивается по плану, а размеры, поворот и порядок меняются здесь.</p>';
    // About the whole course, so it is offered with no element selected.
    const reset = courseOf(layout) === courseOf(base) ? '' : '<button type="button" class="link" data-act="reset">Сбросить все правки</button>';
    body.innerHTML = `${chipsHtml()}${selected === null ? hint + reset : elementHtml()}`;
    renderProblems();
    $('edit-title').textContent = selected === null ? 'Правка трассы' : `${selected + 1}. ${name(selected)}`;
    $('edit-undo').disabled = !undo.length;
    $('edit-redo').disabled = !redo.length;
    const chips = body.querySelector('.edit-chips');
    chips.scrollLeft = scroll;
    if (selected !== shownSelected) {
      shownSelected = selected;
      const chip = selected === null ? null : chips.children[selected];
      if (chip) {
        const [a, b] = [chip.offsetLeft - chips.offsetLeft, chip.offsetLeft - chips.offsetLeft + chip.offsetWidth];
        if (a < chips.scrollLeft) chips.scrollLeft = a - 8;
        else if (b > chips.scrollLeft + chips.clientWidth) chips.scrollLeft = b - chips.clientWidth + 8;
      }
    }
    hintMore();
    if (key) {
      const same = [...body.querySelectorAll('[data-act]')].find((b) => b.dataset.act === key[0] && b.dataset.arg === key[1] && !b.disabled);
      // The button is gone or at its limit: undo is the next thing wanted.
      const next = same ?? [$('edit-undo'), $('edit-done')].find((b) => !b.disabled);
      next.focus({ preventScroll: true });
    }
  }

  /** Controls under the fold and chips past the edge fade out there, so the panel does not look complete when it is not. */
  function hintMore() {
    body.classList.toggle('more-below', body.scrollHeight - body.scrollTop - body.clientHeight > 8);
    const chips = body.querySelector('.edit-chips');
    if (chips) chips.classList.toggle('more-after', chips.scrollWidth - chips.scrollLeft - chips.clientWidth > 8);
  }
  // Scroll events do not bubble: the chip row's are caught on the way down.
  body.addEventListener('scroll', hintMore, { passive: true, capture: true });
  new ResizeObserver(hintMore).observe(body);

  body.addEventListener('click', (e) => {
    const button = e.target.closest('[data-act]');
    if (!button || button.disabled || drag) return;
    ACTIONS[button.dataset.act](button.dataset.arg);
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

  let pickerOpener = null;
  let added = false; // the picker closed on a new element: the keyboard goes to it

  function openPicker(mode) {
    if (mode === 'replace' && selected === null) return;
    if (mode === 'add' && layout.elements.length >= ELEMENTS_MAX) return;
    picker = mode;
    pickerOpener = mode;
    added = false;
    const current = mode === 'replace' ? layout.elements[selected].type : null;
    $('type-title').textContent = mode === 'replace' ? `Заменить элемент ${selected + 1}` : 'Добавить элемент';
    $('type-note').textContent = tied(mode === 'replace'
      ? `Сейчас это «${name(selected)}». Новый элемент встанет на то же место, размеры — по рецепту.`
      : `Встанет ${selected === null ? 'в конец маршрута' : `в маршрут после элемента ${selected + 1}`}, на свободное место.`);
    const { train } = layout.recipe;
    $('type-grid').innerHTML = ELEMENT_TYPES.map((t) => {
      const looped = train && LOOPED_TYPES.includes(t);
      const note = t === current ? '<span class="type-note">сейчас</span>' : looped ? '<span class="type-note">не для паровозика</span>' : '';
      return `<button type="button" data-type="${t}"${t === current ? ' aria-current="true"' : ''}${looped ? ' disabled' : ''}><span>${esc(TYPE_NAMES[t])}</span>${note}</button>`;
    }).join('');
    host.modal(true);
    const sheet = $('type-sheet');
    sheet.hidden = false;
    sheet.scrollTop = 0;
    (sheet.querySelector('[aria-current]') ?? sheet).focus({ preventScroll: true });
  }

  function closePicker() {
    if (!picker) return;
    picker = null;
    document.activeElement?.blur?.();
    $('type-sheet').hidden = true;
    host.modal(false);
    // Back to the button that opened it, or on to the new element's chip.
    const chip = body.querySelector('.chip[aria-pressed="true"]');
    const back = (added && chip) || body.querySelector(`[data-act="${pickerOpener}"]:not(:disabled)`) || chip || $('edit-done');
    back.focus({ preventScroll: true });
  }

  $('type-grid').addEventListener('click', (e) => {
    const button = e.target.closest('[data-type]');
    if (!button || button.disabled) return;
    const type = button.dataset.type;
    const mode = picker;
    const at = selected === null ? layout.elements.length : selected + 1;
    if (mode === 'replace') {
      if (type !== layout.elements[selected].type) commit(replaceElement(layout, selected, type), selected, `Элемент ${selected + 1} теперь «${TYPE_NAMES[type]}».`);
    } else {
      added = commit(insertElement(layout, at, type), at, `«${TYPE_NAMES[type]}» добавлен ${at + 1}-м по маршруту.`);
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
    get selectedId() { return idOf(selected); },
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

    enter(id = null) {
      active = true;
      selected = indexOf(id);
      shownSelected = null;
      say('');
      show();
      render();
    },

    leave() {
      active = false;
      selected = null;
      drag = null;
    },

    /** A tap on the plan: the element under it, or nothing. */
    select(id) {
      select(indexOf(id));
    },

    /** A finger went down on an element and moved: it is selected and follows the finger until `dragEnd`. */
    dragStart(id) {
      const i = indexOf(id);
      if (i === null) return false;
      if (selected !== i) {
        selected = i;
        render();
      }
      drag = { from: layout, i, x: layout.elements[i].x, y: layout.elements[i].y };
      return true;
    },

    /** The dragged element, (dx, dy) metres from where the drag began. */
    dragBy(dx, dy) {
      if (!drag) return;
      const next = moveElement(drag.from, drag.i, drag.x + dx, drag.y + dy);
      if (elementsOf(next) === elementsOf(layout)) return;
      layout = next;
      routed = routeLayout(layout);
      show(true);
      render();
    },

    dragEnd() {
      if (!drag) return;
      const { from, i } = drag;
      drag = null;
      if (elementsOf(from) !== elementsOf(layout)) {
        undo.push({ layout: from, selected: i });
        if (undo.length > UNDO_MAX) undo.shift();
        redo = [];
        const el = layout.elements[i];
        say(`Элемент ${i + 1}: якорь X ${el.x}, Y ${el.y} м.${problemsNote(routeLayout(from).problems.length)}`);
      }
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
        if (selected !== null) select(null);
        else host.leave();
        return true;
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
