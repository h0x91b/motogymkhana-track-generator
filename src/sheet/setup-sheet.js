// Setup sheet data model: what the picture says, as numbers. Everything is
// derived from the course; nothing here is needed to draw the course itself.
// Contract: cone positions can be rebuilt from this data alone.

import { keepsFixedSize, passColor, SIZE_OPTIONS, sizeMinimum, TYPE_NAMES, WAYPOINT } from '../generator/catalog.js';
import { AXIS_STEPS, axisVector } from '../generator/geometry.js';
import { SAFETY_OPTIONS, safetyOf } from '../generator/recipe.js';

export const fmt = (v) => {
  const r = Math.round(v * 100) / 100;
  return String(Object.is(r, -0) ? 0 : r).replace('.', ',').replace('-', '−');
};
/**
 * A distance on the setup sheet and in «Расстановка»: always to 0.1 m, so a
 * whole metre reads «12,0» next to «1,5» and no figure looks rounder than the
 * rest. `fmt` stays for the form, where «1,5» chips and site sizes are terse.
 */
export const dist = (v) => {
  const r = Math.round(v * 10) / 10;
  return (Object.is(r, -0) ? 0 : r).toFixed(1).replace('.', ',').replace('-', '−');
};
export const metres = (v) => `${dist(v)} м`;

/**
 * True length of a diagonal run that goes `v` metres along X and as many along
 * Y, to 0.1 m. Cards and dimension lines say this, not the X/Y offset: the
 * offset read as a length makes a diagonal element look √2 times too small.
 */
export const slant = (v) => Math.round(v * Math.SQRT2 * 10) / 10;

const DIR_LABELS = ['→ вправо', '↗ вправо-вверх', '↑ вверх', '↖ влево-вверх', '← влево', '↙ влево-вниз', '↓ вниз', '↘ вправо-вниз'];

/** «22,5°»: an angle in degrees counter-clockwise from along the width. */
const degrees = (axis) => `${String(((axis * 45) % 360 + 360) % 360).replace('.', ',')}°`;

/**
 * Where a direction in 45° steps points. Between two of the eight arrows — an
 * element turned by a half step in «Правка» (ADR 0019) — it says the angle and
 * the arrows it lies between.
 */
export function travelLabel(dir) {
  if (Number.isInteger(dir)) return DIR_LABELS[((dir % 8) + 8) % 8];
  return `${degrees(dir)}, ${between(dir)}`;
}

/** «между ↓ и ↘»: the two arrows a half-step direction lies between. */
function between(dir) {
  const arrow = (k) => DIR_LABELS[((k % 8) + 8) % 8].split(' ')[0];
  return `между ${arrow(Math.floor(dir))} и ${arrow(Math.ceil(dir))}`;
}

function axisLabel(axis, diagonal, offLattice) {
  if (offLattice) return `под углом ${degrees(axis)} к ширине, ${Number.isInteger(axis) ? DIR_LABELS[axis] : between(axis)}`;
  if (diagonal) return `по диагонали, ${DIR_LABELS[axis]}`;
  return `${axis % 4 === 0 ? 'вдоль ширины' : 'вдоль длины'}, ${DIR_LABELS[axis]}`;
}

const ONE_WAY = new Set(['u-turn', 'pivot-turn', 'small-turn', 'box', 'circle', 'fast-circle', 'mirror', 'gate-turn', 'keyhole']);

/** Net turning of an element that turns one way (±180° or more, never near zero). */
function netTurn(path) {
  let total = 0;
  for (let i = 2; i < path.length; i++) {
    const ax = path[i - 1][0] - path[i - 2][0];
    const ay = path[i - 1][1] - path[i - 2][1];
    const bx = path[i][0] - path[i - 1][0];
    const by = path[i][1] - path[i - 1][1];
    total += Math.atan2(ax * by - ay * bx, ax * bx + ay * by);
  }
  return total >= 0 ? 'left' : 'right';
}

/** Which way the second gate of a lane change or tunnel is shifted, seen in the direction of travel. */
function shiftSide(element, byId) {
  const [a, b, c, d] = element.cones.map((id) => byId.get(id));
  const mx = c.hx + d.hx - a.hx - b.hx;
  const my = c.hy + d.hy - a.hy - b.hy;
  const [ux, uy] = axisVector(element.entry.dir);
  return ux * my - uy * mx > 0 ? 'left' : 'right';
}

