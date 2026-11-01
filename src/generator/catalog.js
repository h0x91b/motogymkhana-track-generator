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

import { acos, atan, atan2, cos, PI, sin } from './dmath.js';
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
    uTurnWidth: [8], pivotRadius: 3, pivotAngles: [270], eightDistance: [9, 12], boxSize: [8],
    circleRadius: [3.5], circleStretch: [0, 2], mirrorLine: [6], mirrorRadius: 3, gateTurnWidth: [4.5], loopRadius: 3.5,
    tunnelGap: [5], tunnelShift: [1.5], zigzagStep: [4], zigzagShift: [1.5], zigzagWidth: [2.5],
    snakeWidth: [5], snakeStep: [3.5], crescentRadius: [7], flickRadius: 3.5, swerveWidth: [2.5], swerveRun: [8],
  },
  medium: {
    slalomStep: [3.5, 4], offsetStep: [4, 5], offsetShift: [1.5, 2], gateWidth: [2], laneShift: [2.5, 3],
    uTurnWidth: [7], pivotRadius: 2.5, pivotAngles: [270, 360], eightDistance: [7, 9], boxSize: [7],
    circleRadius: [2.5], circleStretch: [0, 2, 3], mirrorLine: [5.5], mirrorRadius: 2.5, gateTurnWidth: [4], loopRadius: 3,
    tunnelGap: [4.5], tunnelShift: [2], zigzagStep: [3.5], zigzagShift: [2], zigzagWidth: [2],
    snakeWidth: [4.5], snakeStep: [3], crescentRadius: [6], flickRadius: 3, swerveWidth: [2], swerveRun: [7],
    snailCorridor: [2.5], boxEightDistance: [6], boxEightGate: [3], keyholeRadius: [3.5], keyholeOpening: [2.5],
  },
  hard: {
    slalomStep: [3, 3.5], offsetStep: [3.5, 4.5], offsetShift: [2, 2.5], gateWidth: [1.5], laneShift: [3, 3.5],
    uTurnWidth: [6], pivotRadius: 2, pivotAngles: [360, 720], eightDistance: [6, 7], boxSize: [6],
    circleRadius: [2], circleStretch: [0, 2], mirrorLine: [5], mirrorRadius: 2, gateTurnWidth: [3.5], loopRadius: 2.5,
    tunnelGap: [4], tunnelShift: [2.5], zigzagStep: [3], zigzagShift: [2.5], zigzagWidth: [1.5],
    snakeWidth: [4], snakeStep: [3], crescentRadius: [5], flickRadius: 2.5, swerveWidth: [2], swerveRun: [6],
    snailCorridor: [2], boxEightDistance: [6], boxEightGate: [2.5], keyholeRadius: [3], keyholeOpening: [2],
  },
};

// The tightest turn a rider of each bike class makes with room for a mistake,
// as the radius of the line ridden: Ø 7–8 m on a sport bike, Ø 9 m on a cruiser
// (an organiser's figures; 9 m is the most he has seen laid out in a confined
// space, for a Vulcan 1700). Connectors turn no tighter.
export const BIKE_TURN_RADIUS = { sport: 3.75, cruiser: 4.5 };

/** Clearance around an element's cones and trajectory that no other element or connector may enter. */
export const ZONE_PAD = 0.75;

// A big element takes a good part of a site: its core (cones and trajectory,
// without the clearance) covers this many square metres or more at the sizes
// it was given. A course has at most one. A snail and a crescent are always
// big; an offset slalom often, an easy figure eight sometimes, an easy circle
// rarely; every other type stays under 90 m².
export const BIG_ELEMENT_AREA = 120;

/** Area of a template's core in square metres. */
export const coreArea = (tpl) => (tpl.core[2] - tpl.core[0]) * (tpl.core[3] - tpl.core[1]) * tpl.unit * tpl.unit;

