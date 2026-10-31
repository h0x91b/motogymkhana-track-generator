// Geometry shared by the catalog, the connector router and the search.
// World units are metres unless a name says "half" (half-metre integers).

import { atan2, cos, sin, PI } from './dmath.js';

/** Axis index 0..7 (× 45°, counter-clockwise from +X) → half-metre lattice step. */
export const AXIS_STEPS = [
  [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1],
];

export const isDiagonal = (axis) => axis % 2 === 1;

/** Length in metres of one lattice step along an axis of this class. */
export const latticeUnit = (diagonal) => (diagonal ? 0.5 * Math.SQRT2 : 0.5);

/** Unit vector (metres) of axis index 0..7. Exact for the 45° cases. */
export function axisVector(axis) {
  const [x, y] = AXIS_STEPS[((axis % 8) + 8) % 8];
  const k = x !== 0 && y !== 0 ? Math.SQRT1_2 : 1;
  return [x * k, y * k];
}

export const dirAngle = (dir) => (dir * PI) / 4;

export const round2 = (v) => Math.round(v * 100) / 100;

export function dist(a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  return Math.sqrt(dx * dx + dy * dy);
}

export function polylineLength(points) {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += dist(points[i - 1], points[i]);
  return total;
}

/**
 * Signed turning of a polyline, split into left (CCW) and right (CW) degrees.
 * Vertices closer than 1 mm are skipped so duplicated points do not count.
 */
export function turning(points) {
  let left = 0;
  let right = 0;
  let prev = null;
  for (let i = 1; i < points.length; i++) {
    const dx = points[i][0] - points[i - 1][0];
    const dy = points[i][1] - points[i - 1][1];
    if (dx * dx + dy * dy < 1e-6) continue;
    if (prev) {
      const turn = atan2(prev[0] * dy - prev[1] * dx, prev[0] * dx + prev[1] * dy);
      if (turn > 0) left += turn;
      else right -= turn;
    }
    prev = [dx, dy];
  }
  return { left: (left * 180) / PI, right: (right * 180) / PI };
}

/** Points along a circular arc around c, from angle a0 sweeping `sweep` radians. */
export function arcPoints(c, r, a0, sweep, maxStep = PI / 18) {
  const n = Math.max(1, Math.ceil(Math.abs(sweep) / maxStep));
  const out = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + (sweep * i) / n;
    out.push([c[0] + r * cos(a), c[1] + r * sin(a)]);
  }
  return out;
}

/** Points along an ellipse (axis-aligned in the local frame), parameter t0 → t1. */
export function ellipsePoints(c, rx, ry, t0, t1, maxStep = PI / 24) {
  const n = Math.max(1, Math.ceil(Math.abs(t1 - t0) / maxStep));
  const out = [];
  for (let i = 0; i <= n; i++) {
    const t = t0 + ((t1 - t0) * i) / n;
    out.push([c[0] + rx * cos(t), c[1] + ry * sin(t)]);
  }
  return out;
}

/**
 * Uniform Catmull-Rom through `points`, with the end tangents forced along
 * startDir / endDir so the curve meets straight approach lines without a kink.
 */
export function smoothPath(points, startDir, endDir, samples = 10) {
  if (points.length < 3) return points.map((p) => [p[0], p[1]]);
  const first = points[0];
  const last = points[points.length - 1];
  const span0 = dist(first, points[1]);
  const span1 = dist(points[points.length - 2], last);
  // Phantoms chosen so (p2 - p0) / 2 at each end points along the given direction.
  const p0 = [points[1][0] - 2 * span0 * startDir[0], points[1][1] - 2 * span0 * startDir[1]];
  const pn = [points[points.length - 2][0] + 2 * span1 * endDir[0], points[points.length - 2][1] + 2 * span1 * endDir[1]];
  const ext = [p0, ...points, pn];
  const out = [];
  for (let j = 1; j < ext.length - 2; j++) {
    const a = ext[j - 1];
    const b = ext[j];
    const c = ext[j + 1];
    const d = ext[j + 2];
    for (let i = 0; i < samples; i++) {
      const t = i / samples;
      const t2 = t * t;
      const t3 = t2 * t;
      const at = (k) => 0.5 * (2 * b[k] + (-a[k] + c[k]) * t + (2 * a[k] - 5 * b[k] + 4 * c[k] - d[k]) * t2 + (-a[k] + 3 * b[k] - 3 * c[k] + d[k]) * t3);
      out.push([at(0), at(1)]);
    }
  }
  out.push([last[0], last[1]]);
  return out;
}

