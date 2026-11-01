// The route as one ridden line (connectors and elements in passing order),
// measured by distance, so a schematic motorcycle can ride it at a set speed.

export const RIDE_SPEED = 5; // m/s, about 18 km/h
const G = 9.81;
const MAX_LEAN = (40 * Math.PI) / 180;

export function buildRide(course) {
  const elements = new Map(course.elements.map((e) => [e.id, e]));
  const points = [];
  const owner = []; // element ridden on the way to each point, null on connectors
  for (const leg of course.route.legs) {
    const id = leg.kind === 'element' ? leg.element : null;
    for (const p of id ? elements.get(id).path : leg.path) {
      const last = points[points.length - 1];
      if (last && Math.hypot(p[0] - last[0], p[1] - last[1]) < 1e-6) continue;
      points.push(p);
      owner.push(id);
    }
  }
  const cum = [0];
  for (let i = 1; i < points.length; i++) {
    cum.push(cum[i - 1] + Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]));
  }
  return { points, owner, cum, length: cum[cum.length - 1] };
}

/** Index of the segment that contains distance s. */
function segmentAt(ride, s) {
  let lo = 0;
  let hi = ride.cum.length - 2;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (ride.cum[mid] <= s) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

function pointAt(ride, s) {
  const d = Math.max(0, Math.min(ride.length, s));
  const i = segmentAt(ride, d);
  const [ax, ay] = ride.points[i];
  const [bx, by] = ride.points[i + 1];
  const t = (d - ride.cum[i]) / (ride.cum[i + 1] - ride.cum[i] || 1);
  return [ax + (bx - ax) * t, ay + (by - ay) * t];
}

function headingBetween(ride, s0, s1) {
  const [ax, ay] = pointAt(ride, s0);
  const [bx, by] = pointAt(ride, s1);
  return Math.atan2(by - ay, bx - ax);
}

/**
 * Pose of the rider at distance s: position, heading, lean into the turn
 * (positive to the left, from v² / (g R)) and the element being ridden.
 */
export function rideAt(ride, s) {
  const d = Math.max(0, Math.min(ride.length, s));
  const [x, y] = pointAt(ride, d);
  const heading = headingBetween(ride, d - 0.6, d + 0.6);
  let turn = headingBetween(ride, d + 0.4, d + 1.4) - headingBetween(ride, d - 1.4, d - 0.4);
  turn = Math.atan2(Math.sin(turn), Math.cos(turn));
  const curvature = turn / 1.8;
  const lean = Math.max(-MAX_LEAN, Math.min(MAX_LEAN, Math.atan((RIDE_SPEED * RIDE_SPEED * curvature) / G)));
  return { x, y, heading, lean, element: ride.owner[segmentAt(ride, d) + 1] };
}
