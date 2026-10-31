// Soft criteria — everything that decides which valid course is "nicer" lives
// here so it can be retuned in one place after field tests. Any change here
// alters generated courses and must bump GENERATOR_VERSION.

import { cos, sin, TAU } from './dmath.js';

export const WEIGHTS = {
  target: 1.0, // stay near this element's layout target (spreads the course)
  spread: 0.6, // keep away from the elements already placed
  connector: 0.5, // short connectors
  balance: 0.8, // equal left and right turning
};

/**
 * Layout targets: one point per element, in route order, spread over the site.
 * A closed course walks a ring so the last element ends up near the start;
 * an open course snakes through a grid of cells.
 */
export function layoutTargets(inner, n, closed, rng) {
  const [x0, y0, x1, y1] = inner;
  const w = x1 - x0;
  const h = y1 - y0;
  if (closed) {
    const start = rng.float() * TAU;
    const dir = rng.int(0, 1) === 0 ? 1 : -1;
    const out = [];
    for (let i = 0; i < n; i++) {
      const a = start + (dir * TAU * i) / n;
      out.push([x0 + w / 2 + 0.3 * w * cos(a), y0 + h / 2 + 0.3 * h * sin(a)]);
    }
    return out;
  }
  const rows = Math.max(1, Math.min(n, Math.round(Math.sqrt((n * h) / w))));
  const cols = Math.ceil(n / rows);
  const flipX = rng.int(0, 1) === 1;
  const flipY = rng.int(0, 1) === 1;
  const out = [];
  for (let r = 0; r < rows && out.length < n; r++) {
    for (let k = 0; k < cols && out.length < n; k++) {
      const c = r % 2 === 0 ? k : cols - 1 - k;
      const fx = (c + 0.5) / cols;
      const fy = (r + 0.5) / rows;
      out.push([x0 + w * (flipX ? 1 - fx : fx), y0 + h * (flipY ? 1 - fy : fy)]);
    }
  }
  return out;
}

/**
 * Higher is better. All terms are normalised by the site diagonal or by total
 * turning so the weights stay comparable across site sizes.
 */
export function scorePlacement({ center, target, others, connectorLength, turnLeft, turnRight, diagonal }) {
  // No `**` anywhere in the generator: exponentiation is implementation-approximated too.
  const dist = (p, q) => Math.sqrt((p[0] - q[0]) * (p[0] - q[0]) + (p[1] - q[1]) * (p[1] - q[1]));
  const dt = dist(center, target) / diagonal;
  let nearest = diagonal;
  for (const o of others) {
    const d = dist(center, o);
    if (d < nearest) nearest = d;
  }
  const spread = Math.min(nearest / diagonal, 0.25);
  const imbalance = Math.abs(turnLeft - turnRight) / (turnLeft + turnRight + 360);
  return (
    -WEIGHTS.target * dt +
    WEIGHTS.spread * spread -
    WEIGHTS.connector * (connectorLength / diagonal) -
    WEIGHTS.balance * imbalance
  );
}
