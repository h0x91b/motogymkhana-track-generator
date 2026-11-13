// The fences of the elements bounded by low cones: box eight, box, U-turn,
// snail, keyhole, the corridors and the start-and-finish box. A fence is the
// virtual line through its low cones in order (straight between the corners of
// a box, a smooth curve round a keyhole's ring or a snail's arcs); the rider
// keeps inside it. Its openings are the sides the rider goes in and out
// through. Where the ridden line goes through a fence or an opening there is a
// gate: a gap in the fence with a post at each side of it. All in metres, from
// the cones' own positions, so it holds for an element turned or moved in «Правка».

import { KEYHOLE_NECK_CONES } from '../generator/catalog.js';

/** Element types with a fence; the rest are open (tall cones, a lone low cone, a chalk line). */
export const FENCED_TYPES = ['u-turn', 'box', 'snail', 'zigzag', 'corridor-slalom', 'box-eight', 'keyhole', 'double-keyhole', 'swerve'];

/** Half the width of the gap cut in a fence where the line goes through it, in metres. */
const GATE_HALF = 1.2;
/**
 * An opening at least this long (a box's or a U-turn's open side) is drawn as
 * fence too, with a gate where the line goes through, so the box reads as a
 * box; a narrower one (a keyhole's mouth, a snail's, a corridor's end, the
 * start line) is the gate itself, between its end cones, and is left clear.
 */
const WIDE_OPENING = 2 * GATE_HALF + 1;

/** A smooth curve through the points in order (Catmull-Rom), as a polyline. */
export function smoothThrough(points, steps = 8) {
  if (points.length < 3) return points.slice();
  const out = [points[0]];
  out.smooth = true;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)];
    const [p1, p2] = [points[i], points[i + 1]];
    const p3 = points[Math.min(points.length - 1, i + 2)];
    for (let k = 1; k <= steps; k++) {
      const t = k / steps;
      const t2 = t * t;
      const t3 = t2 * t;
      const f = (a, b, c, d) => 0.5 * (2 * b + (c - a) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (3 * b - a - 3 * c + d) * t3);
      out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  return out;
}

/**
 * The snail's walls are half circles round its two guide centres, laid with
 * low cones: each arc's cones in order along it, a cone where two arcs join
 * on both. The openings are the corridor mouths at the outer ends.
 */
function snailFence(e, pts) {
  const arcs = [];
  for (const g of e.guides ?? []) {
    for (const r of g.radii) {
      const tol = (0.6 / r) * (180 / Math.PI);
      const on = [];
      pts.forEach((p, i) => {
        if (Math.abs(Math.hypot(p[0] - g.x, p[1] - g.y) - r) > 0.6) return;
        const deg = (Math.atan2(p[1] - g.y, p[0] - g.x) * 180) / Math.PI;
        const t = g.from - tol + ((((deg - g.from + tol) % 360) + 360) % 360);
        if (t <= g.to + tol) on.push({ i, t });
      });
      if (on.length > 1) arcs.push({ r, cones: on.sort((a, b) => a.t - b.t).map((o) => o.i) });
    }
  }
  const walls = arcs.map((a) => smoothThrough(a.cones.map((i) => pts[i])));
  const outer = Math.max(...arcs.map((a) => a.r));
  const openings = [];
  for (const a of arcs.filter((x) => x.r === outer)) {
    for (const end of [a.cones[0], a.cones.at(-1)]) {
      if (arcs.some((b) => b !== a && b.cones.includes(end))) continue;
      // Across the mouth: the nearest cone on another arc.
      let best = null;
      for (const b of arcs) {
        if (b === a) continue;
        for (const i of b.cones) {
          const d = Math.hypot(pts[i][0] - pts[end][0], pts[i][1] - pts[end][1]);
          if (!best || d < best.d) best = { i, d };
        }
      }
      if (best) openings.push([pts[end], pts[best.i]]);
    }
  }
  return { walls, openings };
}

