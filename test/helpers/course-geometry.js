// Test-side geometry, deliberately independent of the generator's own helpers:
// everything here is computed from the published course data only, with
// brute-force methods (dense sampling, nearest points), not the generator's
// clipping and SAT routines. Only the type classification comes from the catalog.

import { crossable } from '../../src/generator/index.js';

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

/**
 * What an element really takes on the asphalt, from the published course: its
 * cones, its walls and chalk lines (cone to cone) and the line ridden inside it
 * (the path without the run-in from the entry and the run-out to the exit).
 * Distances to it are from these; the footprint is everything within the
 * clearance of them.
 */
export function footprintOf(course, e) {
  const byId = conesById(course);
  const cones = e.cones.map((id) => coneXY(byId.get(id)));
  const segments = [];
  for (const line of e.lines ?? []) {
    for (let i = 1; i < line.cones.length; i++) segments.push([coneXY(byId.get(line.cones[i - 1])), coneXY(byId.get(line.cones[i]))]);
  }
  const ridden = e.path.slice(1, -1);
  for (let i = 1; i < ridden.length; i++) segments.push([ridden[i - 1], ridden[i]]);
  const all = [...cones, ...segments.flat()];
  const bounds = [Math.min(...all.map((p) => p[0])), Math.min(...all.map((p) => p[1])), Math.max(...all.map((p) => p[0])), Math.max(...all.map((p) => p[1]))];
  return { cones, segments, bounds };
}

/** What the route keeps out of (ADR 0028): the footprint, or only the cones of an open (`crossable`) element. */
export function barrierOf(course, e) {
  const fp = footprintOf(course, e);
  if (!crossable(e.type)) return fp;
  const { cones } = fp;
  const bounds = cones.length ? [Math.min(...cones.map((p) => p[0])), Math.min(...cones.map((p) => p[1])), Math.max(...cones.map((p) => p[0])), Math.max(...cones.map((p) => p[1]))] : [Infinity, Infinity, -Infinity, -Infinity];
  return { cones, segments: [], bounds };
}

function pointToSegment(p, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  const t = len2 < 1e-12 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
  return Math.hypot(a[0] + dx * t - p[0], a[1] + dy * t - p[1]);
}

/**
 * Distance from a point to a convex CCW polygon: 0 inside it. Unlike a negative
 * `inset` of insidePolygon, which widens every edge to its whole line, it does
 * not reach past a sharp corner.
 */
export function distanceToPolygon(poly, p) {
  if (insidePolygon(poly, p)) return 0;
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) best = Math.min(best, pointToSegment(p, poly[i], poly[(i + 1) % poly.length]));
  return best;
}

/** Distance from a point to the nearest cone, line or ridden line of a footprint. */
export function distanceToFootprint(fp, p) {
  let best = Infinity;
  for (const c of fp.cones) best = Math.min(best, Math.hypot(c[0] - p[0], c[1] - p[1]));
  for (const [a, b] of fp.segments) best = Math.min(best, pointToSegment(p, a, b));
  return best;
}

/** Samples of a footprint's cones and lines, no two more than `step` apart along a line. */
function footprintSamples(fp, step) {
  return [...fp.cones, ...fp.segments.flatMap(([a, b]) => densify([a, b], step))];
}

/**
 * Shortest distance between two footprints, brute force: samples of one every
 * `step` m against the other, so it can overstate the true gap by step / 2 at most.
 * Infinity when their bounds are further apart than `reach`.
 */
export function footprintGap(a, b, reach = 3, step = 0.1) {
  if (a.bounds[0] > b.bounds[2] + reach || b.bounds[0] > a.bounds[2] + reach || a.bounds[1] > b.bounds[3] + reach || b.bounds[1] > a.bounds[3] + reach) return Infinity;
  let best = Infinity;
  for (const p of footprintSamples(a, step)) {
    if (p[0] < b.bounds[0] - reach || p[0] > b.bounds[2] + reach || p[1] < b.bounds[1] - reach || p[1] > b.bounds[3] + reach) continue;
    best = Math.min(best, distanceToFootprint(b, p));
  }
  return best;
}
