// The rider's sheet: one A4 page with the whole course, for the person riding
// it, not the one laying it out. What matters is the trajectory: one bold line
// in passing order with direction arrows, each element in its own colour with
// its number at the entry, cones in their side colours, start and finish. No
// dimensions, coordinates, grid, reserved zones or anchors: the setup-sheet
// frames carry those (SPEC, «Лист гонщика»).

import { SHAPE_NAMES } from '../generator/recipe.js';
import { buildRide } from './ride.js';
import { loopArrow } from './loops.js';
import { boxArrows, terminalPlates } from './terminals.js';

/** A4 at 300 dpi. */
export const A4 = { short: 2480, long: 3508 };
const MARGIN = 150; // 12.7 mm: clear of what a home printer cannot reach
const HEADER = 120;
const FOOTER = 200;
const INK = '#1f2a31';
const MUTED = '#5b6870';
const BLUE = '#2b72c4';
const RED = '#cc4330';
const STRIPE = '#f5c400';
const LOW = '#f08a24';
const PLATE = '#ffe14d';
const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
/**
 * The line's colour per element, cycled past eight. Chosen and checked with the
 * categorical-palette validator (cyclically, last to first too): ≥ 3:1 on white,
 * neighbours ≥ 15 ΔE apart for normal vision and ≥ 7 for colour-blind readers
 * (the numbers carry identity too), and ≥ 0.07 apart in OKLab lightness so
 * neighbours differ printed in grey. No pure red or blue: those are the cones'
 * sides.
 */
export const LINE_COLORS = ['#8e44ad', '#e0457b', '#2f6b2f', '#9a7400', '#b0007a', '#5c8a00', '#6b2fa0', '#e65100'];
const CONE_FILL = { blue: BLUE, red: RED, striped: RED };
const DIFFICULTY_NAMES = { easy: 'лёгкая', medium: 'средняя', hard: 'сложная' };
const BIKE_LABELS = { sport: 'спортбайк', cruiser: 'крузер' };
const PLATE_TEXT = { start: 'СТАРТ', finish: 'ФИНИШ', both: 'СТАРТ / ФИНИШ' };

const font = (ctx, size, weight = 400) => {
  ctx.font = `${weight} ${size}px ${FONT}`;
};

/**
 * The page and the plan on it: portrait, or landscape when the lot comes out
 * larger that way.
 */
export function riderPage(site) {
  const fit = (w, h) => Math.min((w - 2 * MARGIN) / site.width, (h - 2 * MARGIN - HEADER - FOOTER) / site.length);
  const portrait = fit(A4.short, A4.long);
  const landscape = fit(A4.long, A4.short);
  return landscape > portrait
    ? { width: A4.long, height: A4.short, scale: landscape, landscape: true }
    : { width: A4.short, height: A4.long, scale: portrait, landscape: false };
}

/** Sizes of everything on the plan, from its pixels per metre: legible at 40 × 60, not bloated at 15 × 20. */
export function riderSizes(s) {
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const line = clamp(0.22 * s, 8, 18);
  return {
    line,
    halo: line * 0.9, // white gap each side where the line passes over itself
    arrow: line * 3,
    arrowStep: Math.max(5, 260 / s), // metres between direction arrows
    cone: clamp(0.38 * s, 15, 34),
    badge: clamp(0.62 * s, 30, 48),
  };
}

