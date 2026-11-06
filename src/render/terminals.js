// Where the start and finish plates go on the plan: `k` metres behind each
// line. A finish by the start stands a few metres from the start, so there the
// start's plate stays behind it (the waiting area, always free) and the
// finish's goes ahead of it (the run-out, always free) or behind it, whichever
// is farther from the start's plate.

const dirVec = (dir) => [Math.cos((dir * Math.PI) / 4), Math.sin((dir * Math.PI) / 4)];

/** @returns {{t: object, kind: 'start' | 'finish' | 'both', x: number, y: number}[]} */
export function terminalPlates(route, k) {
  const { start, finish } = route;
  const at = (t, kind, s) => {
    const [ux, uy] = dirVec(t.dir);
    return { t, kind, x: t.x + s * ux * k, y: t.y + s * uy * k };
  };
  if (route.shape === 'closed') return [at(start, 'both', -1)];
  const first = at(start, 'start', -1);
  if (route.shape !== 'return') return [first, at(finish, 'finish', -1)];
  const away = (p) => Math.hypot(p.x - first.x, p.y - first.y);
  const ahead = at(finish, 'finish', 1);
  const behind = at(finish, 'finish', -1);
  return [first, away(ahead) >= away(behind) ? ahead : behind];
}
