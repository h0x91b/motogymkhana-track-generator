// Setup sheet data model: what the picture says, as numbers. Everything is
// derived from the course; nothing here is needed to draw the course itself.
// Contract: cone positions can be rebuilt from this data alone.

import { TYPE_NAMES } from '../generator/catalog.js';
import { AXIS_STEPS } from '../generator/geometry.js';

export const fmt = (v) => {
  const r = Math.round(v * 100) / 100;
  return String(Object.is(r, -0) ? 0 : r).replace('.', ',').replace('-', '−');
};
export const metres = (v) => `${fmt(v)} м`;

const DIR_LABELS = ['→ вправо', '↗ вправо-вверх', '↑ вверх', '↖ влево-вверх', '← влево', '↙ влево-вниз', '↓ вниз', '↘ вправо-вниз'];

function axisLabel(axis) {
  if (axis % 2 === 1) return `по диагонали, ${DIR_LABELS[axis]}`;
  return `${axis % 4 === 0 ? 'вдоль ширины' : 'вдоль длины'}, ${DIR_LABELS[axis]}`;
}

export const travelLabel = (dir) => DIR_LABELS[dir];

const ONE_WAY = new Set(['u-turn', 'pivot-turn', 'box', 'circle', 'mirror', 'gate-turn', 'keyhole']);

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
  const [ux, uy] = AXIS_STEPS[element.entry.dir];
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
};

const half = (v) => Math.round(v * 2) / 2 + 0;

/**
 * One dimension line in site metres. On a diagonal its value is the offset by
 * X and by Y (equal), which is what is laid out with a tape, not the slant length.
 */
function dimension(points, axis, [kind, i, j]) {
  const [sx, sy] = AXIS_STEPS[axis];
  const [ax, ay] = points[i];
  const [bx, by] = points[j];
  const t = ((bx - ax) * sx + (by - ay) * sy) / (sx * sx + sy * sy);
  const foot = [half(ax + t * sx), half(ay + t * sy)];
  const [from, to] = kind === 'along' ? [[ax, ay], foot] : [foot, [bx, by]];
  const dx = Math.abs(to[0] - from[0]);
  const dy = Math.abs(to[1] - from[1]);
  const diagonal = axis % 2 === 1;
  const value = diagonal ? dx : dx + dy;
  return {
    kind,
    from: { x: from[0], y: from[1] },
    to: { x: to[0], y: to[1] },
    value,
    label: diagonal ? `${metres(value)} по X и Y` : metres(value),
  };
}

const CLOCK = { left: 'против часовой стрелки', right: 'по часовой стрелке' };
const TURN = { left: 'налево', right: 'направо' };

/** Diameter in metres of the round loops of a figure eight `distance` lattice steps across (D = 2√2 r). */
const loopDiameter = (distance, diagonal) => (distance * (diagonal ? 0.5 * Math.SQRT2 : 0.5)) / Math.SQRT2;

/**
 * Human summary of the sizes, multiples of 0.5 m only. On a diagonal a length
 * of k lattice steps is laid out as k × 0.5 m along X and along Y.
 */