/** One keyhole from its low cones: the ring, then two cones up each side of the neck. */
function keyholeFence(low) {
  const n = low.length - 2 * KEYHOLE_NECK_CONES;
  const ring = low.slice(0, n);
  const neckA = low.slice(n, n + KEYHOLE_NECK_CONES);
  const neckB = low.slice(n + KEYHOLE_NECK_CONES);
  const wall = [...neckA.slice().reverse(), ...smoothThrough(ring), ...neckB];
  wall.smooth = true;
  return {
    walls: [wall],
    openings: [[neckA.at(-1), neckB.at(-1)]],
  };
}

/** A corridor between two walls, open at both ends. */
function corridor(sides) {
  const [a, b] = sides;
  return { openings: [[a[0], b[0]], [a.at(-1), b.at(-1)]] };
}

/**
 * The fence of each bounded element and of the start-and-finish box.
 * @returns {{element: string, walls: number[][][], openings: number[][][]}[]}
 */
export function fences(course) {
  const byId = new Map(course.cones.map((c) => [c.id, [c.hx / 2, c.hy / 2]]));
  const out = [];
  for (const e of course.elements) {
    if (!FENCED_TYPES.includes(e.type)) continue;
    const pts = e.cones.map((id) => byId.get(id));
    const wallLines = (e.lines ?? []).filter((l) => l.kind === 'wall').map((l) => l.cones.map((id) => byId.get(id)));
    let f;
    switch (e.type) {
      case 'u-turn': // open on the entry side, 4–1
        f = { walls: wallLines, openings: [[pts[3], pts[0]]] };
        break;
      case 'box': // open on the entry (4–1) and exit (1–2) sides
        f = { walls: wallLines, openings: [[pts[3], pts[0]], [pts[0], pts[1]]] };
        break;
      case 'box-eight': // the rectangle (after the two tall cones and the gate in the middle), closed
        f = { walls: [[...pts.slice(4, 8), pts[4]]], openings: [] };
        break;
      case 'keyhole':
        f = keyholeFence(pts.slice(0, -1));
        break;
      case 'double-keyhole': {
        const half = pts.length / 2;
        const a = keyholeFence(pts.slice(1, half));
        const b = keyholeFence(pts.slice(half + 1));
        f = { walls: [...a.walls, ...b.walls], openings: [...a.openings, ...b.openings] };
        break;
      }
      case 'snail':
        f = snailFence(e, pts);
        break;
      case 'corridor-slalom':
        f = { walls: wallLines, openings: [[pts[3], pts[0]], [pts[1], pts[2]]] };
        break;
      default: // zigzag, swerve: a corridor of two walls (the swerve's dead end is a third)
        f = { walls: wallLines, ...corridor(wallLines) };
    }
    out.push({ element: e.id, ...f });
  }
  if (course.route.shape === 'return') {
    // Out and back in across the start line (its first two cones): the other three sides are the fence.
    const [a, b, c, d] = course.route.start.cones.map((id) => byId.get(id));
    out.push({ element: 'start', walls: [[b, c, d, a]], openings: [[a, b]] });
  }
  return out;
}

/** Where segment p1–p2 crosses q1–q2: the fraction along p1–p2, or null. */
function crossAt(p1, p2, q1, q2) {
  const rx = p2[0] - p1[0];
  const ry = p2[1] - p1[1];
  const sx = q2[0] - q1[0];
  const sy = q2[1] - q1[1];
  const d = rx * sy - ry * sx;
  if (Math.abs(d) < 1e-12) return null;
  const qx = q1[0] - p1[0];
  const qy = q1[1] - p1[1];
  const t = (qx * sy - qy * sx) / d;
  const u = (qx * ry - qy * rx) / d;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? t : null;
}

