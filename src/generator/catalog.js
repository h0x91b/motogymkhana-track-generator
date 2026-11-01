// Element type catalog.
//
// Every type is built in a local lattice frame: `a` along the element axis,
// `b` across it (positive = left of the axis direction). One lattice step is
// 0.5 m on an axis along a site side and 0.5 m × √2 on a diagonal, where a
// step means ΔX = ±ΔY = 0.5 m. Cones sit on integer lattice points, so after
// placement every cone lands on the 0.5 m grid; the anchor cone is the local
// origin and is placed on whole metres by the generator.
//
// The generator only talks to `typeOptions`, `chooseParams`, `minimalParams`
// and `instantiate`; everything else here is private to the catalog.

import { atan, atan2, PI, sin } from './dmath.js';
import { arcPoints, ellipsePoints, latticeUnit, smoothPath, turning } from './geometry.js';

/**
 * Starting sizes per difficulty (SPEC «Начальные размеры по сложности»).
 * A pair is an inclusive range of centre-to-centre metres; a single value V
 * means "V on the 0.5 m grid", i.e. V ± 0.25 m. On a side axis that admits V
 * only; on a diagonal it admits the nearest √2-lattice length if it is that
 * close. A type whose range has no lattice length on diagonals is placed on
 * side axes only at that difficulty.
 */
export const DIFFICULTY_TABLE = {
  easy: {
    slalomStep: [4.5, 5], offsetStep: [5, 6], offsetShift: [1, 1.5], gateWidth: [2.5], laneShift: [2, 2.5],
    uTurnWidth: [8], pivotRadius: 3, pivotAngles: [270], eightDistance: [8], boxSize: [8], turnRadius: 4,
  },
  medium: {
    slalomStep: [3.5, 4], offsetStep: [4, 5], offsetShift: [1.5, 2], gateWidth: [2], laneShift: [2.5, 3],
    uTurnWidth: [7], pivotRadius: 2.5, pivotAngles: [270, 360], eightDistance: [7], boxSize: [7], turnRadius: 3,
  },
  hard: {
    slalomStep: [3, 3.5], offsetStep: [3.5, 4.5], offsetShift: [2, 2.5], gateWidth: [1.5], laneShift: [3, 3.5],
    uTurnWidth: [6], pivotRadius: 2, pivotAngles: [360], eightDistance: [6], boxSize: [6], turnRadius: 2.5,
  },
};

/** Clearance around an element's cones and trajectory that no other element or connector may enter. */
export const ZONE_PAD = 0.75;

export const TYPE_NAMES = {
  'straight-slalom': 'Прямой слалом',
  'offset-slalom': 'Офсетный слалом',
  gate: 'Ворота',
  'lane-change': 'Переставка',
  'u-turn': 'Разворот',
  'pivot-turn': 'Вращение',
  'figure-eight': 'Восьмёрка',
  box: 'Коробка',
};

// Trajectory-hint constants (metres). Visual only, but they size the zones.
const WEAVE = 1; // how far the rider passes a slalom cone
const LEAD = 1.5; // straight run before / after gates
const WALL = 1; // rider clearance from the low cones of a U-turn or a box

function latticeChoices(range, unit) {
  const [lo, hi] = range.length === 1 ? [range[0] - 0.25, range[0] + 0.25] : range;
  const out = [];
  for (let k = Math.max(1, Math.ceil(lo / unit - 1e-9)); k * unit <= hi + 1e-9; k++) out.push(k);
  return out;
}

