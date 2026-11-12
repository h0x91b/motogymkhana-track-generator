// Geometry shared by the catalog, the connector router and the search.
// World units are metres unless a name says "half" (half-metre integers).

export const PI = Math.PI;
export const TAU = 2 * PI;

/** angle in [0, 2π) */
export const mod2pi = (a) => a - TAU * Math.floor(a / TAU);

/** angle in (-π, π] */
export function wrapPi(a) {
  const m = mod2pi(a);
  return m > PI ? m - TAU : m;
}

/** Axis index 0..7 (× 45°, counter-clockwise from +X) → half-metre lattice step. */
export const AXIS_STEPS = [
  [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1],
];


/** Length in metres of one lattice step along an axis of this class. */
export const latticeUnit = (diagonal) => (diagonal ? 0.5 * Math.SQRT2 : 0.5);

/**
 * Unit vector (metres) of an axis or direction in steps of 45° counter-clockwise
 * from +X. Exact for the eight 45° cases; an element turned off the lattice in
 * «Правка» (ADR 0019) stands on a half step, 22.5° between two of them.
 */
export function axisVector(axis) {
  if (!Number.isInteger(axis)) {
    const a = (axis * PI) / 4;
    return [Math.cos(a), Math.sin(a)];
  }
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
      const turn = Math.atan2(prev[0] * dy - prev[1] * dx, prev[0] * dx + prev[1] * dy);
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
    out.push([c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)]);
  }
  return out;
}