/**
 * Dimension lines of each type: cone pairs (by index in the element) measured
 * along or across its axis. Across is measured at the second cone, from the
 * line along the axis through the first.
 */
const DIMENSIONS = {
  'straight-slalom': [['along', 0, 1]],
  'offset-slalom': [['along', 0, 1], ['across', 0, 1]],
  gate: [['across', 0, 1]],
  'lane-change': [['across', 0, 1], ['along', 0, 2], ['across', 0, 2]],
  'u-turn': [['along', 0, 1], ['across', 1, 2]],
  'pivot-turn': [],
  'figure-eight': [['along', 0, 1]],
  box: [['along', 0, 1], ['across', 1, 2]],
  // Rings, curved walls and arcs are laid out from their centres (see arcs).
  circle: [],
  'fast-circle': [],
  mirror: [['across', 0, 1]],
  'gate-turn': [['across', 0, 1]],
  snail: [],
  tunnel: [['across', 0, 1], ['along', 0, 2], ['across', 0, 2]],
  zigzag: [['along', 0, 2], ['across', 0, 1], ['across', 0, 2]],
  'corridor-slalom': [['along', 0, 1], ['across', 1, 2], ['along', 0, 4], ['across', 4, 5]],
  'box-eight': [['along', 0, 1], ['across', 2, 3], ['along', 4, 5], ['across', 5, 6]],
  keyhole: [],
  crescent: [],
  swerve: [['across', 0, 1], ['along', 0, 4], ['along', 4, 6]],
  'pass-left': [],
  'pass-right': [],
  'small-turn': [],
};

const half = (v) => Math.round(v * 2) / 2 + 0;

/**
 * One dimension line in site metres. On a diagonal its value is the offset by
 * X and by Y (equal), from which the cone table lays it out; its label is the
 * true slant length, which is what the rider gets. Off the lattice (ADR 0019)
 * the foot is wherever it falls and the value is the true length itself.
 */
function dimension(points, axis, diagonal, offLattice, [kind, i, j]) {
  const [sx, sy] = offLattice ? axisVector(axis) : AXIS_STEPS[axis];
  const [ax, ay] = points[i];
  const [bx, by] = points[j];
  const t = ((bx - ax) * sx + (by - ay) * sy) / (sx * sx + sy * sy);
  const foot = offLattice ? [ax + t * sx, ay + t * sy] : [half(ax + t * sx), half(ay + t * sy)];
  const [from, to] = kind === 'along' ? [[ax, ay], foot] : [foot, [bx, by]];
  const dx = Math.abs(to[0] - from[0]);
  const dy = Math.abs(to[1] - from[1]);
  const value = offLattice ? Math.hypot(dx, dy) : diagonal ? dx : dx + dy;
  return {
    kind,
    from: { x: from[0], y: from[1] },
    to: { x: to[0], y: to[1] },
    value,
    label: diagonal ? metres(slant(value)) : metres(value),
  };
}

const CLOCK = { left: 'против часовой стрелки', right: 'по часовой стрелке' };
const TURN = { left: 'налево', right: 'направо' };

/** Diameter in metres of the round loops of a figure eight `distance` lattice steps across (D = 2√2 r). */
/**
 * Human summary of the sizes, multiples of 0.5 m on a side axis. On a diagonal
 * a length of k lattice steps is k × 0.5 m along X and along Y and is stated
 * as its true slant length (`slant`); the cone table keeps the X/Y offsets.
 */