// ---------------------------------------------------------------------------
// Oriented boxes (element zones). An OBB is {c:[x,y], u:[ux,uy], v:[vx,vy], hu, hv}
// with u, v orthonormal and hu, hv half-extents in metres.

export function obbCorners(o) {
  const { c, u, v, hu, hv } = o;
  const p = (su, sv) => [c[0] + u[0] * hu * su + v[0] * hv * sv, c[1] + u[1] * hu * su + v[1] * hv * sv];
  return [p(-1, -1), p(1, -1), p(1, 1), p(-1, 1)];
}

function projectRadius(o, axis) {
  return Math.abs(o.u[0] * axis[0] + o.u[1] * axis[1]) * o.hu + Math.abs(o.v[0] * axis[0] + o.v[1] * axis[1]) * o.hv;
}

/** True when the interiors of two OBBs overlap (touching does not count). */
export function obbOverlap(a, b, eps = 1e-6) {
  const d = [b.c[0] - a.c[0], b.c[1] - a.c[1]];
  for (const axis of [a.u, a.v, b.u, b.v]) {
    const sep = Math.abs(d[0] * axis[0] + d[1] * axis[1]);
    if (sep >= projectRadius(a, axis) + projectRadius(b, axis) - eps) return false;
  }
  return true;
}

/** True when segment p→q passes through the interior of the OBB shrunk by eps. */
export function segmentHitsObb(p, q, o, eps = 0.01) {
  const hu = o.hu - eps;
  const hv = o.hv - eps;
  if (hu <= 0 || hv <= 0) return false;
  const rp = [p[0] - o.c[0], p[1] - o.c[1]];
  const rq = [q[0] - o.c[0], q[1] - o.c[1]];
  const pu = rp[0] * o.u[0] + rp[1] * o.u[1];
  const pv = rp[0] * o.v[0] + rp[1] * o.v[1];
  const du = rq[0] * o.u[0] + rq[1] * o.u[1] - pu;
  const dv = rq[0] * o.v[0] + rq[1] * o.v[1] - pv;
  let t0 = 0;
  let t1 = 1;
  // Liang–Barsky against |u| < hu, |v| < hv.
  for (const [s, ds, h] of [[pu, du, hu], [pv, dv, hv]]) {
    if (Math.abs(ds) < 1e-12) {
      if (s <= -h || s >= h) return false;
      continue;
    }
    let a = (-h - s) / ds;
    let b = (h - s) / ds;
    if (a > b) [a, b] = [b, a];
    if (a > t0) t0 = a;
    if (b < t1) t1 = b;
    if (t0 >= t1) return false;
  }
  return t1 - t0 > 1e-9;
}

export function polylineHitsObb(points, o, eps) {
  for (let i = 1; i < points.length; i++) {
    if (segmentHitsObb(points[i - 1], points[i], o, eps)) return true;
  }
  return false;
}

export function obbBounds(o) {
  const ex = Math.abs(o.u[0]) * o.hu + Math.abs(o.v[0]) * o.hv;
  const ey = Math.abs(o.u[1]) * o.hu + Math.abs(o.v[1]) * o.hv;
  return [o.c[0] - ex, o.c[1] - ey, o.c[0] + ex, o.c[1] + ey];
}

export function pointsBounds(points) {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const [x, y] of points) {
    if (x < x0) x0 = x;
    if (y < y0) y0 = y;
    if (x > x1) x1 = x;
    if (y > y1) y1 = y;
  }
  return [x0, y0, x1, y1];
}

export const boundsOverlap = (a, b) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