/** Points along an ellipse (axis-aligned in the local frame), parameter t0 → t1. */
export function ellipsePoints(c, rx, ry, t0, t1, maxStep = PI / 24) {
  const n = Math.max(1, Math.ceil(Math.abs(t1 - t0) / maxStep));
  const out = [];
  for (let i = 0; i <= n; i++) {
    const t = t0 + ((t1 - t0) * i) / n;
    out.push([c[0] + rx * Math.cos(t), c[1] + ry * Math.sin(t)]);
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

// ---------------------------------------------------------------------------
// Shapes: what an element, a line or a cone really takes on the asphalt, as a
// union of convex parts each grown by a radius. A part is a point (a disc), a
// segment (a capsule) or a convex CCW polygon, with `r` in metres. Parts are
// grouped so a far-away group is skipped on its bounds alone.

const GROUP = 8;

const partBounds = (pts, r) => {
  const [x0, y0, x1, y1] = pointsBounds(pts);
  return [x0 - r, y0 - r, x1 + r, y1 + r];
};

export const part = (pts, r = 0) => ({ pts, r, b: partBounds(pts, r) });

/**
 * A shape of parts, in groups of consecutive parts with their bounds. A shape
 * carries an offset (dx, dy) to its parts, so moving it copies nothing.
 */
export function shapeOf(parts) {
  const groups = [];
  for (let i = 0; i < parts.length; i += GROUP) {
    const ps = parts.slice(i, i + GROUP);
    const b = [Infinity, Infinity, -Infinity, -Infinity];
    for (const p of ps) {
      b[0] = Math.min(b[0], p.b[0]);
      b[1] = Math.min(b[1], p.b[1]);
      b[2] = Math.max(b[2], p.b[2]);
      b[3] = Math.max(b[3], p.b[3]);
    }
    groups.push({ b, parts: ps });
  }
  const bounds = [Infinity, Infinity, -Infinity, -Infinity];
  for (const g of groups) {
    bounds[0] = Math.min(bounds[0], g.b[0]);
    bounds[1] = Math.min(bounds[1], g.b[1]);
    bounds[2] = Math.max(bounds[2], g.b[2]);
    bounds[3] = Math.max(bounds[3], g.b[3]);
  }
  return { bounds, groups, dx: 0, dy: 0 };
}

/** The shape moved by (dx, dy). */
export function shiftShape(s, dx, dy) {
  const b = s.bounds;
  return { bounds: [b[0] + dx, b[1] + dy, b[2] + dx, b[3] + dy], groups: s.groups, dx: s.dx + dx, dy: s.dy + dy };
}

export const obbShape = (o) => shapeOf([part(obbCorners(o))]);

/** Every part of a shape, flattened and moved where the shape is. */
export const shapeParts = (s) => s.groups.flatMap((g) => g.parts.map((p) => ({ ...p, pts: p.pts.map(([x, y]) => [x + s.dx, y + s.dy]) })));

function pointSegment2(p, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  let t = len2 > 1e-18 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const ex = a[0] + dx * t - p[0];
  const ey = a[1] + dy * t - p[1];
  return ex * ex + ey * ey;
}

const orient = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);

function segmentsCross(a, b, c, d) {
  const d1 = orient(c, d, a);
  const d2 = orient(c, d, b);
  const d3 = orient(a, b, c);
  const d4 = orient(a, b, d);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

/** Squared distance between segments ab and cd (0 when they cross). */
export function segmentDistance2(a, b, c, d) {
  if (segmentsCross(a, b, c, d)) return 0;
  return Math.min(pointSegment2(a, c, d), pointSegment2(b, c, d), pointSegment2(c, a, b), pointSegment2(d, a, b));
}

/** Point inside (or on) a convex CCW polygon. */
function inConvex(poly, p) {
  for (let i = 0; i < poly.length; i++) {
    if (orient(poly[i], poly[(i + 1) % poly.length], p) < 0) return false;
  }
  return true;
}

function edges(pts) {
  if (pts.length === 1) return [[pts[0], pts[0]]];
  if (pts.length === 2) return [[pts[0], pts[1]]];
  return pts.map((p, i) => [p, pts[(i + 1) % pts.length]]);
}

/** Squared distance between two convex parts, ignoring their radii (0 when they meet). */
function partDistance2(p, q) {
  if (p.pts.length >= 3 && q.pts.some((v) => inConvex(p.pts, v))) return 0;
  if (q.pts.length >= 3 && p.pts.some((v) => inConvex(q.pts, v))) return 0;
  let best = Infinity;
  for (const [a, b] of edges(p.pts)) {
    for (const [c, d] of edges(q.pts)) {
      const d2 = segmentDistance2(a, b, c, d);
      if (d2 < best) best = d2;
      if (best === 0) return 0;
    }
  }
  return best;
}

/** Interiors of two convex polygons overlap by more than eps (separating axes). */
function polygonsOverlap(p, q, eps) {
  for (const poly of [p, q]) {
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % poly.length];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (len < 1e-12) continue;
      const n = [(b[1] - a[1]) / len, -(b[0] - a[0]) / len];
      let pMin = Infinity;
      let pMax = -Infinity;
      let qMin = Infinity;
      let qMax = -Infinity;
      for (const v of p) {
        const s = v[0] * n[0] + v[1] * n[1];
        if (s < pMin) pMin = s;
        if (s > pMax) pMax = s;
      }
      for (const v of q) {
        const s = v[0] * n[0] + v[1] * n[1];
        if (s < qMin) qMin = s;
        if (s > qMax) qMax = s;
      }
      if (pMax <= qMin + eps || qMax <= pMin + eps) return false;
    }
  }
  return true;
}

/** Does segment a→b pass through the interior of a convex CCW polygon shrunk by eps? */
function segmentEntersPolygon(a, b, poly, eps) {
  let t0 = 0;
  let t1 = 1;
  const d = [b[0] - a[0], b[1] - a[1]];
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
    if (len < 1e-12) continue;
    // Inward normal of a CCW edge; inside means n·(x - p) > eps.
    const n = [-(q[1] - p[1]) / len, (q[0] - p[0]) / len];
    const s = n[0] * (a[0] - p[0]) + n[1] * (a[1] - p[1]) - eps;
    const ds = n[0] * d[0] + n[1] * d[1];
    if (Math.abs(ds) < 1e-12) {
      if (s <= 0) return false;
      continue;
    }
    const t = -s / ds;
    if (ds > 0) t0 = Math.max(t0, t);
    else t1 = Math.min(t1, t);
    if (t0 >= t1) return false;
  }
  return t1 - t0 > 1e-9;
}

const boxesMeet = (a, b) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
const boxesMeetAt = (a, b, ox, oy) => a[0] < b[2] + ox && b[0] + ox < a[2] && a[1] < b[3] + oy && b[1] + oy < a[3];