function describe(element, cones, diagonal, turn, shift, dims) {
  const p = element.params;
  const size = (m) => metres(diagonal ? slant(m) : m);
  const len = (steps) => size(steps * 0.5);
  const first = cones[0];
  const last = cones[cones.length - 1];
  const colour = (c) => (c.color === 'blue' ? 'синий' : c.color === 'striped' ? 'красный с жёлтой полосой' : 'красный');
  const colours = (c) => (c.color === 'blue' ? 'синих' : 'красных');
  const colourOf = (c) => (c.color === 'blue' ? 'синего' : c.color === 'striped' ? 'красного с жёлтой полосой' : 'красного');
  switch (element.type) {
    case 'straight-slalom':
      return [`${p.count} конусов, шаг: ${len(p.step)}`, `Первый конус ${colour(first)}, дальше цвета чередуются`];
    case 'offset-slalom':
      return [`${p.count} конусов, шаг вдоль оси: ${len(p.step)}`, `Конусы попеременно в двух рядах, между рядами ${len(2 * p.shift)}`, `Первый конус ${colour(first)}`];
    case 'gate':
      return [`Ширина: ${len(p.width)}`, 'Проехать между конусами: синий слева, красный справа'];
    case 'lane-change':
      return [
        `Двое ворот, ширина: ${len(p.width)}`,
        `Между воротами вдоль оси: ${size(dims[1].value)}`,
        `Вторые ворота смещены ${shift === 'left' ? 'влево' : 'вправо'} на ${len(p.shift)}`,
      ];
    case 'u-turn':
      return [
        `Ширина зоны поперёк оси: ${len(p.width)}`,
        `Глубина вдоль оси: ${size(dims[0].value)}`,
        `Разворот ${TURN[turn]} внутри, въезд и выезд с открытой стороны`,
      ];
    case 'pivot-turn':
      return [
        `Вращение ${p.angle}° ${CLOCK[turn]} вокруг конуса`,
        p.angle > 180 ? 'Конус красный с жёлтой полосой: полный оборот вокруг него' : `Конус ${colour(first)}: ${p.angle === 90 ? 'четверть оборота' : 'полоборота'} вокруг него`,
        `Свободный радиус: ${metres(p.radius)}`,
      ];
    case 'pass-left':
    case 'pass-right':
      return [
        `Один высокий конус, ${colour(first)}: объехать, оставив его ${element.type === 'pass-left' ? 'слева' : 'справа'}`,
        'Проезд с любой стороны подхода: линию и повороты до и после выбирает маршрут, не конус',
      ];
    case 'small-turn':
      return [
        `Разворот ${TURN[turn]} на 180° вокруг ${colourOf(first)} высокого конуса`,
        `Радиус не меньше ${metres(p.radius)}; стенок нет, шире — можно`,
        'Заход с любой стороны подхода: откуда — решает маршрут',
      ];
    case 'figure-eight':
      return [
        `Между конусами: ${len(p.distance)}`,
        `Синий — ${CLOCK.left}, красный — ${CLOCK.right}`,
        `Петли шире конусов: по линии езды Ø ${metres(2 * p.radius)}, конусы внутри петель ближе к перекрёстку`,
      ];
    case 'box':
      return [`Сторона коробки: ${len(p.size)}`, `Внутри поворот на 270° ${TURN[turn]}, выезд через сторону ${turn === 'left' ? 'справа' : 'слева'} от въезда`];
    case 'circle':
      return [
        p.stretch
          ? `${cones.length} конусов по овалу: две полуокружности радиусом ${len(p.radius)}, центры в ${len(p.stretch)} друг от друга вдоль оси`
          : `${cones.length} конусов по кругу радиусом ${len(p.radius)}`,
        `Один круг ${CLOCK[turn]} снаружи конусов, выезд поворотом в другую сторону`,
      ];
    case 'fast-circle':
      return [
        `${cones.length} конусов по кругу радиусом ${len(p.radius)}`,
        `Один круг ${CLOCK[turn]} на скорости снаружи конусов, выезд поворотом в другую сторону радиусом ${metres(p.out)}`,
      ];
    case 'mirror':
      return [
        `Линия мелом поперёк оси между двумя низкими конусами: ${size(dims[0].value)}`,
        `Разворот ${TURN[turn]}: на вершине колесо пересекает линию или касается её`,
        'Въезд и выезд с одной стороны линии, следы перекрещиваются перед ней',
      ];
    case 'gate-turn':
      return [
        `Ворота из двух низких конусов, ширина: ${len(p.width)}`,
        `Через ворота, петля ${TURN[turn]} за ними и обратно через те же ворота`,
        'Туда и обратно — по разным половинам ворот',
      ];
    case 'snail':
      return [
        `Двойная спираль из низких конусов, коридор шириной ${len(p.corridor)}`,
        'По одному коридору к центру, в центре перекладка буквой S, наружу по второму коридору между витками первого',
        'Стенки — полуокружности вокруг двух центров, конус примерно через 1,5 м',
      ];
    case 'tunnel':
      return [
        `Трое ворот, ширина: ${len(p.width)}`,
        `Между воротами вдоль оси: ${size(dims[1].value)}`,
        `Средние ворота смещены ${shift === 'left' ? 'влево' : 'вправо'} на ${len(p.shift)}`,
      ];
    case 'zigzag':
      return [
        `${cones.length / 2} пары низких конусов, шаг вдоль оси: ${len(p.step)}`,
        `Ширина коридора: ${len(p.width)}`,
        `Пары попеременно смещены вбок на ${len(p.shift)}, ехать посередине`,
      ];
    case 'corridor-slalom':
      return [
        `Коридор из низких конусов: длина ${size(dims[0].value)}, ширина ${len(p.width)}`,
        `Три перегородки через ${len(p.step)}, попеременно от стенок, длина перегородки ${len(Math.floor(p.width / 2))}`,
        'Змейкой вокруг концов перегородок',
      ];
    case 'box-eight':
      return [
        `Между центрами: ${len(p.distance)}`,
        `Синий — ${CLOCK.left}, красный — ${CLOCK.right}`,
        `Посередине ворота из двух низких конусов, ширина: ${len(p.gate)}`,
        `Габарит по угловым конусам: ${size(dims[2].value)} × ${size(dims[3].value)}, въезд и выезд — через длинные стороны у края`,
      ];
    case 'keyhole':
      return [
        `Кольцо из ${cones.filter((c) => c.height === 'low').length} низких конусов радиусом ${len(p.radius)}, проём ${len(p.opening)} направлен к подъезду`,
        `В центре ${colour(last)} высокий конус — якорь, от него рулеткой выставляется кольцо`,
        `Въезд в проём наискосок, круг ${CLOCK[turn]} внутри вокруг центрального конуса, выезд через тот же проём`,
      ];
    case 'crescent':
      return [
        `Полукруг радиусом ${len(p.radius)} снаружи пяти ${colours(first)} конусов`,
        `Затем рывок в другую сторону: четверть круга вокруг ${colourOf(last)} конуса`,
      ];
    case 'swerve':
      return [
        `Коридор из низких конусов: ширина ${len(p.width)}, длина ${size(dims[1].value)}`,
        `Тупик из трёх низких конусов в ${size(dims[2].value)} от конца коридора`,
        `Объезд тупика ${element.mirrored ? 'справа' : 'слева'}; на тренировке сторону показывает помощник в последний момент`,
      ];
    default:
      return [];
  }
}

