// Reserved zones: the asphalt the generator keeps for something, read back from
// a generated course for drawing only. Nothing here feeds the search; the
// shapes are the ones the course already carries, or rebuilt exactly the way
// the generator builds them (the U-turn cone keep-out is not serialized).

import { safetyOf } from '../generator/index.js';

/**
 * Every reserved zone of the course, in the order they are drawn (widest and
 * faintest first). Kinds:
 * - `runOff`   — free asphalt round a turning element (5 m from its core by default);
 * - `zone`     — element zone: cones and line plus 0,75 м by default, nothing else enters;
 * - `terminal` — start or finish line with its waiting / run-out area;
 * - `turnCone` — keep-out round a connector's U-turn cone (3 × 3 m by default), with its colour;
 *   none when the recipe switches it off.
 * The site margin is drawn by each renderer on its own (`course.site.margin`).
 */
export function reservedZones(course) {
  const out = [];
  for (const e of course.elements) if (e.runOff) out.push({ kind: 'runOff', element: e.id, poly: e.runOff });
  for (const e of course.elements) out.push({ kind: 'zone', element: e.id, poly: e.zone });
  const { start, finish } = course.route;
  out.push({ kind: 'terminal', poly: start.zone });
  if (finish !== start && JSON.stringify(finish.zone) !== JSON.stringify(start.zone)) out.push({ kind: 'terminal', poly: finish.zone });
  const byId = new Map(course.cones.map((c) => [c.id, c]));
  const side = new Map(course.passes.filter((p) => p.connector).map((p) => [p.cone, p.side]));
  const r = safetyOf(course.recipe).coneGap;
  if (r <= 0) return out;
  for (const leg of course.route.legs) {
    for (const id of leg.cones ?? []) {
      const c = byId.get(id);
      const x = c.hx / 2;
      const y = c.hy / 2;
      out.push({
        kind: 'turnCone', cone: id, color: side.get(id) === 'left' ? 'blue' : 'red',
        poly: [[x - r, y - r], [x + r, y - r], [x + r, y + r], [x - r, y + r]],
      });
    }
  }
  return out;
}
