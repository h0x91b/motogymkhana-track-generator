// Where the start and finish plates go on the plan: `k` metres behind each
// line. A closed course has one plate for both, behind its line. A finish by
// the start has one plate too, `k` metres out of its box on a side the way
// back does not use: behind it, or to its left when the way back comes in
// through the back.

const dirVec = (dir) => [Math.cos((dir * Math.PI) / 4), Math.sin((dir * Math.PI) / 4)];

/** @returns {{t: object, kind: 'start' | 'finish' | 'both', x: number, y: number}[]} */
export function terminalPlates(route, k) {
  const { start, finish } = route;
  const at = (t, kind, s) => {
    const [ux, uy] = dirVec(t.dir);
    return { t, kind, x: t.x + s * ux * k, y: t.y + s * uy * k };
  };
  if (route.shape === 'closed') return [at(start, 'both', -1)];
  if (route.shape === 'return') {
    // From the middle of the box, half the box out and `k` more.
    const half = Math.hypot(finish.x - start.x, finish.y - start.y);
    const out = finish.dir === start.dir ? (start.dir + 2) % 8 : (start.dir + 4) % 8;
    const [ox, oy] = dirVec(out);
    return [{ t: start, kind: 'both', x: finish.x + ox * (half + k), y: finish.y + oy * (half + k) }];
  }
  return [at(start, 'start', -1), at(finish, 'finish', -1)];
}

/**
 * Arrows of a start-and-finish box: out across the start line, and back in
 * where the last connector crosses into the box. Points in metres, angles in
 * radians from +x.
 * @returns {{x: number, y: number, a: number}[]}
 */
export function boxArrows(route) {
  if (route.shape !== 'return') return [];
  const { start } = route;
  const back = route.legs.at(-1).path;
  const [p, q] = back.slice(-2);
  return [
    { x: start.x, y: start.y, a: (start.dir * Math.PI) / 4 },
    { x: (p[0] + q[0]) / 2, y: (p[1] + q[1]) / 2, a: Math.atan2(q[1] - p[1], q[0] - p[0]) },
  ];
}