const BIKE_NAMES = { sport: 'спорт', cruiser: 'крузер' };

const marginLabel = (v) => (v > 0 ? metres(v) : 'нет');
const SAFETY_SHORT = { runOff: 'выкат', pad: 'запас вокруг элемента', coneGap: 'у конуса разворота', trainGap: 'зазор паровозика', edge: 'отступ от края' };

/**
 * The safety margins of the course: every value (`values`, for the legend),
 * and a line naming the ones off their field rule, or null when none is —
 * whoever lays the course out must know the asphalt kept is not the usual.
 */
function safetySheet(recipe) {
  const values = safetyOf(recipe);
  const changed = SAFETY_OPTIONS.filter((o) => values[o.key] !== o.default && (o.key !== 'trainGap' || recipe.train));
  const label = changed.length
    ? `Безопасность не по умолчанию: ${changed.map((o) => `${SAFETY_SHORT[o.key]} ${marginLabel(values[o.key])} (обычно ${metres(o.default)})`).join(' · ')}`
    : null;
  return { values, label };
}

/** An element's own margins, set in «Правка», as card lines. */
function ownSafety(e) {
  if (!e.safety) return [];
  return [`Своя безопасность: ${Object.entries(e.safety).map(([k, v]) => `${SAFETY_SHORT[k]} ${marginLabel(v)}`).join(' · ')}`];
}

/**
 * The sizes the recipe fixed for this element's type, and whether the bike
 * class raised one: they are part of what the organiser asked for. A size the
 * element no longer has — it was changed by hand in the editor — is left out.
 */
function fixedSizes({ type, params }, diagonal, recipe) {
  const chosen = recipe.sizes?.[type];
  if (!chosen) return [];
  return SIZE_OPTIONS[type].filter((o) => chosen[o.key] !== undefined && keepsFixedSize(type, o.key, params, diagonal, recipe)).map((o) => {
    const value = chosen[o.key];
    const min = sizeMinimum(type, o.key, recipe.difficulty, recipe.bike);
    const raised = min !== null && value < min ? min : null;
    return {
      key: o.key,
      name: o.name,
      value,
      ...(raised !== null ? { raisedTo: raised } : {}),
      label: `Задано в рецепте: ${o.name.toLowerCase()} ${metres(value)}`
        + (raised !== null ? ` — мало для мотоцикла «${BIKE_NAMES[recipe.bike]}», взято не меньше ${metres(raised)}` : ''),
    };
  });
}

