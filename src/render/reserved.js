// Reserved zones: the asphalt the generator keeps for something, read back from
// a generated course for drawing only. Nothing here feeds the search; the
// shapes are the ones the course already carries, or rebuilt the way the
// generator builds them (footprints and the U-turn cone keep-out are not
// serialized).

import { MIN_PAD, safetyOf } from '../generator/index.js';

const STEP = 0.25; // footprint outlines are traced on a grid this fine, metres
const SIMPLIFY = 0.03; // and their vertices thinned to this tolerance
const CIRCLE_SIDES = 32;

function pointToSegment2(p, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  const t = len2 < 1e-12 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
  const ex = a[0] + dx * t - p[0];
  const ey = a[1] + dy * t - p[1];
  return ex * ex + ey * ey;
}

/** Douglas–Peucker on a closed loop. */
function simplify(loop, tol) {
  if (loop.length < 8) return loop;
  const rdp = (pts) => {
    if (pts.length < 3) return pts;
    let worst = 0;
    let at = 0;
    for (let i = 1; i < pts.length - 1; i++) {
      const d = pointToSegment2(pts[i], pts[0], pts[pts.length - 1]);
      if (d > worst) {
        worst = d;
        at = i;
      }
    }
    if (worst <= tol * tol) return [pts[0], pts[pts.length - 1]];
    return [...rdp(pts.slice(0, at + 1)).slice(0, -1), ...rdp(pts.slice(at))];
  };
  const half = loop.length >> 1;
  return [...rdp([...loop.slice(0, half + 1)]).slice(0, -1), ...rdp([...loop.slice(half), loop[0]]).slice(0, -1)];
}

/**
 * Outline of an element's footprint — everything within its pad of its
 * cones, walls, chalk lines and the line ridden inside it — as closed loops
 * (an outer outline, and the edges of any hole), traced by marching squares.
 * The pad is the element's own, else the recipe's, never under MIN_PAD, as the
 * generator takes it.
 */
function footprintOutlines(course, e, byId) {
  const pad = Math.max(e.safety?.pad ?? safetyOf(course.recipe).pad, MIN_PAD);
  const cones = e.cones.map((id) => [byId.get(id).hx / 2, byId.get(id).hy / 2]);
  const segments = [];
  for (const line of e.lines ?? []) {
    for (let i = 1; i < line.cones.length; i++) segments.push([cones[e.cones.indexOf(line.cones[i - 1])], cones[e.cones.indexOf(line.cones[i])]]);
  }
  const ridden = e.path.slice(1, -1);
  for (let i = 1; i < ridden.length; i++) segments.push([ridden[i - 1], ridden[i]]);
  const all = [...cones, ...segments.flat()];
  const x0 = Math.min(...all.map((p) => p[0])) - pad - STEP;
  const y0 = Math.min(...all.map((p) => p[1])) - pad - STEP;
  const nx = Math.ceil((Math.max(...all.map((p) => p[0])) + pad + STEP - x0) / STEP) + 1;
  const ny = Math.ceil((Math.max(...all.map((p) => p[1])) + pad + STEP - y0) / STEP) + 1;
  // Signed clearance: > 0 inside the footprint.
  const clearance = (p) => {
    let best = Infinity;
    for (const c of cones) best = Math.min(best, (c[0] - p[0]) ** 2 + (c[1] - p[1]) ** 2);
    for (const [a, b] of segments) if (best > 0) best = Math.min(best, pointToSegment2(p, a, b));
    return pad - Math.sqrt(best);
  };
  const f = new Float64Array(nx * ny);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) f[j * nx + i] = clearance([x0 + i * STEP, y0 + j * STEP]);
  }
  const at = (i, j) => f[j * nx + i];
  // Where the outline crosses a grid edge: 'h' edges run +x from (i, j), 'v' edges +y.
  // Halved on the clearance itself, not interpolated: where the footprints of
  // two parts meet at an angle the clearance bends between grid points.
  const cross = (kind, i, j) => {
    const p = [x0 + i * STEP, y0 + j * STEP];
    const d = kind === 'h' ? [STEP, 0] : [0, STEP];
    let [lo, hi] = [0, 1];
    const inAtLo = at(i, j) > 0;
    for (let k = 0; k < 10; k++) {
      const t = (lo + hi) / 2;
      if (clearance([p[0] + d[0] * t, p[1] + d[1] * t]) > 0 === inAtLo) lo = t;
      else hi = t;
    }
    const t = (lo + hi) / 2;
    return [p[0] + d[0] * t, p[1] + d[1] * t];
  };
  const next = new Map(); // edge key → the edge key the outline goes on to
  const point = new Map();
  const link = (p, q) => {
    const kp = p.join(',');
    const kq = q.join(',');
    if (!point.has(kp)) point.set(kp, cross(...p));
    if (!point.has(kq)) point.set(kq, cross(...q));
    next.set(kp, kq);
  };
  for (let j = 0; j < ny - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const bl = at(i, j) > 0;
      const br = at(i + 1, j) > 0;
      const tr = at(i + 1, j + 1) > 0;
      const tl = at(i, j + 1) > 0;
      const B = ['h', i, j];
      const R = ['v', i + 1, j];
      const T = ['h', i, j + 1];
      const L = ['v', i, j];
      // Inside kept on the right of each segment, so an outer outline runs clockwise.
      const code = (bl ? 1 : 0) | (br ? 2 : 0) | (tr ? 4 : 0) | (tl ? 8 : 0);
      const centre = (at(i, j) + at(i + 1, j) + at(i + 1, j + 1) + at(i, j + 1)) / 4 > 0;
      switch (code) {
        case 1: link(L, B); break;
        case 2: link(B, R); break;
        case 3: link(L, R); break;
        case 4: link(R, T); break;
        case 5: if (centre) { link(L, T); link(R, B); } else { link(L, B); link(R, T); } break;
        case 6: link(B, T); break;
        case 7: link(L, T); break;
        case 8: link(T, L); break;
        case 9: link(T, B); break;
        case 10: if (centre) { link(B, L); link(T, R); } else { link(B, R); link(T, L); } break;
        case 11: link(T, R); break;
        case 12: link(R, L); break;
        case 13: link(R, B); break;
        case 14: link(B, L); break;
        default: break;
      }
    }
  }
  const loops = [];
  const seen = new Set();
  for (const start of next.keys()) {
    if (seen.has(start)) continue;
    const loop = [];
    let k = start;
    while (k && !seen.has(k)) {
      seen.add(k);
      loop.push(point.get(k));
      k = next.get(k);
    }
    if (loop.length >= 3) loops.push(simplify(loop, SIMPLIFY).map(([x, y]) => [Math.round(x * 100) / 100, Math.round(y * 100) / 100]));
  }
  return loops;
}