/** Is an element of this template a big element? */
export const isBig = (tpl) => coreArea(tpl) >= BIG_ELEMENT_AREA;

export const TYPE_NAMES = {
  'straight-slalom': 'Прямой слалом',
  'offset-slalom': 'Офсетный слалом',
  gate: 'Ворота',
  'lane-change': 'Переставка',
  'u-turn': 'Разворот',
  'pivot-turn': 'Вращение',
  'figure-eight': 'Восьмёрка',
  box: 'Коробка',
  circle: 'Круг',
  mirror: 'Зеркало',
  'gate-turn': 'Разворот за воротами',
  snail: 'Улитка',
  tunnel: 'Тоннель',
  zigzag: 'Зигзаг',
  'corridor-slalom': 'Змейка в коридоре',
  'box-eight': 'Восьмёрка в габарите',
  keyhole: 'Замочная скважина',
  crescent: 'Месяц',
  swerve: 'Лосиный тест',
};

// Trajectory-hint constants (metres). Visual only, but they size the zones.
const WEAVE = 1; // how far the rider passes a slalom cone
const LEAD = 1.5; // straight run before / after gates
const WALL = 1; // rider clearance from the low cones of a U-turn or a box
const ARC = PI / 36; // arc sampling of the new types' trajectories
const TURN_OUT = 2; // circle: radius of the turn off the ring
const RING_SPACING = 2.5; // about this far between the cones of a ring
const WALL_SPACING = 1.5; // about this far between the cones of a curved wall
const MIRROR_OVER = 0.5; // how far past the mirror line the wheel goes at the apex
const GATE_CLEAR = 0.8; // gate turn: rider clearance from the gate cones
const SNAIL_CORE = 4; // snail: the central S spans this many metres
const ZIGZAG_SEGMENTS = 3;
const BOX_EIGHT_MARGIN = 1; // licence-test eight: rectangle this far outside the loops
const KEYHOLE_CLEAR = 1.2; // keyhole: the loop inside runs this far inside the ring
const KEYHOLE_TURN = 2; // keyhole: radius of the turns onto and off the slants
const KEYHOLE_CONES = 12;
const SWERVE_PAIR = 3; // moose test: corridor pairs this far apart
const SWERVE_CLEAR = 1.5; // moose test: the swerve passes the dead end this far out

function latticeChoices(range, unit) {
  const [lo, hi] = range.length === 1 ? [range[0] - 0.25, range[0] + 0.25] : range;
  const out = [];
  for (let k = Math.max(1, Math.ceil(lo / unit - 1e-9)); k * unit <= hi + 1e-9; k++) out.push(k);
  return out;
}

/** n + 1 points evenly along an arc around c, from angle a0 sweeping `sweep`. */
function arcSpots(c, r, a0, sweep, n) {
  return Array.from({ length: n + 1 }, (_, i) => [c[0] + r * cos(a0 + (sweep * i) / n), c[1] + r * sin(a0 + (sweep * i) / n)]);
}

/** The points in order, without repeats where one arc or straight joins the next. */
function chain(...points) {
  return points.filter((p, i) => i === 0 || Math.abs(p[0] - points[i - 1][0]) + Math.abs(p[1] - points[i - 1][1]) > 1e-9);
}

/** Cones on the lattice points nearest to `points`, one per point. */
function conesAt(points, height) {
  const seen = new Set();
  const out = [];
  for (const [x, y] of points) {
    const a = Math.round(x) + 0;
    const b = Math.round(y) + 0;
    if (seen.has(`${a},${b}`)) continue;
    seen.add(`${a},${b}`);
    out.push({ a, b, height });
  }
  return out;
}

/** The geometry moved so that its first cone is the local origin (the anchor). */
function rebase(g) {
  const { a: a0, b: b0 } = g.cones[0];
  return {
    ...g,
    cones: g.cones.map((c) => ({ ...c, a: c.a - a0, b: c.b - b0 })),
    path: g.path.map(([a, b]) => [a - a0, b - b0]),
    guides: g.guides.map((u) => ({ ...u, center: [u.center[0] - a0, u.center[1] - b0] })),
  };
}

