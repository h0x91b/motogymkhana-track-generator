// Where the start and finish plates go on the plan: `k` metres behind each
// line. A closed course has one plate for both, behind its line. A finish by
// the start has one plate too, `k` metres behind its box: the way out and the
// way back both use the line in front of it.

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
    // The box is as deep as the line is wide, about 3 m.
    const [ux, uy] = dirVec(start.dir);
    return [{ t: start, kind: 'both', x: start.x - ux * (3 + k), y: start.y - uy * (3 + k) }];
  }
  return [at(start, 'start', -1), at(finish, 'finish', -1)];
}

/**
 * Arrows of a start-and-finish box: out across the start line, just past it,
 * and back in across the same line, just inside the box. Points in metres,
 * angles in radians from +x.
 * @returns {{x: number, y: number, a: number}[]}
 */
export function boxArrows(route) {
  if (route.shape !== 'return') return [];
  const { start } = route;
  const back = route.legs.at(-1).path;
  const [p, q] = back.slice(-2);
  const [ux, uy] = dirVec(start.dir);
  return [
    { x: start.x + ux * 0.8, y: start.y + uy * 0.8, a: (start.dir * Math.PI) / 4 },
    { x: (p[0] + q[0]) / 2, y: (p[1] + q[1]) / 2, a: Math.atan2(q[1] - p[1], q[0] - p[0]) },
  ];
}