const CACHE = new WeakMap();

/**
 * Every reserved zone of the course, in the order they are drawn (widest and
 * faintest first). Kinds:
 * - `runOff`   — free asphalt round a turning element (5 m from its cones and line by default);
 * - `zone`     — element footprint: cones, walls, chalk lines and the line
 *                ridden plus its pad (0,75 м by default); nothing else enters.
 *                One or more loops per element;
 * - `terminal` — start or finish line with its waiting / run-out area;
 * - `turnCone` — keep-out round a connector's U-turn cone (a 1,5 m circle by
 *   default), with its colour; none when the recipe switches it off.
 * The site margin is drawn by each renderer on its own (`course.site.margin`).
 */
export function reservedZones(course) {
  if (CACHE.has(course)) return CACHE.get(course);
  const out = [];
  const byId = new Map(course.cones.map((c) => [c.id, c]));
  for (const e of course.elements) if (e.runOff) out.push({ kind: 'runOff', element: e.id, poly: e.runOff });
  for (const e of course.elements) for (const poly of footprintOutlines(course, e, byId)) out.push({ kind: 'zone', element: e.id, poly });
  const { start, finish } = course.route;
  out.push({ kind: 'terminal', poly: start.zone });
  if (finish !== start && JSON.stringify(finish.zone) !== JSON.stringify(start.zone)) out.push({ kind: 'terminal', poly: finish.zone });
  const side = new Map(course.passes.filter((p) => p.connector).map((p) => [p.cone, p.side]));
  const r = safetyOf(course.recipe).coneGap;
  // None when the recipe switches the keep-out off.
  for (const leg of r > 0 ? course.route.legs : []) {
    for (const id of leg.cones ?? []) {
      const c = byId.get(id);
      const x = c.hx / 2;
      const y = c.hy / 2;
      out.push({
        kind: 'turnCone', cone: id, color: side.get(id) === 'left' ? 'blue' : 'red',
        poly: Array.from({ length: CIRCLE_SIDES }, (_, k) => [x + r * Math.cos((2 * Math.PI * k) / CIRCLE_SIDES), y + r * Math.sin((2 * Math.PI * k) / CIRCLE_SIDES)]),
      });
    }
  }
  CACHE.set(course, out);
  return out;
}

/**
 * The lot's blocked areas (cutouts and obstacles), for drawing: the rectangle,
 * its margin (`m` metres round it: its own, else the lot edge margin; drawn as
 * a reserved zone and clipped to the site by the renderer, none at 0), its
 * number in the recipe's list and its name. Empty for a plain rectangle.
 */
export function blockedOutlines(course) {
  const { margin: edge, blocked = [] } = course.site;
  const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
  return blocked.map((b, i) => {
    const m = b.margin ?? edge;
    return {
      kind: b.kind,
      n: i + 1,
      name: `${b.kind === 'cutout' ? 'Вырез' : 'Препятствие'} ${i + 1}`,
      x: b.x, y: b.y, w: b.w, h: b.h, m,
      poly: rect(b.x, b.y, b.x + b.w, b.y + b.h),
      margin: m > 0 ? rect(b.x - m, b.y - m, b.x + b.w + m, b.y + b.h + m) : null,
    };
  });
}