function coneDot(ctx, x, y, color, height, r) {
  if (height === 'low') {
    ctx.fillStyle = LOW;
    ctx.beginPath();
    ctx.arc(x, y, r * 0.62, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = Math.max(2, r * 0.12);
    ctx.strokeStyle = '#8a4a0c';
    ctx.stroke();
    return;
  }
  ctx.fillStyle = CONE_FILL[color] ?? '#8d9a9f';
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = Math.max(2.5, r * 0.14);
  ctx.strokeStyle = INK;
  ctx.stroke();
  if (color === 'striped') {
    ctx.lineWidth = r * 0.36;
    ctx.strokeStyle = STRIPE;
    ctx.beginPath();
    ctx.arc(x, y, r * 0.58, 0, Math.PI * 2);
    ctx.stroke();
  } else if (color === 'blue' || color === 'red') {
    // The side letter too, for a black-and-white print.
    font(ctx, Math.round(r * 1.2), 800);
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(color === 'blue' ? 'Л' : 'П', x, y + r * 0.06);
  }
}

function arrowHead(ctx, x, y, a, size, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x + Math.cos(a) * size, y + Math.sin(a) * size);
  ctx.lineTo(x + Math.cos(a + 2.55) * size * 0.75, y + Math.sin(a + 2.55) * size * 0.75);
  ctx.lineTo(x + Math.cos(a - 2.55) * size * 0.75, y + Math.sin(a - 2.55) * size * 0.75);
  ctx.closePath();
  ctx.fill();
}

/** Where segment p1–p2 crosses q1–q2, as fractions along each, or null. */
function cross(p1, p2, q1, q2) {
  const rx = p2[0] - p1[0];
  const ry = p2[1] - p1[1];
  const sx = q2[0] - q1[0];
  const sy = q2[1] - q1[1];
  const d = rx * sy - ry * sx;
  if (Math.abs(d) < 1e-12) return null;
  const qx = q1[0] - p1[0];
  const qy = q1[1] - p1[1];
  const t = (qx * sy - qy * sx) / d;
  const u = (qx * ry - qy * rx) / d;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? { t, u } : null;
}

/**
 * Where the ridden line crosses itself: the distance of the earlier and the
 * later pass. The later one is drawn over.
 */
export function selfCrossings(ride) {
  const { points: pts, cum } = ride;
  const cell = 1;
  const grid = new Map();
  const key = (i, j) => `${i},${j}`;
  for (let i = 1; i < pts.length; i++) {
    const [a, b] = [pts[i - 1], pts[i]];
    for (let gx = Math.floor(Math.min(a[0], b[0]) / cell); gx <= Math.floor(Math.max(a[0], b[0]) / cell); gx++) {
      for (let gy = Math.floor(Math.min(a[1], b[1]) / cell); gy <= Math.floor(Math.max(a[1], b[1]) / cell); gy++) {
        const k = key(gx, gy);
        if (!grid.has(k)) grid.set(k, []);
        grid.get(k).push(i);
      }
    }
  }
  const found = [];
  const seen = new Set();
  for (const list of grid.values()) {
    for (let m = 0; m < list.length; m++) {
      for (let n = m + 1; n < list.length; n++) {
        const [i, j] = list[m] < list[n] ? [list[m], list[n]] : [list[n], list[m]];
        // Neighbouring pieces of one pass touch at their ends; that is no crossing.
        if (cum[j - 1] - cum[i] < 1.5 || seen.has(`${i},${j}`)) continue;
        seen.add(`${i},${j}`);
        const hit = cross(pts[i - 1], pts[i], pts[j - 1], pts[j]);
        if (!hit) continue;
        const first = cum[i - 1] + (cum[i] - cum[i - 1]) * hit.t;
        const second = cum[j - 1] + (cum[j] - cum[j - 1]) * hit.u;
        if (found.some((c) => Math.abs(c.first - first) < 1 && Math.abs(c.second - second) < 1)) continue;
        found.push({ first, second, x: pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * hit.t, y: pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * hit.t });
      }
    }
  }
  return found.sort((a, b) => a.second - b.second);
}

/**
 * Each point of the ride with the element whose colour it takes: an element's
 * own line and the connector leading into it share it; the way to the finish
 * after the last element is ink.
 */