/**
 * How the way back of a `return` course crosses the start line: `square`
 * (straight back the way the rider left) or `angled` (at 45° to it).
 */
export function lineCrossing(startDir, finishDir) {
  return (((finishDir - startDir) % 8) + 8) % 8 === 4 ? 'square' : 'angled';
}

/** «поперёк линии», «под 45° к линии»: how the rider crosses the start line on the way back. */
export const CROSSING_LABELS = { square: 'поперёк линии', angled: 'под 45° к линии' };

function terminal(t, byId) {
  return {
    cones: t.cones.map((id) => ({ x: byId.get(id).hx / 2, y: byId.get(id).hy / 2 })),
    center: { x: t.x, y: t.y },
    dir: t.dir,
    travel: travelLabel(t.dir),
  };
}

// ---------------------------------------------------------------------------
// Arcs: the cones of a ring, a curved wall or a half circle are laid out with
// a tape from a centre, so their card gives the centre, the radius and how many
// cones go on the arc how far apart — not a row per cone (`arcsOf`).

/** A cone counts as on an arc this close to it: lattice snapping moves it up to half a 0.5 m cell's diagonal. */
const ON_ARC = 0.36;
const TAU = 2 * Math.PI;
/** The angle `a` measured anticlockwise from `from`, in [0, 2π). */
const fromStart = (a, from) => (((a - from) % TAU) + TAU) % TAU;
/** Which of the eight directions an angle (radians, anticlockwise from +X) is nearest to, as a word. */
const sideWord = (a) => DIR_LABELS[((Math.round(a / (Math.PI / 4)) % 8) + 8) % 8];

/** «№ 1–5», «№ 1–3, 7, 9–11»: cone numbers as runs, or null when they are too scattered to help. */
function coneRuns(ns) {
  const sorted = [...ns].sort((a, b) => a - b);
  const runs = [];
  for (const n of sorted) {
    const last = runs.at(-1);
    if (last && n === last[1] + 1) last[1] = n;
    else runs.push([n, n]);
  }
  if (runs.length > 3) return null;
  return `№ ${runs.map(([a, b]) => (a === b ? a : `${a}–${b}`)).join(', ')}`;
}

const conesWord = (n) => (n % 10 === 1 && n % 100 !== 11 ? 'конус' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? 'конуса' : 'конусов');

/**
 * The arcs an element's cones are laid out on, one per guide radius: centre
 * (site metres and from the anchor), radius, the cones on it in laying order,
 * the spacing between neighbours (along the arc and as a straight tape), and
 * where the first and last cone sit seen from the centre. A cone where two arcs
 * meet (the snail's spiral) is on both; every card cone on some arc gets `arc`,
 * the number of the first.
 */
