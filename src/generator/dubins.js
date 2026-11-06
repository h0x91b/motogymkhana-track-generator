// Connectors are Dubins paths: the shortest curves between two poses made of
// straight lines and arcs of exactly the minimum turning radius. Formulas
// follow A. Walker's dubins.c (Shkel & Lumelsky classification).

import { mod2pi, PI, TAU } from './geometry.js';

const WORDS = ['LSL', 'RSR', 'LSR', 'RSL', 'RLR', 'LRL'];

function segments(word, alpha, beta, d) {
  const sa = Math.sin(alpha);
  const sb = Math.sin(beta);
  const ca = Math.cos(alpha);
  const cb = Math.cos(beta);
  const cab = Math.cos(alpha - beta);
  const d2 = d * d;
  switch (word) {
    case 'LSL': {
      const p2 = 2 + d2 - 2 * cab + 2 * d * (sa - sb);
      if (p2 < 0) return null;
      const t = Math.atan2(cb - ca, d + sa - sb);
      return [mod2pi(t - alpha), Math.sqrt(p2), mod2pi(beta - t)];
    }
    case 'RSR': {
      const p2 = 2 + d2 - 2 * cab + 2 * d * (sb - sa);
      if (p2 < 0) return null;
      const t = Math.atan2(ca - cb, d - sa + sb);
      return [mod2pi(alpha - t), Math.sqrt(p2), mod2pi(t - beta)];
    }
    case 'LSR': {
      const p2 = -2 + d2 + 2 * cab + 2 * d * (sa + sb);
      if (p2 < 0) return null;
      const p = Math.sqrt(p2);
      const t = Math.atan2(-ca - cb, d + sa + sb) - Math.atan2(-2, p);
      return [mod2pi(t - alpha), p, mod2pi(t - mod2pi(beta))];
    }
    case 'RSL': {
      const p2 = -2 + d2 + 2 * cab - 2 * d * (sa + sb);
      if (p2 < 0) return null;
      const p = Math.sqrt(p2);
      const t = Math.atan2(ca + cb, d - sa - sb) - Math.atan2(2, p);
      return [mod2pi(alpha - t), p, mod2pi(beta - t)];
    }
    case 'RLR': {
      const c = (6 - d2 + 2 * cab + 2 * d * (sa - sb)) / 8;
      if (Math.abs(c) > 1) return null;
      const phi = Math.atan2(ca - cb, d - sa + sb);
      const p = mod2pi(TAU - Math.acos(c));
      const t = mod2pi(alpha - phi + mod2pi(p / 2));
      return [t, p, mod2pi(alpha - beta - t + mod2pi(p))];
    }
    case 'LRL': {
      const c = (6 - d2 + 2 * cab + 2 * d * (sb - sa)) / 8;
      if (Math.abs(c) > 1) return null;
      const phi = Math.atan2(ca - cb, d + sa - sb);
      const p = mod2pi(TAU - Math.acos(c));
      const t = mod2pi(-alpha - phi + p / 2);
      return [t, p, mod2pi(mod2pi(beta) - alpha - t + mod2pi(p))];
    }
    default:
      return null;
  }
}

function samplePath(from, word, segs, rho) {
  let [x, y, h] = from;
  const points = [[x, y]];
  let left = 0;
  let right = 0;
  const arcs = [];
  let gap = Infinity; // straight run before the next arc, metres
  for (let i = 0; i < 3; i++) {
    const kind = word[i];
    const len = segs[i];
    if (len < 1e-9) continue;
    if (kind === 'S') {
      gap = len * rho;
      x += len * rho * Math.cos(h);
      y += len * rho * Math.sin(h);
      points.push([x, y]);
      continue;
    }
    const sign = kind === 'L' ? 1 : -1;
    const cx = x - sign * rho * Math.sin(h);
    const cy = y + sign * rho * Math.cos(h);
    const n = Math.max(1, Math.ceil(len / (PI / 18)));
    for (let k = 1; k <= n; k++) {
      const a = h + (sign * len * k) / n;
      points.push([cx + sign * rho * Math.sin(a), cy - sign * rho * Math.cos(a)]);
    }
    arcs.push({ center: [cx, cy], turn: len, left: sign > 0, gapBefore: gap });
    gap = 0;
    h += sign * len;
    x = points[points.length - 1][0];
    y = points[points.length - 1][1];
    if (sign > 0) left += len;
    else right += len;
  }
  return { points, arcs, turnLeft: (left * 180) / PI, turnRight: (right * 180) / PI };
}

/**
 * All Dubins paths from pose `from` to pose `to` ([x, y, heading]), shortest
 * first; ties keep the fixed word order so the choice is stable.
 */
export function dubinsPaths(from, to, rho) {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const d = Math.sqrt(dx * dx + dy * dy) / rho;
  const theta = d > 0 ? mod2pi(Math.atan2(dy, dx)) : 0;
  const alpha = mod2pi(from[2] - theta);
  const beta = mod2pi(to[2] - theta);
  const found = [];
  WORDS.forEach((word, order) => {
    const segs = segments(word, alpha, beta, d);
    if (!segs) return;
    const length = (segs[0] + segs[1] + segs[2]) * rho;
    found.push({ word, segs, length, order });
  });
  found.sort((a, b) => a.length - b.length || a.order - b.order);
  return found.map((f) => ({ word: f.word, length: f.length, ...samplePath(from, f.word, f.segs, rho) }));
}