function colourOwners(ride, course, entries) {
  const waypoint = new Set(course.elements.filter((e) => e.type === 'waypoint').map((e) => e.id));
  const owners = ride.owner.map((id) => (id && !waypoint.has(id) ? id : null));
  // An element ridden past at one point (a single cone passed) owns no stretch of its own: its entry, then.
  for (const [id, i] of entries) if (!owners.includes(id)) owners[i] = id;
  let next = null;
  for (let i = owners.length - 1; i >= 0; i--) {
    if (owners[i]) next = owners[i];
    else owners[i] = next ? `into:${next}` : null;
  }
  return owners.map((o) => (o?.startsWith('into:') ? o.slice(5) : o));
}

/** The riding order of the elements to ride (no waypoints). */
const ridden = (course) => course.elements.filter((e) => e.type !== 'waypoint').sort((a, b) => a.order - b.order);

/**
 * Where on the ride each element begins, as a point index: its first point, or
 * for an element ridden past at one point the ride point nearest it after the
 * previous element's entry.
 */
function entriesOf(ride, course) {
  const entries = new Map();
  let after = 0;
  for (const e of ridden(course)) {
    let i = ride.owner.indexOf(e.id, after);
    if (i < 0) {
      const [x, y] = e.path?.[0] ?? [e.at?.x ?? 0, e.at?.y ?? 0];
      let best = Infinity;
      for (let k = after; k < ride.points.length; k++) {
        const d = Math.hypot(ride.points[k][0] - x, ride.points[k][1] - y);
        if (d < best) [best, i] = [d, k];
      }
    }
    entries.set(e.id, i);
    after = i;
  }
  return entries;
}

/** A one-line header, shrunk to fit: course name bold, then date, lot, difficulty and bike. */
function drawHeader(ctx, page, course, sheet, { title, date }) {
  const facts = [
    date,
    `площадка ${course.site.width} × ${course.site.length} м`,
    DIFFICULTY_NAMES[course.recipe?.difficulty],
    BIKE_LABELS[sheet.bike],
    SHAPE_NAMES[sheet.shape],
  ].filter(Boolean).join(' · ');
  const width = page.width - 2 * MARGIN;
  let size = 64;
  const measure = () => {
    font(ctx, size, 800);
    const a = ctx.measureText(title).width;
    font(ctx, size * 0.72, 500);
    return a + ctx.measureText(`   ${facts}`).width;
  };
  while (size > 30 && measure() > width) size -= 2;
  const y = MARGIN + HEADER / 2 - 10;
  font(ctx, size, 800);
  ctx.fillStyle = INK;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(title, MARGIN, y);
  const tw = ctx.measureText(title).width;
  font(ctx, size * 0.72, 500);
  ctx.fillStyle = MUTED;
  ctx.fillText(`   ${facts}`, MARGIN + tw, y + size * 0.04);
}