/** Do two parts overlap by more than eps (touching does not count)? q is moved by (ox, oy). */
function partsOverlap(p, q, eps, ox = 0, oy = 0) {
  if (!boxesMeetAt(p.b, q.b, ox, oy)) return false;
  const r = p.r + q.r;
  if (r > 0 && r <= eps) return false;
  const qp = ox === 0 && oy === 0 ? q.pts : q.pts.map(([x, y]) => [x + ox, y + oy]);
  if (r <= 0) {
    if (p.pts.length >= 3 && qp.length >= 3) return polygonsOverlap(p.pts, qp, eps);
    if (p.pts.length >= 3) return qp.length === 2 && segmentEntersPolygon(qp[0], qp[1], p.pts, eps);
    if (qp.length >= 3) return p.pts.length === 2 && segmentEntersPolygon(p.pts[0], p.pts[1], qp, eps);
    return false;
  }
  const lim = (r - eps) * (r - eps);
  if (p.pts.length <= 2 && qp.length <= 2) {
    return segmentDistance2(p.pts[0], p.pts[p.pts.length - 1], qp[0], qp[qp.length - 1]) < lim;
  }
  return partDistance2(p, { pts: qp }) < lim;
}

/** Do two shapes overlap by more than eps? */
export function shapesOverlap(a, b, eps = 1e-6) {
  if (!boxesMeet(a.bounds, b.bounds)) return false;
  // b's parts seen from a's: moved by the difference of the offsets.
  const ox = b.dx - a.dx;
  const oy = b.dy - a.dy;
  const ab = [a.bounds[0] - a.dx, a.bounds[1] - a.dy, a.bounds[2] - a.dx, a.bounds[3] - a.dy];
  for (const h of b.groups) {
    if (!boxesMeetAt(ab, h.b, ox, oy)) continue;
    for (const g of a.groups) {
      if (!boxesMeetAt(g.b, h.b, ox, oy)) continue;
      for (const q of h.parts) {
        if (!boxesMeetAt(g.b, q.b, ox, oy)) continue;
        for (const p of g.parts) if (partsOverlap(p, q, eps, ox, oy)) return true;
      }
    }
  }
  return false;
}

/** Does a polyline (with its bounds) come into a shape deeper than eps? */
export function polylineHitsShape(points, bounds, s, eps = 0.01) {
  if (!boxesMeet(bounds, s.bounds)) return false;
  const seg = { pts: [null, null], r: 0, b: [0, 0, 0, 0] };
  for (let i = 1; i < points.length; i++) {
    // The segment in the shape's own frame.
    const a = [points[i - 1][0] - s.dx, points[i - 1][1] - s.dy];
    const c = [points[i][0] - s.dx, points[i][1] - s.dy];
    seg.pts[0] = a;
    seg.pts[1] = c;
    seg.b[0] = Math.min(a[0], c[0]);
    seg.b[1] = Math.min(a[1], c[1]);
    seg.b[2] = Math.max(a[0], c[0]);
    seg.b[3] = Math.max(a[1], c[1]);
    if (!boxesMeetAt(seg.b, s.bounds, -s.dx, -s.dy)) continue;
    for (const g of s.groups) {
      if (!boxesMeet(seg.b, g.b)) continue;
      for (const p of g.parts) if (partsOverlap(seg, p, eps)) return true;
    }
  }
  return false;
}

/** Convex hull, CCW, of a set of points (monotone chain). */
export function convexHull(points) {
  const pts = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (pts.length < 3) return pts;
  const half = (list) => {
    const out = [];
    for (const p of list) {
      while (out.length >= 2 && orient(out[out.length - 2], out[out.length - 1], p) <= 1e-12) out.pop();
      out.push(p);
    }
    out.pop();
    return out;
  };
  return [...half(pts), ...half([...pts].reverse())];
}

/** The part of a convex polygon where n·x ≥ c. */
export function clipConvex(poly, n, c) {
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    const sp = n[0] * p[0] + n[1] * p[1] - c;
    const sq = n[0] * q[0] + n[1] * q[1] - c;
    if (sp >= 0) out.push(p);
    if ((sp >= 0) !== (sq >= 0)) {
      const t = sp / (sp - sq);
      out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
    }
  }
  return out;
}