function describe(element, cones, diagonal, turn, shift, dims) {
  const p = element.params;
  const size = (m) => (diagonal ? `${metres(m)} по X и ${metres(m)} по Y` : metres(m));
  const len = (steps) => size(steps * 0.5);
  const first = cones[0];
  const last = cones[cones.length - 1];
  const colour = (c) => (c.color === 'blue' ? 'синий' : 'красный');
  const colours = (c) => (c.color === 'blue' ? 'синих' : 'красных');
  const colourOf = (c) => (c.color === 'blue' ? 'синего' : 'красного');
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
      return [`Вращение ${p.angle}° ${CLOCK[turn]} вокруг конуса`, `Свободный радиус: ${metres(p.radius)}`];
    case 'figure-eight':
      return [
        `Между центрами: ${len(p.distance)}`,
        `Синий — ${CLOCK.left}, красный — ${CLOCK.right}`,
        `Петли — круги вокруг конусов, по линии езды около Ø ${metres(Math.round(2 * loopDiameter(p.distance, diagonal)) / 2)}`,
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
        `Кольцо из ${cones.length} низких конусов радиусом ${len(p.radius)}, проём ${len(p.opening)} к подъезду`,
        `Въезд в проём наискосок, круг ${CLOCK[turn]} внутри, выезд через тот же проём`,
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

function terminal(t, byId) {
  return {
    cones: t.cones.map((id) => ({ x: byId.get(id).hx / 2, y: byId.get(id).hy / 2 })),
    center: { x: t.x, y: t.y },
    dir: t.dir,
    travel: travelLabel(t.dir),
  };
}

export function buildSetupSheet(course) {
  const byId = new Map(course.cones.map((c) => [c.id, c]));
  const color = new Map();
  for (const pass of course.passes) {
    if (pass.kind === 'gate') {
      color.set(pass.left, 'blue');
      color.set(pass.right, 'red');
    } else if (pass.kind === 'cone') {
      color.set(pass.cone, pass.side === 'left' ? 'blue' : 'red');
    }
  }
  const coneColor = (id) => (byId.get(id).height === 'tall' ? color.get(id) : 'neutral');

  const cards = course.elements.map((e) => {
    const anchor = byId.get(e.anchor);
    const diagonal = e.axis % 2 === 1;
    const [sx, sy] = AXIS_STEPS[e.axis];
    const cones = e.cones.map((id, i) => {
      const c = byId.get(id);
      const dx = (c.hx - anchor.hx) / 2 + 0;
      const dy = (c.hy - anchor.hy) / 2 + 0;
      const base = { n: i + 1, height: c.height, color: coneColor(id) };
      if (diagonal) return { ...base, dx, dy };
      // Side axes: along the axis, and across it measured to the left (+ 0 drops a −0).
      return { ...base, along: dx * sx + dy * sy + 0, across: -dx * sy + dy * sx + 0 };
    });
    const turn = ONE_WAY.has(e.type) ? netTurn(e.path) : null;
    const shift = e.type === 'lane-change' || e.type === 'tunnel' ? shiftSide(e, byId) : null;
    const pivot = course.passes.find((p) => p.element === e.id && p.angle);
    const points = e.cones.map((id) => [byId.get(id).hx / 2, byId.get(id).hy / 2]);
    const dims = DIMENSIONS[e.type].map((d) => dimension(points, e.axis, d));
    const arcs = (e.guides ?? []).map((g) => ({
      center: { x: g.x, y: g.y },
      radii: g.radii,
      from: g.from,
      to: g.to,
      label: `Центр X ${fmt(g.x)} · Y ${fmt(g.y)}: ${g.radii.length > 1 ? 'дуги радиусом' : 'дуга радиусом'} ${g.radii.map(fmt).join('; ')} м`,
    }));
    return {
      number: e.order,
      element: e.id,
      type: e.type,
      name: TYPE_NAMES[e.type],
      anchor: { x: anchor.hx / 2, y: anchor.hy / 2 },
      axis: { index: e.axis, diagonal, vector: [sx, sy], label: axisLabel(e.axis) },
      travel: travelLabel(e.entry.dir),
      ...(pivot ? { angle: pivot.angle } : {}),
      turn,
      notes: [...describe(e, cones, diagonal, turn, shift, dims), ...arcs.map((a) => a.label)],
      cones,
      dims,
      arcs,
    };
  });

  // Each anchor also from the previous one in passing order: a short tape run
  // from the element just laid out instead of a long one from corner A.
  const signed = (v) => (v > 0 ? `+${fmt(v)}` : v < 0 ? `−${fmt(-v)}` : '0');

  // U-turn cones of the connector leaving an element, measured from that
  // element's anchor like the next anchor in the chain.
  const orderOf = new Map(course.elements.map((e) => [e.id, e.order]));
  for (const card of cards) card.turnCones = [];
  for (const pass of course.passes) {
    if (!pass.connector) continue;
    const card = cards.find((c) => c.element === pass.connector.from);
    const c = byId.get(pass.cone);
    const x = c.hx / 2;
    const y = c.hy / 2;
    const dx = x - card.anchor.x + 0;
    const dy = y - card.anchor.y + 0;
    const to = pass.connector.to === 'finish' ? (course.route.closed ? 'к старту' : 'к финишу') : `к элементу ${orderOf.get(pass.connector.to)}`;
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

  const coneList = { tallBlue: 0, tallRed: 0, low: 0 };
  for (const c of course.cones) {
    if (c.height === 'low') coneList.low++;
    else if (color.get(c.id) === 'blue') coneList.tallBlue++;
    else coneList.tallRed++;
  }

  const start = terminal(course.route.start, byId);
  return {
    site: { width: course.site.width, length: course.site.length },
    bike: course.recipe.bike,
    closed: course.route.closed,
    requested: course.requested,
    placed: course.placed,
    start,
    finish: course.route.closed ? start : terminal(course.route.finish, byId),
    cards,
    coneList,
  };
}