/** The legend: a glyph and a few words per item, in rows across the page. */
function drawFooter(ctx, page, hasPivot) {
  const size = 40;
  const r = 20;
  const items = [
    { glyph: (x, y) => coneDot(ctx, x, y, 'blue', 'tall', r), text: 'синий — оставить слева' },
    { glyph: (x, y) => coneDot(ctx, x, y, 'red', 'tall', r), text: 'красный — оставить справа' },
    ...(hasPivot ? [{ glyph: (x, y) => coneDot(ctx, x, y, 'striped', 'tall', r), text: 'красный с жёлтым — вращение на N°' }] : []),
    { glyph: (x, y) => coneDot(ctx, x, y, null, 'low', r), text: 'низкий конус' },
    {
      glyph: (x, y) => {
        ctx.strokeStyle = INK;
        ctx.lineWidth = 9;
        ctx.lineCap = 'butt';
        ctx.beginPath();
        ctx.moveTo(x - 26, y);
        ctx.lineTo(x + 14, y);
        ctx.stroke();
        arrowHead(ctx, x + 14, y, 0, 24, INK);
      },
      text: 'линия и стрелки — путь и направление',
      wide: true,
    },
    {
      glyph: (x, y) => {
        ctx.fillStyle = PLATE;
        ctx.lineWidth = 3;
        ctx.strokeStyle = INK;
        ctx.beginPath();
        ctx.roundRect(x - 24, y - 16, 48, 32, 6);
        ctx.fill();
        ctx.stroke();
      },
      text: 'СТАРТ / ФИНИШ',
    },
  ];
  font(ctx, size, 500);
  const gap = 56;
  const widths = items.map((it) => (it.wide ? 84 : 60) + ctx.measureText(it.text).width);
  const rows = [[]];
  let used = 0;
  const avail = page.width - 2 * MARGIN;
  items.forEach((it, i) => {
    if (used && used + gap + widths[i] > avail) {
      rows.push([]);
      used = 0;
    }
    rows.at(-1).push(i);
    used += (used ? gap : 0) + widths[i];
  });
  const lineH = 66;
  let y = page.height - MARGIN - (rows.length - 1) * lineH - 20;
  ctx.strokeStyle = '#d5dcda';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(MARGIN, y - 54);
  ctx.lineTo(page.width - MARGIN, y - 54);
  ctx.stroke();
  for (const row of rows) {
    let x = MARGIN;
    for (const i of row) {
      items[i].glyph(x + 26, y);
      font(ctx, size, 500);
      ctx.fillStyle = INK;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(items[i].text, x + (items[i].wide ? 84 : 60), y + 2);
      x += widths[i] + gap;
    }
    y += lineH;
  }
  font(ctx, 28, 600);
  ctx.fillStyle = '#8a969c';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'bottom';
  ctx.fillText('by h0x91B', page.width - MARGIN, page.height - MARGIN + 60);
}

/**
 * Draws the rider's sheet and returns its canvas.
 * @param {(w: number, h: number) => HTMLCanvasElement | OffscreenCanvas} makeCanvas
 * @param {{title?: string, date?: string}} [info] the course name and the date for the header
 */
