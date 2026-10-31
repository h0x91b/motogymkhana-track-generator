// Test-side geometry, deliberately independent of the generator's own helpers:
// everything here is computed from the published course data only, with
// brute-force methods (dense sampling, nearest points), not the generator's
// clipping and SAT routines.

export const coneXY = (cone) => [cone.hx / 2, cone.hy / 2];

export function conesById(course) {
  return new Map(course.cones.map((c) => [c.id, c]));
}

function nearestOnPath(path, p) {
  let best = { d2: Infinity, point: null, dir: null, index: -1 };
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len2 = dx * dx + dy * dy;
    if (len2 < 1e-12) continue;
    let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    const q = [a[0] + dx * t, a[1] + dy * t];
    const d2 = (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2;
    if (d2 < best.d2) best = { d2, point: q, dir: [dx, dy], index: i };
  }
  return best;
}

/** Which side of the rider the point is on where the path passes closest to it. */
export function sideOf(path, p) {
  const { point, dir } = nearestOnPath(path, p);
  const cross = dir[0] * (p[1] - point[1]) - dir[1] * (p[0] - point[0]);
  return cross > 0 ? 'left' : 'right';
}

export function distanceToPath(path, p) {
  return Math.sqrt(nearestOnPath(path, p).d2);
}

/** Point strictly inside a convex CCW polygon, at least `inset` from every edge. */
export function insidePolygon(poly, p, inset = 0) {
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const ex = b[0] - a[0];
    const ey = b[1] - a[1];
    const len = Math.sqrt(ex * ex + ey * ey);
    if ((ex * (p[1] - a[1]) - ey * (p[0] - a[0])) / len <= inset) return false;
  }
  return true;
}

/** Does the polyline enter the polygon deeper than `inset`? Sampled every 2 cm. */
export function polylineEnters(path, poly, inset = 0.05) {
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    const len = Math.sqrt((b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2);
    const n = Math.max(1, Math.ceil(len / 0.02));
    for (let k = 0; k <= n; k++) {
      const p = [a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n];
      if (insidePolygon(poly, p, inset)) return true;
    }
  }
  return false;
}

/** The polyline resampled so no two consecutive points are more than `step` apart. */
export function densify(path, step) {
  const out = [path[0]];
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
    for (let k = 1; k <= n; k++) out.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
  }
  return out;
}

/** Total signed angle (degrees) swept around `c` by consecutive path points. */
export function sweepAround(points, c) {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const a0 = Math.atan2(points[i - 1][1] - c[1], points[i - 1][0] - c[0]);
    const a1 = Math.atan2(points[i][1] - c[1], points[i][0] - c[0]);
    let d = a1 - a0;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    total += d;
  }
  return (total * 180) / Math.PI;
}

/** Left and right turning (degrees) of a polyline. */
export function turns(points) {
  let left = 0;
  let right = 0;
  for (let i = 2; i < points.length; i++) {
    const ax = points[i - 1][0] - points[i - 2][0];
    const ay = points[i - 1][1] - points[i - 2][1];
    const bx = points[i][0] - points[i - 1][0];
    const by = points[i][1] - points[i - 1][1];
    if (ax * ax + ay * ay < 1e-8 || bx * bx + by * by < 1e-8) continue;
    const t = Math.atan2(ax * by - ay * bx, ax * bx + ay * by);
    if (t > 0) left += t;
    else right -= t;
  }
  return { left: (left * 180) / Math.PI, right: (right * 180) / Math.PI };
}

/** The whole ridden line, start to finish, as one polyline. */
export function fullRoute(course) {
  const byId = new Map(course.elements.map((e) => [e.id, e]));
  const out = [];
  for (const leg of course.route.legs) {
    const pts = leg.kind === 'connector' ? leg.path : byId.get(leg.element).path;
    out.push(...pts);
  }
  return out;
}