function arcsOf(e, byId, anchor, cones) {
  const at = e.cones.map((id) => [byId.get(id).hx / 2, byId.get(id).hy / 2]);
  const arcs = [];
  for (const g of e.guides ?? []) {
    // Guides keep their angles in degrees, anticlockwise from +X.
    const from = (g.from * Math.PI) / 180;
    const span = ((g.to - g.from) * Math.PI) / 180;
    const full = span >= TAU - 1e-6;
    for (const radius of g.radii) {
      const slack = ON_ARC / radius;
      const on = [];
      at.forEach(([x, y], i) => {
        if (Math.abs(Math.hypot(x - g.x, y - g.y) - radius) > ON_ARC) return;
        const t = fromStart(Math.atan2(y - g.y, x - g.x), from);
        // Just short of the start reads as at the start.
        const u = t > TAU - slack ? t - TAU : t;
        if (full || u <= span + slack) on.push({ i, u });
      });
      if (on.length < 2) continue;
      on.sort((a, b) => a.u - b.u);
      // Lay out from the lower-numbered end: the anchor end, when it is on the arc.
      if (!full && on[0].i > on.at(-1).i) on.reverse();
      const n = on.length;
      const swept = full ? TAU : Math.abs(on.at(-1).u - on[0].u);
      const gaps = full ? n : n - 1;
      const step = (radius * swept) / gaps;
      const chord = 2 * radius * Math.sin(swept / gaps / 2);
      const angle = (k) => Math.atan2(at[on[k].i][1] - g.y, at[on[k].i][0] - g.x);
      const mid = from + (on[0].u + on.at(-1).u) / 2;
      const dx = g.x - anchor.hx / 2 + 0;
      const dy = g.y - anchor.hy / 2 + 0;
      arcs.push({
        center: { x: g.x, y: g.y },
        fromAnchor: { dx, dy },
        radius,
        full,
        degrees: full ? 360 : Math.round((span * 180) / Math.PI),
        cones: on.map((c) => cones[c.i].n),
        count: n,
        step: Math.round(step * 10) / 10,
        chord: Math.round(chord * 10) / 10,
        first: sideWord(angle(0)),
        last: sideWord(angle(n - 1)),
        via: sideWord(mid),
        gap: sideWord(mid + Math.PI),
      });
    }
  }
  const signed = (v) => (v > 0 ? `+${dist(v)}` : v < 0 ? `−${dist(-v)}` : '0,0');
  arcs.forEach((a, k) => {
    a.n = k + 1;
    const name = a.full ? 'Круг' : arcs.length > 1 ? `Дуга ${a.n}` : 'Дуга';
    const runs = coneRuns(a.cones);
    a.lines = [
      a.fromAnchor.dx === 0 && a.fromAnchor.dy === 0
        ? `${name} вокруг якоря, радиус ${metres(a.radius)}`
        : `${name}: центр от якоря X ${signed(a.fromAnchor.dx)} м · Y ${signed(a.fromAnchor.dy)} м, радиус ${metres(a.radius)}`,
      `${a.count} ${conesWord(a.count)}${runs ? ` (${runs})` : ''} через ${metres(a.step)} по дуге (${metres(a.chord)} по прямой)`
        + (a.full
          ? ', по всему кругу'
          : a.degrees > 270
            // A ring with an opening: its two ends sit close together, the opening says where.
            ? `; проём — ${a.gap} от центра, дуга ${a.degrees}°`
            : `; от центра первый — ${a.first}, последний — ${a.last}, дуга ${a.degrees}° через ${a.via}`),
    ];
    for (const n of a.cones) if (cones[n - 1].arc === undefined) cones[n - 1].arc = a.n;
  });
  return arcs;
}

/** One line for each cone of an arc element that is on none of its arcs: the crescent's flick cone. */
function looseCones(e, byId, anchor, cones) {
  const signed = (v) => (v > 0 ? `+${dist(v)}` : v < 0 ? `−${dist(-v)}` : '0,0');
  return cones.filter((c) => c.arc === undefined).map((c) => {
    const cone = byId.get(e.cones[c.n - 1]);
    const dx = (cone.hx - anchor.hx) / 2 + 0;
    const dy = (cone.hy - anchor.hy) / 2 + 0;
    const kind = c.height === 'low' ? 'низкий' : c.color === 'blue' ? 'синий высокий' : c.color === 'striped' ? 'красный с жёлтой полосой высокий' : 'красный высокий';
    return { n: c.n, dx, dy, label: `Конус ${c.n} (${kind}): от якоря X ${signed(dx)} м · Y ${signed(dy)} м` };
  });
}

/** Where arcs meet in a cone (the snail's spiral), that cone is set once. */
function sharedNote(arcs) {
  const seen = new Set();
  for (const a of arcs) {
    for (const n of a.cones) {
      if (seen.has(n)) return ['Где дуги сходятся, общий конус ставится один раз'];
      seen.add(n);
    }
  }
  return [];
}

/** Rings bigger than this (degrees) are laid out from their centre, which is their anchor on the sheet. */
const RING_DEGREES = 270;

/**
 * The point an element is measured from on the sheet: its anchor cone, or the
 * centre of a ring (a small or fast circle, a keyhole — where a tall cone
 * stands), since a ring is laid out with a tape swung from its centre. The
 * layout keeps its own anchor (the element's first cone, ADR 0012); only what
 * is measured on the asphalt moves.
 */
export function anchorPoint(e, byId) {
  const g = e.guides?.length === 1 && e.guides[0].radii.length === 1 ? e.guides[0] : null;
  // Off the lattice (ADR 0019) the centre is not on the 0.5 m grid: the anchor stays on its cone, on whole metres.
  if (g && g.to - g.from > RING_DEGREES && e.offLattice !== true) return { x: g.x, y: g.y, ring: true };
  // A waypoint has no cone: it is where it is.
  if (!e.anchor) return { x: e.at.x, y: e.at.y, ring: false };
  const c = byId.get(e.anchor);
  return { x: c.hx / 2, y: c.hy / 2, ring: false };
}