export function renderRiderSheet(course, sheet, makeCanvas, { title = 'Трасса', date = '' } = {}) {
  const page = riderPage(course.site);
  const canvas = makeCanvas(page.width, page.height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, page.width, page.height);
  drawHeader(ctx, page, course, sheet, { title, date });
  drawFooter(ctx, page, sheet.cards.some((c) => c.angle > 180));

  const s = page.scale;
  const size = riderSizes(s);
  const pw = course.site.width * s;
  const ph = course.site.length * s;
  const ox = (page.width - pw) / 2;
  const oy = MARGIN + HEADER + (page.height - 2 * MARGIN - HEADER - FOOTER - ph) / 2;
  const X = (x) => ox + x * s;
  const Y = (y) => oy + ph - y * s;
  const byId = new Map(course.cones.map((c) => [c.id, c]));

  // The lot, its cutouts and obstacles: light, out of the way.
  ctx.lineWidth = 4;
  ctx.strokeStyle = '#b4bec2';
  ctx.strokeRect(ox, oy, pw, ph);
  for (const b of course.site.blocked ?? []) {
    const [x0, y0, w, h] = [X(b.x), Y(b.y + b.h), b.w * s, b.h * s];
    ctx.fillStyle = '#eef1ef';
    ctx.fillRect(x0, y0, w, h);
    ctx.save();
    ctx.beginPath();
    ctx.rect(x0, y0, w, h);
    ctx.clip();
    ctx.strokeStyle = '#cdd4d1';
    ctx.lineWidth = 3;
    for (let t = -h; t < w + h; t += 28) {
      ctx.beginPath();
      ctx.moveTo(x0 + t, y0 + h);
      ctx.lineTo(x0 + t + h, y0);
      ctx.stroke();
    }
    ctx.restore();
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#a9b4b8';
    ctx.strokeRect(x0, y0, w, h);
  }

  // Chalk lines are painted on the asphalt (the mirror's): the rider sees them.
  for (const e of course.elements) {
    for (const line of e.lines ?? []) {
      if (line.kind !== 'chalk') continue;
      ctx.lineWidth = Math.max(6, size.line * 0.8);
      ctx.strokeStyle = '#9aa5ab';
      ctx.beginPath();
      line.cones.forEach((id, i) => {
        const c = byId.get(id);
        if (i) ctx.lineTo(X(c.hx / 2), Y(c.hy / 2));
        else ctx.moveTo(X(c.hx / 2), Y(c.hy / 2));
      });
      ctx.stroke();
    }
  }

  // Start and finish lines, and the box of a finish by the start, under the riding line.
  ctx.setLineDash([size.line * 1.6, size.line * 1.2]);
  ctx.lineWidth = size.line * 1.3;
  ctx.strokeStyle = INK;
  ctx.lineCap = 'butt';
  if (course.route.shape === 'return') {
    const box = course.route.start.cones.map((id) => byId.get(id));
    ctx.lineWidth = size.line * 0.6;
    ctx.beginPath();
    box.forEach((c, i) => (i ? ctx.lineTo(X(c.hx / 2), Y(c.hy / 2)) : ctx.moveTo(X(c.hx / 2), Y(c.hy / 2))));
    ctx.closePath();
    ctx.stroke();
    ctx.lineWidth = size.line * 1.3;
  }
  const lines = course.route.shape === 'open' ? [course.route.start, course.route.finish] : [course.route.start];
  for (const t of lines) {
    const [a, b] = t.cones.slice(0, 2).map((id) => byId.get(id));
    ctx.beginPath();
    ctx.moveTo(X(a.hx / 2), Y(a.hy / 2));
    ctx.lineTo(X(b.hx / 2), Y(b.hy / 2));
    ctx.stroke();
  }
  ctx.setLineDash([]);

  // The riding line: one bold stroke per element's colour run.
  const ride = buildRide(course);
  const entries = entriesOf(ride, course);
  const owners = colourOwners(ride, course, entries);
  const orderOf = new Map(ridden(course).map((e, i) => [e.id, i]));
  const colourOf = (id) => (id == null ? INK : LINE_COLORS[orderOf.get(id) % LINE_COLORS.length]);
  const pointAt = (d) => {
    const v = Math.max(0, Math.min(ride.length, d));
    let i = 1;
    while (i < ride.cum.length - 1 && ride.cum[i] < v) i++;
    const [a, b] = [ride.points[i - 1], ride.points[i]];
    const f = (v - ride.cum[i - 1]) / (ride.cum[i] - ride.cum[i - 1] || 1);
    return { x: a[0] + (b[0] - a[0]) * f, y: a[1] + (b[1] - a[1]) * f, a: Math.atan2(b[1] - a[1], b[0] - a[0]), i };
  };
  const strokeRun = (from, to, colour, width, cap = 'round') => {
    ctx.lineCap = cap;
    ctx.lineJoin = 'round';
    ctx.lineWidth = width;
    ctx.strokeStyle = colour;
    ctx.beginPath();
    const p0 = pointAt(from);
    ctx.moveTo(X(p0.x), Y(p0.y));
    for (let i = p0.i; i < ride.points.length && ride.cum[i] < to; i++) ctx.lineTo(X(ride.points[i][0]), Y(ride.points[i][1]));
    const p1 = pointAt(to);
    ctx.lineTo(X(p1.x), Y(p1.y));
    ctx.stroke();
  };
  const runs = [];
  for (let i = 0; i < ride.points.length; i++) {
    const last = runs.at(-1);
    if (last && last.owner === owners[i]) last.to = ride.cum[i];
    else {
      if (last) last.to = ride.cum[i];
      runs.push({ owner: owners[i], from: ride.cum[Math.max(0, i - 1)], to: ride.cum[i] });
    }
  }
  for (const run of runs) strokeRun(run.from, run.to, colourOf(run.owner), size.line);
  const colourAt = (d) => colourOf(runs.find((r) => d >= r.from && d <= r.to)?.owner ?? null);

  // Where the line crosses itself, the later pass goes over: a white gap
  // either side of it hides the earlier one, so the order reads at a glance.
  const crossings = selfCrossings(ride);
  const half = Math.max(0.8, (3 * (size.line + size.halo)) / s);
  for (const c of crossings) {
    strokeRun(c.second - half, c.second + half, '#fff', size.line + 2 * size.halo, 'butt');
    strokeRun(c.second - half - 0.05, c.second + half + 0.05, colourAt(c.second), size.line, 'butt');
  }

  // Direction arrows at a steady spacing, clear of the crossings.
  const nearCrossing = (d) => crossings.some((c) => Math.abs(c.first - d) < half + 0.6 || Math.abs(c.second - d) < half + 0.6);
  for (let d = size.arrowStep / 2; d < ride.length - 1; d += size.arrowStep) {
    if (nearCrossing(d)) continue;
    const p = pointAt(d);
    arrowHead(ctx, X(p.x), Y(p.y), -p.a, size.arrow, colourAt(d));
  }

  // A finish by the start: out across the line and back in, in ink.
  for (const { x, y, a } of boxArrows(course.route)) arrowHead(ctx, X(x), Y(y), -a, size.arrow * 1.2, INK);

  // The way round a ring ridden one way only (keyhole): a curved arrow inside it, in the cone's colour.
  for (const card of sheet.cards) {
    for (const loop of card.loops) {
      const { points, tip } = loopArrow(loop);
      ctx.lineCap = 'round';
      ctx.lineWidth = size.line * 0.6;
      ctx.strokeStyle = CONE_FILL[loop.color];
      ctx.beginPath();
      points.forEach(([x, y], i) => (i ? ctx.lineTo(X(x), Y(y)) : ctx.moveTo(X(x), Y(y))));
      ctx.stroke();
      arrowHead(ctx, X(tip.x), Y(tip.y), -tip.a, size.arrow * 0.8, CONE_FILL[loop.color]);
    }
  }

  // Cones in their side colours, connector U-turn cones included.
  const colorOf = new Map();
  for (const card of sheet.cards) {
    const e = course.elements.find((x) => x.id === card.element);
    e.cones.forEach((id, i) => colorOf.set(id, card.cones[i].color));
    for (const t of card.turnCones) colorOf.set(t.cone, t.color);
  }
  for (const c of course.cones) coneDot(ctx, X(c.hx / 2), Y(c.hy / 2), colorOf.get(c.id), c.height, size.cone);

  // Labels keep clear of the line, the cones and each other.
  const avoid = [];
  for (let d = 0; d <= ride.length; d += 0.5) {
    const p = pointAt(d);
    avoid.push([X(p.x), Y(p.y), size.line / 2 + 4]);
  }
  for (const c of course.cones) avoid.push([X(c.hx / 2), Y(c.hy / 2), size.cone + 4]);
  const placed = [];
  const clearance = (x, y, r) => Math.min(
    ...avoid.map(([ax, ay, ar]) => Math.hypot(ax - x, ay - y) - ar - r),
    ...placed.map(([ax, ay, ar]) => Math.hypot(ax - x, ay - y) - ar - r),
    x - r - MARGIN, page.width - MARGIN - x - r,
  );
  /** The first spot round (x, y) at growing distances that is clear; else the clearest. */
  const spotNear = (x, y, r, from) => {
    let best = null;
    for (let k = 0; k < 6; k++) {
      const dist = from + k * r * 0.7;
      for (let j = 0; j < 16; j++) {
        const t = (j / 16) * Math.PI * 2;
        const p = [x + Math.cos(t) * dist, y + Math.sin(t) * dist];
        const c = clearance(p[0], p[1], r);
        if (!best || c > best.c) best = { p, c };
      }
      if (best.c >= 2) break;
    }
    placed.push([best.p[0], best.p[1], r]);
    return best.p;
  };

  // Start and finish plates behind their lines, or the nearest clear spot
  // round the line when that is off the page or on the course.
  const plateFs = Math.round(Math.max(40, Math.min(64, size.badge * 1.15)));
  font(ctx, plateFs, 800);
  const top = MARGIN + HEADER;
  const bottom = page.height - MARGIN - FOOTER;
  const plateClear = (x, y, w, h) => {
    const n = Math.max(1, Math.ceil(w / h));
    let c = Math.min(y - h / 2 - top, bottom - y - h / 2);
    for (let k = 0; k < n; k++) c = Math.min(c, clearance(x - w / 2 + h / 2 + (k * (w - h)) / Math.max(1, n - 1), y, h / 2));
    return c;
  };
  for (const { t, kind, x: lx, y: ly } of terminalPlates(course.route, 1.2 + (plateFs * 0.8) / s)) {
    const text = PLATE_TEXT[kind];
    const w = ctx.measureText(text).width + plateFs;
    const h = plateFs * 1.5;
    let best = { p: [X(lx), Y(ly)], c: plateClear(X(lx), Y(ly), w, h) };
    for (let k = 1; k < 8 && best.c < 0; k++) {
      for (let j = 0; j < 16; j++) {
        const a = (j / 16) * Math.PI * 2;
        const p = [X(t.x) + Math.cos(a) * (h + k * h * 0.6), Y(t.y) + Math.sin(a) * (w / 2 + k * h * 0.6)];
        const c = plateClear(p[0], p[1], w, h);
        if (c > best.c) best = { p, c };
      }
    }
    const [x, y] = best.p;
    for (let k = 0; k < Math.ceil(w / h); k++) placed.push([x - w / 2 + h / 2 + (k * (w - h)) / Math.max(1, Math.ceil(w / h) - 1), y, h / 2]);
    // Corners rounded like the angle pills, so the labels read as one family.
    ctx.fillStyle = PLATE;
    ctx.lineWidth = 4;
    ctx.strokeStyle = INK;
    ctx.beginPath();
    ctx.roundRect(x - w / 2, y - h / 2, w, h, h * 0.2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = INK;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x, y + plateFs * 0.05);
  }

  // Pivot angles beside their cone: «360°».
  for (const pass of course.passes) {
    if (!pass.angle || pass.connector) continue;
    const c = byId.get(pass.cone);
    if (!c) continue;
    const text = `${pass.angle}°`;
    const fs = Math.round(size.badge * 0.95);
    font(ctx, fs, 800);
    const w = ctx.measureText(text).width + fs * 0.6;
    const [x, y] = spotNear(X(c.hx / 2), Y(c.hy / 2), w / 2, size.cone + w / 2 + 6);
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = RED;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.roundRect(x - w / 2, y - fs * 0.7, w, fs * 1.4, fs * 0.35);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = INK;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x, y + fs * 0.05);
  }

  // Element numbers at each element's entry, in its colour.
  for (const e of ridden(course)) {
    const shown = orderOf.get(e.id) + 1;
    const i = entries.get(e.id);
    const [px, py] = [X(ride.points[i][0]), Y(ride.points[i][1])];
    const r = size.badge;
    const [x, y] = spotNear(px, py, r, r + size.line);
    const colour = colourOf(e.id);
    // A short tick from the badge to the entry, so it is clear which line it names.
    ctx.lineCap = 'round';
    ctx.lineWidth = Math.max(3, size.line * 0.35);
    ctx.strokeStyle = colour;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(px, py);
    ctx.stroke();
    ctx.fillStyle = colour;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = Math.max(4, r * 0.12);
    ctx.strokeStyle = '#fff';
    ctx.stroke();
    font(ctx, Math.round(r * (shown > 9 ? 1.0 : 1.2)), 800);
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(shown), x, y + r * 0.06);
  }

  return canvas;
}