/**
 * An S of two equal arcs from (a0, y0) to (a0 + length, y1), running along +a
 * at both ends: towards the shift first, the other way from halfway.
 */
function sBend(a0, y0, length, y1) {
  const shift = Math.abs(y1 - y0);
  const sweep = 2 * atan(shift / length);
  const r = length / (2 * sin(sweep));
  if (y1 > y0) {
    return [...arcPoints([a0, y0 + r], r, -PI / 2, sweep, ARC), ...arcPoints([a0 + length, y1 - r], r, PI / 2 + sweep, -sweep, ARC).slice(1)];
  }
  return [...arcPoints([a0, y0 - r], r, PI / 2, -sweep, ARC), ...arcPoints([a0 + length, y1 + r], r, -PI / 2 - sweep, sweep, ARC).slice(1)];
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
      const path = [[-lead, y0], ...sBend(0, y0, length, y1), [length + lead, y1]];
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
        // Open on the entry side (cones 4–1).
        lines: [{ kind: 'wall', cones: [0, 1, 2, 3] }],
        path,
        entryDir: [1, 0],
        exitDir: [-1, 0],
      };
    },
  },

  'pivot-turn': {
    options: (t) => ({ angle: t.pivotAngles }),
    extra: (t) => ({ radius: t.pivotRadius }),
    build({ angle, radius }, unit) {
      const r = (radius - 0.5) / unit;
      const lead = r + 1 / unit;
      const sweep = (angle * PI) / 180;
      const arc = arcPoints([0, 0], r, -PI / 2, sweep);
      const path = [[-lead, -r], ...arc];
      const laps = angle % 360 === 0;
      if (laps) path.push([lead, -r]);
      else path.push([-r, -lead]);
      return {
        cones: [{ a: 0, b: 0, height: 'tall' }],
        passes: [{ kind: 'cone', cone: 0, side: 'left', angle }],
        path,
        entryDir: [1, 0],
        exitDir: laps ? [1, 0] : [0, -1],
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
        // Open on the entry (4–1) and exit (1–2) sides.
        lines: [{ kind: 'wall', cones: [1, 2, 3] }],
        path,
        entryDir: [1, 0],
        exitDir: [0, -1],
      };
    },
  },

  circle: {
    sideOnly: true,
    options: (t, unit) => ({ radius: latticeChoices(t.circleRadius, unit), stretch: t.circleStretch.map((m) => m / unit) }),
    build({ radius, stretch }, unit) {
      // One lap anticlockwise round a ring of cones, 1 m outside it: a circle,
      // or an oval of two half circles round P and Q. It leaves with a right turn
      // so the way out does not run along the start of the lap.
      const r = radius + WALL / unit;
      const p = [0, r];
      const q = [stretch, r];
      const out = TURN_OUT / unit;
      const n = Math.max(2, Math.round((PI * radius) / (RING_SPACING / unit)));
      const ring = [[0, r - radius], ...arcSpots(q, radius, -PI / 2, PI, n), ...arcSpots(p, radius, PI / 2, PI, n)];
      const cones = conesAt(ring, 'tall');
      return rebase({
        cones,
        passes: cones.map((_, i) => ({ kind: 'cone', cone: i, side: 'left' })),
        path: chain([0, 0], ...arcPoints(q, r, -PI / 2, PI, ARC), ...arcPoints(p, r, PI / 2, PI, ARC), ...arcPoints([0, -out], out, PI / 2, -PI / 2, ARC)),
        guides: stretch === 0
          ? [{ center: p, radii: [radius], from: 0, to: 2 * PI }]
          : [{ center: p, radii: [radius], from: PI / 2, to: (3 * PI) / 2 }, { center: q, radii: [radius], from: -PI / 2, to: PI / 2 }],
        entryDir: [1, 0],
        exitDir: [0, -1],
      });
    },
  },

  mirror: {
    options: (t, unit) => ({ line: latticeChoices(t.mirrorLine, unit) }),
    extra: (t) => ({ radius: t.mirrorRadius }),
    build({ line, radius }, unit) {
      // A chalk line between two low cones, across the approach. The rider turns
      // round so that at the apex the wheel crosses the line, and rides back the
      // way it came; the two legs cross short of the line.
      const r = radius / unit;
      const over = MIRROR_OVER / unit;
      const lead = LEAD / unit;
      return {
        cones: [{ a: 0, b: 0, height: 'low' }, { a: 0, b: line, height: 'low' }],
        passes: [{ kind: 'line', from: 0, to: 1 }],
        lines: [{ kind: 'chalk', cones: [0, 1] }],
        path: [[over - 2 * r - lead, line / 2 + r], ...arcPoints([over - r, line / 2], r, PI / 2, -1.5 * PI, ARC), [over - 2 * r, line / 2 + r + lead]],
        entryDir: [1, 0],
        exitDir: [0, 1],
      };
    },
  },

  'gate-turn': {
    options: (t, unit) => ({ width: latticeChoices(t.gateTurnWidth, unit) }),
    extra: (t) => ({ radius: t.loopRadius }),
    build({ width, radius }, unit) {
      // Through a gate of two low cones, round behind it and back through the
      // same gate: a light-bulb turn — out of line to the right, a wide loop to
      // the left, back into line to the right — so both passes run straight
      // through the gate. Its cones are low: the gate is ridden both ways.
      const r = radius / unit;
      const q = width / 2 - GATE_CLEAR / unit;
      const s = 1 / unit;
      const lead = LEAD / unit;
      const bIn = width / 2 - q;
      const bOut = width / 2 + q;
      const s1 = [s, bIn - r];
      const s2 = [s, bOut + r];
      const loop = [s + Math.sqrt(4 * r * r - (q + r) * (q + r)), width / 2];
      const phi = atan2(loop[1] - s1[1], loop[0] - s1[0]);
      return {
        cones: [{ a: 0, b: 0, height: 'low' }, { a: 0, b: width, height: 'low' }],
        passes: [],
        path: [
          [-lead, bIn],
          ...arcPoints(s1, r, PI / 2, phi - PI / 2, ARC),
          ...arcPoints(loop, r, phi - PI, 2 * PI - 2 * phi, ARC).slice(1),
          ...arcPoints(s2, r, -phi, phi - PI / 2, ARC).slice(1),
          [-lead, bOut],
        ],
        entryDir: [1, 0],
        exitDir: [-1, 0],
      };
    },
  },

  snail: {
    sideOnly: true,
    options: (t, unit) => ({ corridor: latticeChoices(t.snailCorridor, unit) }),
    build({ corridor }, unit) {
      // Autofactor's «улитка», a double spiral of two interleaved corridors: in
      // clockwise along one, an S of two half circles through the centre, out
      // anticlockwise along the other. Every arc of the line and of the walls is
      // a half circle round P or Q, half a corridor either side of the centre,
      // so the walls are laid out with a tape. Drawn with the entry going +y,
      // then turned onto the +a axis.
      const c = corridor / 2;
      const x0 = SNAIL_CORE / unit;
      const line = [
        ...arcPoints([-c, 0], x0 + 3 * c, PI, -PI, ARC),
        ...arcPoints([c, 0], x0 + c, 0, -PI, ARC).slice(1),
        ...arcPoints([-x0 / 2, 0], x0 / 2, PI, -PI, ARC).slice(1),
        ...arcPoints([x0 / 2, 0], x0 / 2, PI, PI, ARC).slice(1),
        ...arcPoints([-c, 0], x0 + c, 0, PI, ARC).slice(1),
        ...arcPoints([c, 0], x0 + 3 * c, PI, PI, ARC).slice(1),
      ];
      const radii = [x0, x0 + 2 * c, x0 + 4 * c];
      const walls = [[x0 - c, 0]];
      for (const r of radii) {
        const n = Math.max(1, Math.round((PI * r) / (WALL_SPACING / unit)));
        walls.push(...arcSpots([-c, 0], r, 0, PI, n), ...arcSpots([c, 0], r, PI, PI, n));
      }
      const turn = ([x, y]) => [y, -x];
      return rebase({
        cones: conesAt(walls.map(turn), 'low'),
        passes: [],
        path: line.map(turn),
        guides: [{ center: turn([-c, 0]), radii, from: -PI / 2, to: PI / 2 }, { center: turn([c, 0]), radii, from: PI / 2, to: (3 * PI) / 2 }],
        entryDir: [1, 0],
        exitDir: [1, 0],
      });
    },
  },

  tunnel: {
    options: (t, unit) => ({
      width: latticeChoices(t.gateWidth, unit),
      gap: latticeChoices(t.tunnelGap, unit),
      shift: latticeChoices(t.tunnelShift, unit),
    }),
    build({ width, gap, shift }, unit) {
      // Three gates in a row, the middle one shifted sideways: straight through
      // each gate, an S of two arcs between them.
      const lead = LEAD / unit;
      const y0 = -width / 2;
      const y1 = shift - width / 2;
      return {
        cones: [
          { a: 0, b: 0, height: 'tall' }, { a: 0, b: -width, height: 'tall' },
          { a: gap, b: shift, height: 'tall' }, { a: gap, b: shift - width, height: 'tall' },
          { a: 2 * gap, b: 0, height: 'tall' }, { a: 2 * gap, b: -width, height: 'tall' },
        ],
        passes: [{ kind: 'gate', left: 0, right: 1 }, { kind: 'gate', left: 2, right: 3 }, { kind: 'gate', left: 4, right: 5 }],
        path: [[-lead, y0], ...sBend(0, y0, gap, y1), ...sBend(gap, y1, gap, y0).slice(1), [2 * gap + lead, y0]],
        entryDir: [1, 0],
        exitDir: [1, 0],
      };
    },
  },

  zigzag: {
    options: (t, unit) => ({
      step: latticeChoices(t.zigzagStep, unit),
      shift: latticeChoices(t.zigzagShift, unit),
      width: latticeChoices(t.zigzagWidth, unit),
    }),
    build({ step, shift, width }, unit) {
      // A corridor of zigzag segments, marked by pairs of low cones at its
      // corners; the rider weaves through the middle of each pair.
      const lead = LEAD / unit;
      const cones = [];
      for (let k = 0; k <= ZIGZAG_SEGMENTS; k++) {
        const b = k % 2 === 1 ? shift : 0;
        cones.push({ a: k * step, b, height: 'low' }, { a: k * step, b: b + width, height: 'low' });
      }
      const length = ZIGZAG_SEGMENTS * step;
      const n = ZIGZAG_SEGMENTS * 24;
      const weave = Array.from({ length: n + 1 }, (_, i) => {
        const a = (length * i) / n;
        return [a, width / 2 + (shift / 2) * (1 - cos((PI * a) / step))];
      });
      const side = (odd) => cones.map((_, i) => i).filter((i) => i % 2 === odd);
      return {
        cones,
        passes: [],
        lines: [{ kind: 'wall', cones: side(0) }, { kind: 'wall', cones: side(1) }],
        path: [[-lead, width / 2], ...weave, [length + lead, weave[n][1]]],
        entryDir: [1, 0],
        exitDir: [1, 0],
      };
    },
  },

  'corridor-slalom': {
    options: (t, unit) => ({ width: latticeChoices(t.snakeWidth, unit), step: latticeChoices(t.snakeStep, unit) }),
    build({ width, step }, unit) {
      // The licence-test «змейка»: a corridor with three barriers reaching its
      // middle from alternate sides; the rider weaves round their ends.
      const lead = LEAD / unit;
      const lo = Math.floor(width / 2);
      const hi = width - lo;
      const length = 4 * step;
      const cones = [
        [0, 0], [length, 0], [length, width], [0, width],
        [step, 0], [step, lo], [2 * step, width], [2 * step, hi], [3 * step, 0], [3 * step, lo],
      ].map(([a, b]) => ({ a, b, height: 'low' }));
      const n = 96;
      const weave = Array.from({ length: n + 1 }, (_, i) => {
        const a = (length * i) / n;
        return [a, width / 2 - (width / 4) * cos((PI * a) / step)];
      });
      return {
        cones,
        passes: [],
        lines: [
          { kind: 'wall', cones: [0, 4, 8, 1] }, { kind: 'wall', cones: [3, 6, 2] },
          { kind: 'wall', cones: [4, 5] }, { kind: 'wall', cones: [6, 7] }, { kind: 'wall', cones: [8, 9] },
        ],
        path: [[-lead, width / 4], ...weave, [length + lead, width / 4]],
        entryDir: [1, 0],
        exitDir: [1, 0],
      };
    },
  },

  'box-eight': {
    options: (t, unit) => ({ distance: latticeChoices(t.boxEightDistance, unit), gate: latticeChoices(t.boxEightGate, unit) }),
    build({ distance, gate }, unit) {
      // The licence-test eight: a figure eight inside a rectangle of four low
      // cones, through a gate of two low cones where its loops cross. The way in
      // and out crosses the long sides near one end.
      const eight = TYPES['figure-eight'].build({ distance }, unit);
      const m = BOX_EIGHT_MARGIN / unit;
      const a0 = Math.floor(-0.4 * distance - m);
      const a1 = Math.ceil(1.4 * distance + m);
      const b1 = Math.ceil(0.3 * distance + m);
      const mid = Math.floor(distance / 2);
      const lo = Math.floor(gate / 2);
      return {
        ...eight,
        cones: [
          ...eight.cones,
          { a: mid, b: -lo, height: 'low' }, { a: mid, b: gate - lo, height: 'low' },
          { a: a0, b: -b1, height: 'low' }, { a: a1, b: -b1, height: 'low' }, { a: a1, b: b1, height: 'low' }, { a: a0, b: b1, height: 'low' },
        ],
      };
    },
  },

  keyhole: {
    sideOnly: true,
    options: (t, unit) => ({ radius: latticeChoices(t.keyholeRadius, unit), opening: latticeChoices(t.keyholeOpening, unit) }),
    build({ radius, opening }, unit) {
      // A ring of low cones with one opening towards the approach. In through
      // the opening on a slant, a loop round inside, out through the same
      // opening on the other slant: the two passes cross in the opening.
      const k = [radius, 0];
      const rho = radius - KEYHOLE_CLEAR / unit;
      const beta = atan2(rho, Math.sqrt(radius * radius - rho * rho));
      const t0 = 1 / unit;
      const ro = KEYHOLE_TURN / unit;
      const cb = cos(beta);
      const sb = sin(beta);
      const c1 = [-t0 * cb - ro * sb, -t0 * sb + ro * cb];
      const c2 = [c1[0], -c1[1]];
      const half = opening / 2;
      const gap = atan2(half, Math.sqrt(radius * radius - half * half));
      const ring = arcSpots(k, radius, PI + gap, 2 * PI - 2 * gap, KEYHOLE_CONES - 1);
      return rebase({
        cones: conesAt(ring, 'low'),
        passes: [],
        path: [
          ...arcPoints(c1, ro, -PI / 2, beta, ARC),
          ...arcPoints(k, rho, PI / 2 + beta, -(PI + 2 * beta), ARC),
          ...arcPoints(c2, ro, PI / 2 - beta, beta, ARC),
        ],
        guides: [{ center: k, radii: [radius], from: PI + gap, to: 3 * PI - gap }],
        entryDir: [1, 0],
        exitDir: [-1, 0],
      });
    },
  },

  crescent: {
    sideOnly: true,
    options: (t, unit) => ({ radius: latticeChoices(t.crescentRadius, unit) }),
    extra: (t) => ({ flick: t.flickRadius }),
    build({ radius, flick }, unit) {
      // «Месяц»: a long half circle at constant radius round five cones, then a
      // flick onto the other side — a quarter turn the other way round one cone.
      const r = radius + WALL / unit;
      const f = flick / unit;
      const centre = [0, r];
      const cones = [...conesAt(arcSpots(centre, radius, -PI / 2, PI, 4), 'tall'), { a: 0, b: 2 * r + f, height: 'tall' }];
      return rebase({
        cones,
        passes: cones.map((_, i) => ({ kind: 'cone', cone: i, side: i < cones.length - 1 ? 'left' : 'right' })),
        path: [...arcPoints(centre, r, -PI / 2, PI, ARC), ...arcPoints([0, 2 * r + f], f, -PI / 2, -PI / 2, ARC).slice(1)],
        guides: [{ center: centre, radii: [radius], from: -PI / 2, to: PI / 2 }],
        entryDir: [1, 0],
        exitDir: [0, 1],
      });
    },
  },

  swerve: {
    options: (t, unit) => ({ width: latticeChoices(t.swerveWidth, unit), run: latticeChoices(t.swerveRun, unit) }),
    build({ width, run }, unit) {
      // «Лосиный тест»: a corridor of low cone pairs runs towards a dead end of
      // three low cones; from the corridor's end the rider swerves out past it.
      // In training a helper shows the side 6–8 m before the dead end.
      const pair = Math.round(SWERVE_PAIR / unit);
      const end = 2 * pair;
      const dead = end + run;
      const mid = width / 2;
      const out = width + SWERVE_CLEAR / unit;
      const lead = LEAD / unit;
      const cones = [];
      for (let k = 0; k <= 2; k++) cones.push({ a: k * pair, b: 0, height: 'low' }, { a: k * pair, b: width, height: 'low' });
      cones.push({ a: dead, b: 0, height: 'low' }, { a: dead, b: Math.round(mid), height: 'low' }, { a: dead, b: width, height: 'low' });
      return {
        cones,
        passes: [],
        lines: [{ kind: 'wall', cones: [0, 2, 4] }, { kind: 'wall', cones: [1, 3, 5] }, { kind: 'wall', cones: [6, 7, 8] }],
        path: [[-lead, mid], ...sBend(end, mid, run - 1 / unit, out), [dead + 2 * lead, out]],
        entryDir: [1, 0],
        exitDir: [1, 0],
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
  // Curved rings and walls snap to the 0.5 m grid; on the coarser diagonal
  // lattice their cones would move too far off the line.
  if (diagonal && TYPES[type].sideOnly) return null;
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
  Object.assign(params, TYPES[type].extra?.(DIFFICULTY_TABLE[difficulty]) ?? {});
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
    passes: g.passes.map((p) => {
      if (p.kind === 'gate') return { ...p, left: p.right, right: p.left };
      if (p.kind === 'cone') return { ...p, side: p.side === 'left' ? 'right' : 'left' };
      return p;
    }),
    lines: g.lines,
    guides: g.guides.map((u) => ({ ...u, center: [u.center[0], -u.center[1]], from: -u.to, to: -u.from })),
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
  let g = { lines: [], guides: [], ...TYPES[type].build(params, unit) };
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
    lines: g.lines,
    guides: g.guides,
    path,
    entryDir: g.entryDir,
    exitDir: g.exitDir,
    core,
    zone,
    turnLeft: turn.left,
    turnRight: turn.right,
  };
}
