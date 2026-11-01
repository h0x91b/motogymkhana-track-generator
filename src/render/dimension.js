// Where a dimension line of the setup sheet is drawn, in site metres. Shared by
// the scene and the setup-sheet picture so both show the same drawing.

const OFFSET = 0.8; // the line sits this far beside what it measures
const GAP = 0.25; // extension lines start this far from the cone centre
const OVERSHOOT = 0.2; // …and run this far past the dimension line
const TICK = 0.22; // half-length of the 45° end ticks

/**
 * The dimension line is moved sideways, away from the element's centre, so it
 * does not sit on the cones; on the centre line it goes to the left of the
 * measured direction.
 *
 * @returns {{line: number[][], extensions: number[][][], ticks: number[][][], mid: number[], normal: number[]}}
 */
export function dimensionLayout(dim, centre) {
  const dx = dim.to.x - dim.from.x;
  const dy = dim.to.y - dim.from.y;
  const len = Math.hypot(dx, dy);
  const ux = dx / len;
  const uy = dy / len;
  let nx = -uy;
  let ny = ux;
  const mx = (dim.from.x + dim.to.x) / 2;
  const my = (dim.from.y + dim.to.y) / 2;
  if ((mx - centre[0]) * nx + (my - centre[1]) * ny < -0.05) {
    nx = -nx;
    ny = -ny;
  }
  const along = (p, k) => [p.x + nx * k, p.y + ny * k];
  const a = along(dim.from, OFFSET);
  const b = along(dim.to, OFFSET);
  const tx = (ux + nx) * TICK;
  const ty = (uy + ny) * TICK;
  return {
    line: [a, b],
    extensions: [dim.from, dim.to].map((p) => [along(p, GAP), along(p, OFFSET + OVERSHOOT)]),
    ticks: [a, b].map(([x, y]) => [[x - tx, y - ty], [x + tx, y + ty]]),
    mid: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2],
    normal: [nx, ny],
  };
}

const overlap = (a, b) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];

/**
 * Where a dimension label goes: on its line when that keeps clear of every
 * taken box (cones, names, other labels), else stepped outwards along the
 * normal. Boxes are [x0, y0, x1, y1] in the caller's pixels; `boxAt` gives the
 * label's box for a spot in site metres, `step` is in metres.
 */
export function placeLabel(layout, step, boxAt, taken) {
  for (let k = 0; k < 5; k++) {
    const spot = [layout.mid[0] + layout.normal[0] * step * k, layout.mid[1] + layout.normal[1] * step * k];
    const box = boxAt(spot);
    if (!taken.some((t) => overlap(box, t))) return { spot, box };
  }
  return { spot: layout.mid, box: boxAt(layout.mid) };
}

/** Centre of an element's zone, the side dimension lines move away from. */
export const zoneCentre = (zone) => [(zone[0][0] + zone[2][0]) / 2, (zone[0][1] + zone[2][1]) / 2];