/** Distances along a polyline where any of the lines (each a list of points) crosses it. */
function crossings(poly, lines) {
  const found = [];
  let s = 0;
  for (let i = 1; i < poly.length; i++) {
    const [p, q] = [poly[i - 1], poly[i]];
    const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
    for (const line of lines) {
      for (let j = 1; j < line.length; j++) {
        const t = crossAt(p, q, line[j - 1], line[j]);
        if (t !== null && !found.some((f) => Math.abs(f - (s + t * len)) < 0.3)) found.push(s + t * len);
      }
    }
    s += len;
  }
  return found.sort((a, b) => a - b);
}

/** The point and heading at distance s along a polyline. */
function along(poly, s) {
  let acc = 0;
  for (let i = 1; i < poly.length; i++) {
    const [p, q] = [poly[i - 1], poly[i]];
    const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
    if (acc + len >= s || i === poly.length - 1) {
      const f = len ? Math.max(0, Math.min(1, (s - acc) / len)) : 0;
      return { x: p[0] + (q[0] - p[0]) * f, y: p[1] + (q[1] - p[1]) * f, a: Math.atan2(q[1] - p[1], q[0] - p[0]) };
    }
    acc += len;
  }
  return { x: poly[0][0], y: poly[0][1], a: 0 };
}

/** The piece of a polyline between distances s0 and s1. */
function piece(poly, s0, s1) {
  const out = [];
  const a = along(poly, s0);
  out.push([a.x, a.y]);
  let acc = 0;
  for (let i = 1; i < poly.length; i++) {
    acc += Math.hypot(poly[i][0] - poly[i - 1][0], poly[i][1] - poly[i - 1][1]);
    if (acc > s0 && acc < s1) out.push(poly[i]);
  }
  const b = along(poly, s1);
  out.push([b.x, b.y]);
  return out;
}

const lengthOf = (poly) => poly.slice(1).reduce((s, p, i) => s + Math.hypot(p[0] - poly[i][0], p[1] - poly[i][1]), 0);

/**
 * A fence as drawn: its walls (and its wide openings) cut where the ridden
 * line goes through them, and the gate posts at each side of every cut, each
 * `{x, y, a}` with `a` the fence's heading there. Two cuts that would overlap
 * (in and out of a U-turn side by side) make one gate.
 * @param {number[][][]} lines the stretches of the ridden line that go in and out, in metres
 */
export function gatedFence(fence, lines) {
  const walls = [];
  const posts = [];
  const wide = fence.openings.filter(([p, q]) => Math.hypot(q[0] - p[0], q[1] - p[1]) >= WIDE_OPENING);
  for (const wall of [...fence.walls, ...wide]) {
    const total = lengthOf(wall);
    // A straight wall's corners are cones: a gate stops at one, the cone its post on that side.
    const corners = [0];
    if (!wall.smooth) for (let i = 1; i < wall.length; i++) corners.push(corners.at(-1) + Math.hypot(wall[i][0] - wall[i - 1][0], wall[i][1] - wall[i - 1][1]));
    const gaps = [];
    for (const s of crossings(wall, lines)) {
      const lo = Math.max(0, ...corners.filter((c) => c < s - 1e-6));
      const hi = Math.min(total, ...corners.filter((c) => c > s + 1e-6));
      const [g0, g1] = [Math.max(lo, s - GATE_HALF), Math.min(hi, s + GATE_HALF)];
      if (gaps.length && g0 <= gaps.at(-1)[1]) gaps.at(-1)[1] = g1;
      else gaps.push([g0, g1]);
    }
    let from = 0;
    for (const [g0, g1] of gaps) {
      if (g0 > from) walls.push(piece(wall, from, g0));
      for (const g of [g0, g1]) {
        // Heading of the side the gate is on, also when its post is at a corner.
        const p = along(wall, g);
        // A corner both gates stop at (a box's in and out) gets one post.
        if (!posts.some((q) => Math.hypot(q.x - p.x, q.y - p.y) < 0.3)) posts.push({ ...p, a: along(wall, (g0 + g1) / 2).a });
      }
      from = g1;
    }
    if (from < total) walls.push(piece(wall, from, total));
  }
  return { walls, posts };
}
