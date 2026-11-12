// Resize handles of the selected blocked area in «Правка»: four corners and four
// side midpoints of its rectangle on the plan. Pure screen geometry, no DOM:
// the scene builds them, the pointer code asks which one a press is on.

/** Half the side of the square a press must land in: a mouse is precise, a finger is not. */
export const HANDLE_REACH = { mouse: 8, touch: 16 };

/** Which edges each handle moves: sx/sy -1 the side at x/y, +1 the side at x + w / y + h, 0 neither. */
export const HANDLE_SIDES = [
  [-1, -1], [0, -1], [1, -1],
  [-1, 0], [1, 0],
  [-1, 1], [0, 1], [1, 1],
];

/**
 * The cursor for a handle at screen offset (vx, vy) from the rectangle's centre
 * (screen y grows downwards). A side: along the axis it points on screen. A
 * corner: the diagonal it lies on.
 */
export function handleCursor(sx, sy, vx, vy) {
  if (!sx || !sy) return Math.abs(vx) >= Math.abs(vy) ? 'ew-resize' : 'ns-resize';
  return vx * vy >= 0 ? 'nwse-resize' : 'nesw-resize';
}

/**
 * Hit targets of the handles of rectangle `b` ({x, y, w, h}, metres) of
 * element `element`; `project(x, y)` gives its screen point {x, y}.
 */
export function blockedHandles(element, b, project) {
  const corners = [[b.x, b.y], [b.x + b.w, b.y], [b.x + b.w, b.y + b.h], [b.x, b.y + b.h]].map(([x, y]) => project(x, y));
  const c = project(b.x + b.w / 2, b.y + b.h / 2);
  const side = Math.min(Math.hypot(corners[1].x - corners[0].x, corners[1].y - corners[0].y), Math.hypot(corners[3].x - corners[0].x, corners[3].y - corners[0].y));
  return HANDLE_SIDES.map(([sx, sy]) => {
    const p = project(b.x + ((sx + 1) / 2) * b.w, b.y + ((sy + 1) / 2) * b.h);
    return { kind: 'handle', element, sx, sy, x: p.x, y: p.y, cursor: handleCursor(sx, sy, p.x - c.x, p.y - c.y), poly: corners, side };
  });
}

function inside(poly, x, y) {
  let into = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    if ((poly[i].y > y) !== (poly[j].y > y) && x < ((poly[j].x - poly[i].x) * (y - poly[i].y)) / (poly[j].y - poly[i].y) + poly[i].x) into = !into;
  }
  return into;
}

/**
 * The handle a press at (x, y) CSS px is on, or null: the nearest within reach
 * (a square of `HANDLE_REACH` each way). Inside the rectangle the reach shrinks
 * to a quarter of its shorter side on screen, so a small one still has a middle
 * to drag it by; from outside a handle keeps its full reach.
 */
export function hitHandle(hits, x, y, pointer = 'mouse') {
  const reach = HANDLE_REACH[pointer] ?? HANDLE_REACH.touch;
  let best = null;
  let bestD = Infinity;
  for (const h of hits) {
    if (h.kind !== 'handle') continue;
    const r = inside(h.poly, x, y) ? Math.min(reach, h.side / 4) : reach;
    const d = Math.max(Math.abs(h.x - x), Math.abs(h.y - y));
    if (d <= r && d < bestD) {
      best = h;
      bestD = d;
    }
  }
  return best;
}