const TYPES = {
  'straight-slalom': {
    options: (t, unit) => ({ count: [4, 5, 6], step: latticeChoices(t.slalomStep, unit) }),
    build({ count, step }, unit) {
      const w = WEAVE / unit;
      const cones = [];
      const passes = [];
      const pts = [[-0.6 * step, 0]];
      for (let i = 0; i < count; i++) {
        cones.push({ a: i * step, b: 0, height: 'tall' });
        passes.push({ kind: 'cone', cone: i, side: i % 2 === 0 ? 'left' : 'right' });
        pts.push([i * step, i % 2 === 0 ? -w : w]);
      }
      pts.push([(count - 1 + 0.6) * step, 0]);
      return { cones, passes, path: smoothPath(pts, [1, 0], [1, 0]), entryDir: [1, 0], exitDir: [1, 0] };
    },
  },

  'offset-slalom': {
    options: (t, unit) => ({
      count: [4, 5, 6],
      step: latticeChoices(t.offsetStep, unit),
      shift: latticeChoices(t.offsetShift, unit),
    }),
    build({ count, step, shift }, unit) {
      const w = WEAVE / unit;
      const cones = [];
      const passes = [];
      const pts = [[-0.6 * step, shift]];
      for (let i = 0; i < count; i++) {
        const odd = i % 2 === 1;
        cones.push({ a: i * step, b: odd ? 2 * shift : 0, height: 'tall' });
        passes.push({ kind: 'cone', cone: i, side: odd ? 'right' : 'left' });
        pts.push([i * step, odd ? 2 * shift + w : -w]);
      }
      pts.push([(count - 1 + 0.6) * step, shift]);
      return { cones, passes, path: smoothPath(pts, [1, 0], [1, 0]), entryDir: [1, 0], exitDir: [1, 0] };
    },
  },

  gate: {
    options: (t, unit) => ({ width: latticeChoices(t.gateWidth, unit) }),
    build({ width }, unit) {
      const lead = LEAD / unit;
      return {
        cones: [{ a: 0, b: 0, height: 'tall' }, { a: 0, b: -width, height: 'tall' }],
        passes: [{ kind: 'gate', left: 0, right: 1 }],
        path: [[-lead, -width / 2], [lead, -width / 2]],
        entryDir: [1, 0],
        exitDir: [1, 0],
      };
    },
  },

  'lane-change': {
    options: (t, unit) => ({ width: latticeChoices(t.gateWidth, unit), shift: latticeChoices(t.laneShift, unit) }),
    build({ width, shift }, unit) {
      const length = 3 * shift;
      const lead = LEAD / unit;
      // Straight through each gate; between them an S of two equal arcs, leaning
      // towards the shift first and changing lean (перекладка) halfway.
      const y0 = -width / 2;
      const y1 = shift - width / 2;
      const sweep = 2 * atan(shift / length);
      const r = length / (2 * sin(sweep));
      const path = [
        [-lead, y0],
        ...arcPoints([0, y0 + r], r, -PI / 2, sweep, PI / 36),
        ...arcPoints([length, y1 - r], r, PI / 2 + sweep, -sweep, PI / 36).slice(1),
        [length + lead, y1],
      ];
      return {
        cones: [
          { a: 0, b: 0, height: 'tall' }, { a: 0, b: -width, height: 'tall' },
          { a: length, b: shift, height: 'tall' }, { a: length, b: shift - width, height: 'tall' },
        ],
        passes: [{ kind: 'gate', left: 0, right: 1 }, { kind: 'gate', left: 2, right: 3 }],
        path,
        entryDir: [1, 0],
        exitDir: [1, 0],
      };
    },
  },

  'u-turn': {
    options: (t, unit) => ({ width: latticeChoices(t.uTurnWidth, unit) }),
    build({ width }, unit) {
      const r = width / 2 - WALL / unit;
      const depth = Math.round(r + (WALL + 1.5) / unit);
      const cx = depth - WALL / unit - r;
      const mid = width / 2;
      const path = [[0, mid - r], ...arcPoints([cx, mid], r, -PI / 2, PI), [0, mid + r]];
      return {
        cones: [
          { a: 0, b: 0, height: 'low' }, { a: depth, b: 0, height: 'low' },
          { a: depth, b: width, height: 'low' }, { a: 0, b: width, height: 'low' },
        ],
        passes: [],
        path,
        entryDir: [1, 0],
        exitDir: [-1, 0],
      };
    },
  },

  'pivot-turn': {
    options: (t) => ({ angle: t.pivotAngles }),
    build({ angle, radius }, unit) {
      const r = (radius - 0.5) / unit;
      const lead = r + 1 / unit;
      const sweep = (angle * PI) / 180;
      const arc = arcPoints([0, 0], r, -PI / 2, sweep);
      const path = [[-lead, -r], ...arc];
      if (angle === 360) path.push([lead, -r]);
      else path.push([-r, -lead]);
      return {
        cones: [{ a: 0, b: 0, height: 'tall' }],
        passes: [{ kind: 'cone', cone: 0, side: 'left', angle }],
        path,
        entryDir: [1, 0],
        exitDir: angle === 360 ? [1, 0] : [0, -1],
      };
    },
  },

  'figure-eight': {
    options: (t, unit) => ({ distance: latticeChoices(t.eightDistance, unit) }),
    build({ distance }) {
      // Loops are ellipses centred on the cones, stretched along the centre line
      // (rx > ry). The crossing lines are their common inner tangents through the
      // midpoint; with rx = 0.4 D they cross at exactly ±45°.
      const rx = 0.4 * distance;
      const ry = 0.3 * distance;
      const phi = atan2(0.6, 0.8);
      const a = [0, 0];
      const b = [distance, 0];
      const path = [
        ...ellipsePoints(a, rx, ry, PI, 2 * PI - phi),
        ...ellipsePoints(b, rx, ry, PI - phi, phi - PI),
        ...ellipsePoints(a, rx, ry, phi, PI),
      ];
      return {
        cones: [{ a: 0, b: 0, height: 'tall' }, { a: distance, b: 0, height: 'tall' }],
        passes: [{ kind: 'cone', cone: 0, side: 'left' }, { kind: 'cone', cone: 1, side: 'right' }],
        path,
        entryDir: [0, -1],
        exitDir: [0, -1],
      };
    },
  },

  box: {
    options: (t, unit) => ({ size: latticeChoices(t.boxSize, unit) }),
    build({ size }, unit) {
      // Enter through one side, turn 270° inside, leave through the side on the right.
      const r = size / 2 - WALL / unit;
      const c = [size / 2, size / 2];
      const path = [[0, c[1] - r], ...arcPoints(c, r, -PI / 2, (3 * PI) / 2), [c[0] - r, 0]];
      return {
        cones: [
          { a: 0, b: 0, height: 'low' }, { a: size, b: 0, height: 'low' },
          { a: size, b: size, height: 'low' }, { a: 0, b: size, height: 'low' },
        ],
        passes: [],
        path,
        entryDir: [1, 0],
        exitDir: [0, -1],
      };
    },
  },
};