export function buildSetupSheet(course) {
  const byId = new Map(course.cones.map((c) => [c.id, c]));
  const color = new Map();
  for (const pass of course.passes) {
    if (pass.kind === 'gate') {
      color.set(pass.left, 'blue');
      color.set(pass.right, 'red');
    } else if (pass.kind === 'cone') {
      color.set(pass.cone, passColor(pass));
    }
  }
  const coneColor = (id) => (byId.get(id).height === 'tall' ? color.get(id) : 'neutral');

  // A waypoint (ADR 0026) is no element to lay out: a note on the route, not a card.
  const cards = course.elements.filter((e) => e.type !== WAYPOINT).map((e) => {
    const at = anchorPoint(e, byId);
    // In half-metre steps, like the cones.
    const anchor = { hx: at.x * 2, hy: at.y * 2 };
    // Off the lattice (ADR 0019) the element is built along a side and turned, so
    // its sizes are true lengths; its cones are laid out by X and Y like a diagonal's.
    const offLattice = e.offLattice === true;
    const diagonal = e.axis % 2 === 1 && !offLattice;
    const xy = diagonal || offLattice;
    const [sx, sy] = offLattice ? axisVector(e.axis) : AXIS_STEPS[e.axis];
    const cones = e.cones.map((id, i) => {
      const c = byId.get(id);
      const dx = (c.hx - anchor.hx) / 2 + 0;
      const dy = (c.hy - anchor.hy) / 2 + 0;
      const base = { n: i + 1, height: c.height, color: coneColor(id) };
      if (xy) return { ...base, dx, dy };
      // Side axes: along the axis, and across it measured to the left (+ 0 drops a −0).
      return { ...base, along: dx * sx + dy * sy + 0, across: -dx * sy + dy * sx + 0 };
    });
    const turn = ONE_WAY.has(e.type) ? netTurn(e.path) : null;
    const shift = e.type === 'lane-change' || e.type === 'tunnel' ? shiftSide(e, byId) : null;
    const pivot = course.passes.find((p) => p.element === e.id && p.angle);
    const points = e.cones.map((id) => [byId.get(id).hx / 2, byId.get(id).hy / 2]);
    const dims = DIMENSIONS[e.type].map((d) => dimension(points, e.axis, diagonal, offLattice, d));
    const fixed = fixedSizes(e, diagonal, course.recipe);
    const arcs = arcsOf(e, byId, anchor, cones);
    const loose = arcs.length ? looseCones(e, byId, anchor, cones) : [];
    return {
      number: e.order,
      element: e.id,
      type: e.type,
      name: TYPE_NAMES[e.type],
      anchor: { x: at.x, y: at.y },
      ...(at.ring ? { anchorAtCentre: true } : {}),
      axis: { index: e.axis, diagonal, offLattice, xy, vector: [sx, sy], label: axisLabel(e.axis, diagonal, offLattice) },
      travel: travelLabel(e.entry.dir),
      ...(pivot ? { angle: pivot.angle } : {}),
      turn,
      fixed,
      ...(e.safety ? { safety: e.safety } : {}),
      notes: [
        ...fixed.map((f) => f.label), ...ownSafety(e), ...describe(e, cones, diagonal, turn, shift, dims),
        ...arcs.flatMap((a) => a.lines), ...sharedNote(arcs),
        // A cone standing on the anchor (the keyhole's centre) needs no line of its own.
        ...loose.filter((l) => l.dx || l.dy).map((l) => l.label),
      ],
      cones,
      // An element laid out from arcs has no cone table: its cones are given by
      // the arcs and the lines for the cones off them (`loose`).
      table: !arcs.length,
      dims,
      arcs,
      loose,
    };
  });

  // Each anchor also from the previous one in passing order: a short tape run
  // from the element just laid out instead of a long one from corner A.
  const signed = (v) => (v > 0 ? `+${dist(v)}` : v < 0 ? `−${dist(-v)}` : '0,0');

  // U-turn cones of the connector leaving an element, measured from that
  // element's anchor like the next anchor in the chain.
  const orderOf = new Map(course.elements.map((e) => [e.id, e.order]));
  for (const card of cards) card.turnCones = [];
  for (const pass of course.passes) {
    if (!pass.connector) continue;
    // Off a start put by hand in «Правка» the way to element 1 can turn round a cone too: it is laid out with element 1.
    const fromStart = pass.connector.from === 'start';
    const card = fromStart ? cards[0] : cards.find((c) => c.element === pass.connector.from);
    const c = byId.get(pass.cone);
    const x = c.hx / 2;
    const y = c.hy / 2;
    const dx = x - card.anchor.x + 0;
    const dy = y - card.anchor.y + 0;
    const to = fromStart ? 'от старта к элементу 1' : pass.connector.to === 'finish' ? (course.route.shape === 'closed' ? 'к старту' : 'к финишу') : `к элементу ${orderOf.get(pass.connector.to)}`;
    const colour = pass.side === 'left' ? 'синего' : 'красного';
    card.turnCones.push({
      cone: pass.cone, x, y, dx, dy, side: pass.side, color: pass.side === 'left' ? 'blue' : 'red',
      label: `Связка ${to}: разворот ${TURN[pass.side]} вокруг ${colour} высокого конуса, от якоря ${card.number}: X ${signed(dx)} м · Y ${signed(dy)} м`,
    });
    card.notes.push(card.turnCones.at(-1).label);
  }
  cards.forEach((card, i) => {
    const prev = cards[i - 1];
    if (!prev) {
      card.fromPrevious = null;
      return;
    }
    const dx = card.anchor.x - prev.anchor.x + 0;
    const dy = card.anchor.y - prev.anchor.y + 0;
    card.fromPrevious = { from: prev.number, dx, dy, label: `От якоря ${prev.number}: X ${signed(dx)} м · Y ${signed(dy)} м` };
  });

  // Each waypoint, measured from corner A, and noted on the card of the element before it (the first card for one before them all).
  const waypoints = course.elements.filter((e) => e.type === WAYPOINT).map((e) => ({
    number: e.order, x: e.at.x, y: e.at.y, label: `Опорная точка ${e.order}: проезд через точку X ${fmt(e.at.x)} · Y ${fmt(e.at.y)} м`,
  }));
  for (const w of waypoints) {
    const card = cards.filter((c) => c.number < w.number).at(-1) ?? cards[0];
    if (card) card.notes.push(w.number < card.number ? `До элемента: ${w.label}` : `Дальше: ${w.label}`);
  }

  const coneList = { tallBlue: 0, tallRed: 0, tallStriped: 0, low: 0 };
  for (const c of course.cones) {
    if (c.height === 'low') coneList.low++;
    else if (color.get(c.id) === 'blue') coneList.tallBlue++;
    else if (color.get(c.id) === 'striped') coneList.tallStriped++;
    else coneList.tallRed++;
  }

  const start = terminal(course.route.start, byId);
  const { shape } = course.route;
  const finish = shape === 'closed' ? start : terminal(course.route.finish, byId);
  // A finish by the start is the start's own line, crossed back into its box.
  if (shape === 'return') {
    const [a, b] = start.cones;
    start.box = { size: Math.hypot(b.x - a.x, b.y - a.y) };
    finish.crossing = lineCrossing(start.dir, finish.dir);
  }
  // Cutouts and obstacles, measured from corner A like everything else: the corner nearest it, then the size.
  // With its margin: its own, or the lot edge's (ADR 0022).
  const blocked = (course.site.blocked ?? []).map((b, i) => {
    const name = `${b.kind === 'cutout' ? 'Вырез' : 'Препятствие'} ${i + 1}`;
    const margin = b.margin ?? course.site.margin;
    const own = b.margin !== undefined && b.margin !== course.site.margin;
    return {
      n: i + 1, kind: b.kind, name, x: b.x, y: b.y, w: b.w, h: b.h, margin,
      label: `${name}: угол X ${fmt(b.x)} · Y ${fmt(b.y)} м, по X ${fmt(b.w)} м, по Y ${fmt(b.h)} м; отступ ${margin > 0 ? `${fmt(margin)} м` : 'нет'}${own ? '' : ', как от края площадки'}`,
    };
  });
  return {
    site: { width: course.site.width, length: course.site.length, blocked },
    safety: safetySheet(course.recipe),
    bike: course.recipe.bike,
    shape: course.route.shape,
    requested: course.requested,
    placed: course.placed,
    start,
    finish,
    cards,
    waypoints,
    coneList,
  };
}
