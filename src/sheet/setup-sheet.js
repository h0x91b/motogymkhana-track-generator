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

const ONE_WAY = new Set(['u-turn', 'pivot-turn', 'box']);

/** Net turning of a U-turn, pivot or box (±180° or more, never near zero). */
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

/** Which way the second gate of a lane change is shifted, seen in the direction of travel. */
function shiftSide(element, byId) {
  const [a, b, c, d] = element.cones.map((id) => byId.get(id));
  const mx = c.hx + d.hx - a.hx - b.hx;
  const my = c.hy + d.hy - a.hy - b.hy;
  const [ux, uy] = AXIS_STEPS[element.entry.dir];
  return ux * my - uy * mx > 0 ? 'left' : 'right';
}

const CLOCK = { left: 'против часовой стрелки', right: 'по часовой стрелке' };
const TURN = { left: 'налево', right: 'направо' };

/**
 * Human summary of the sizes, multiples of 0.5 m only. On a diagonal a length
 * of k lattice steps is laid out as k × 0.5 m along X and along Y.
 */
function describe(element, cones, diagonal, turn, shift) {
  const p = element.params;
  const len = (steps) => (diagonal ? `${metres(steps * 0.5)} по X и ${metres(steps * 0.5)} по Y` : metres(steps * 0.5));
  const first = cones[0];
  const colour = (c) => (c.color === 'blue' ? 'синий' : 'красный');
  switch (element.type) {
    case 'straight-slalom':
      return [`${p.count} конусов, шаг: ${len(p.step)}`, `Первый конус ${colour(first)}, дальше цвета чередуются`];
    case 'offset-slalom':
      return [`${p.count} конусов, шаг вдоль оси: ${len(p.step)}`, `Конусы попеременно в двух рядах, между рядами ${len(2 * p.shift)}`, `Первый конус ${colour(first)}`];
    case 'gate':
      return [`Ширина: ${len(p.width)}`, 'Проехать между конусами: синий слева, красный справа'];
    case 'lane-change':
      return [`Двое ворот, ширина: ${len(p.width)}`, `Вторые ворота смещены ${shift === 'left' ? 'влево' : 'вправо'} на ${len(p.shift)}`];
    case 'u-turn':
      return [`Ширина зоны поперёк оси: ${len(p.width)}`, `Разворот ${TURN[turn]} внутри, въезд и выезд с открытой стороны`];
    case 'pivot-turn':
      return [`Вращение ${p.angle}° ${CLOCK[turn]} вокруг конуса`, `Свободный радиус: ${metres(p.radius)}`];
    case 'figure-eight':
      return [`Между центрами: ${len(p.distance)}`, `Синий — ${CLOCK.left}, красный — ${CLOCK.right}`, 'Петли вытянуты вдоль линии центров'];
    case 'box':
      return [`Сторона коробки: ${len(p.size)}`, `Внутри поворот на 270° ${TURN[turn]}, выезд через сторону ${turn === 'left' ? 'справа' : 'слева'} от въезда`];
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
    } else {
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
    const shift = e.type === 'lane-change' ? shiftSide(e, byId) : null;
    const pivot = course.passes.find((p) => p.element === e.id && p.angle);
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
      notes: describe(e, cones, diagonal, turn, shift),
      cones,
    };
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
    closed: course.route.closed,
    requested: course.requested,
    placed: course.placed,
    generatorVersion: course.generatorVersion,
    start,
    finish: course.route.closed ? start : terminal(course.route.finish, byId),
    cards,
    coneList,
  };
}