const unitFor = (diagonal) => latticeUnit(diagonal);

/**
 * Lattice options for a type at a difficulty on one axis class, or null when
 * some size has no lattice length in range (the type cannot go diagonal then).
 */
export function typeOptions(type, difficulty, diagonal) {
  const opts = TYPES[type].options(DIFFICULTY_TABLE[difficulty], unitFor(diagonal));
  return Object.values(opts).every((list) => list.length > 0) ? opts : null;
}

function paramsFromDraws(type, difficulty, diagonal, draws) {
  const opts = typeOptions(type, difficulty, diagonal);
  if (!opts) return null;
  const params = {};
  Object.keys(opts).forEach((key, i) => {
    const list = opts[key];
    params[key] = list[Math.min(list.length - 1, Math.floor(draws[i] * list.length))];
  });
  if (type === 'pivot-turn') params.radius = DIFFICULTY_TABLE[difficulty].pivotRadius;
  return params;
}

/**
 * Draws one set of size choices and maps it onto both axis classes, so the
 * same draw means "the same size, as close as the lattice allows" on a side
 * axis and on a diagonal.
 * @returns {{side: object|null, diagonal: object|null}}
 */
export function chooseParams(type, difficulty, rng) {
  const keys = Object.keys(TYPES[type].options(DIFFICULTY_TABLE[difficulty], 0.5));
  const draws = keys.map(() => rng.float());
  return {
    side: paramsFromDraws(type, difficulty, false, draws),
    diagonal: paramsFromDraws(type, difficulty, true, draws),
  };
}

/** The most compact size choices (used when the drawn ones do not fit the site). */
export function minimalParams(type, difficulty) {
  const keys = Object.keys(TYPES[type].options(DIFFICULTY_TABLE[difficulty], 0.5));
  const draws = keys.map(() => 0);
  return {
    side: paramsFromDraws(type, difficulty, false, draws),
    diagonal: paramsFromDraws(type, difficulty, true, draws),
  };
}

function flipDir([da, db]) {
  return [da, -db];
}

function mirrorGeometry(g) {
  return {
    cones: g.cones.map((c) => ({ ...c, b: -c.b })),
    passes: g.passes.map((p) =>
      p.kind === 'gate'
        ? { ...p, left: p.right, right: p.left }
        : { ...p, side: p.side === 'left' ? 'right' : 'left' }),
    path: g.path.map(([a, b]) => [a, -b]),
    entryDir: flipDir(g.entryDir),
    exitDir: flipDir(g.exitDir),
  };
}

function boundaryPoint(point, dir, box, outward) {
  // Walk from `point` along ±dir (axis-aligned) to the zone rectangle edge.
  const s = outward ? 1 : -1;
  const [da, db] = [dir[0] * s, dir[1] * s];
  if (da > 0) return [box[2], point[1]];
  if (da < 0) return [box[0], point[1]];
  if (db > 0) return [point[0], box[3]];
  return [point[0], box[1]];
}

/**
 * Builds the local template of one element: cones, passes, trajectory with
 * entry and exit poses on the zone edge, the zone rectangle and the core
 * rectangle (cones + trajectory, without the clearance pad).
 * All coordinates are in lattice steps of this axis class.
 */
export function instantiate(type, params, diagonal, mirrored) {
  const unit = unitFor(diagonal);
  let g = TYPES[type].build(params, unit);
  if (mirrored) g = mirrorGeometry(g);
  let a0 = Infinity;
  let b0 = Infinity;
  let a1 = -Infinity;
  let b1 = -Infinity;
  for (const p of [...g.cones.map((c) => [c.a, c.b]), ...g.path]) {
    if (p[0] < a0) a0 = p[0];
    if (p[1] < b0) b0 = p[1];
    if (p[0] > a1) a1 = p[0];
    if (p[1] > b1) b1 = p[1];
  }
  const core = [a0, b0, a1, b1];
  const pad = ZONE_PAD / unit;
  const zone = [a0 - pad, b0 - pad, a1 + pad, b1 + pad];
  const entry = boundaryPoint(g.path[0], g.entryDir, zone, false);
  const exit = boundaryPoint(g.path[g.path.length - 1], g.exitDir, zone, true);
  const path = [entry, ...g.path, exit];
  const turn = turning(path);
  return {
    type,
    params,
    diagonal,
    mirrored,
    unit,
    cones: g.cones,
    passes: g.passes,
    path,
    entryDir: g.entryDir,
    exitDir: g.exitDir,
    core,
    zone,
    turnLeft: turn.left,
    turnRight: turn.right,
  };
}
