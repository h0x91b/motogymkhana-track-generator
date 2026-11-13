// The way round a loop ridden one way only (a keyhole's, each ring of a double
// keyhole): a curved arrow inside the loop, round its centre cone, in the
// cone's side colour. Site metres; each renderer projects and strokes it.

const SWEEP = 1.5 * Math.PI; // three quarters of a turn, so the arrow reads as round
const SHARE = 0.55; // of the loop's radius: well inside the line ridden, clear of the cone

/**
 * The arrow of a loop from `loopsOf`: its arc as points from tail to tip and
 * the tip with the direction it points in (radians, anticlockwise from +X).
 */
export function loopArrow(loop) {
  const r = loop.radius * SHARE;
  const way = loop.clockwise ? -1 : 1;
  // Centred on the top of the loop, the gap at the bottom either way round.
  const from = Math.PI / 2 - (way * SWEEP) / 2;
  const n = 36;
  const points = Array.from({ length: n + 1 }, (_, i) => {
    const t = from + (way * SWEEP * i) / n;
    return [loop.x + r * Math.cos(t), loop.y + r * Math.sin(t)];
  });
  const end = from + way * SWEEP;
  return { points, radius: r, tip: { x: points[n][0], y: points[n][1], a: end + (way * Math.PI) / 2 } };
}
