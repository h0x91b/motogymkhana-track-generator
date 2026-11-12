// Course renderer: canvas 2D with its own projection, after the prototype in
// docs/reference. Plan view = tilt 0; the 3D view tilts and rotates the same
// metric scene. Draws only when asked (no animation loop).

import { TYPE_NAMES } from '../generator/catalog.js';
import { anchorPoint, dist } from '../sheet/setup-sheet.js';
import { dimensionLayout, placeLabel, zoneCentre } from './dimension.js';
import { blockedOutlines, reservedZones } from './reserved.js';
import { blockedHandles } from './handles.js';
import { drawScaleBar, GRID_STEP } from './scale-bar.js';
import { boxArrows, terminalPlates } from './terminals.js';

const TAU = Math.PI * 2;
// Below this many pixels per metre only the selected element shows its dimensions.
const DIMENSIONS_FROM_SCALE = 16;
// Bike colours of the riders in a column, leader first.
const RIDER_COLORS = ['#ff9f1c', '#ff5d8f', '#a3e635'];

export const PALETTE = {
  red: '#ee624d',
  blue: '#4e9fe7',
  low: '#c3c9c6',
  route: '#6ae0d3',
  paint: '#e2e8df',
  slab: '#3c464c',
  side: '#687479',
  anchor: '#ffd166',
  select: '#d8f7ee',
  problem: '#ff8272',
  cutout: '#1e272d',
  obstacle: '#5c4b31',
};

const OBSTACLE_HEIGHT = 0.9; // metres an obstacle rises in 3D: a schematic block, not a measured height

// Reserved zones on the dark slab: thin and low-contrast, told apart by dash
// pattern (metres) and tone. Run-off: amber dots and tint; element zone: pale
// dashes; start / finish: pale fine dots; U-turn cone keep-out: short dashes in
// the cone's colour.
const ZONE_STYLE = {
  runOff: { stroke: '#f2c76e40', fill: '#f2c76e0d', width: 0.05, dash: [0.15, 0.45] },
  zone: { stroke: '#e2e8df4d', width: 0.05, dash: [0.5, 0.35] },
  terminal: { stroke: '#e2e8df59', width: 0.05, dash: [0.12, 0.28] },
  turnCone: { alpha: '80', width: 0.05, dash: [0.25, 0.2] },
};

export const VIEWS = {
  plan: { tilt: 0, yaw: 0 },
  angle: { tilt: (52 * Math.PI) / 180, yaw: -0.16 },
};

export function createCamera() {
  return { mode: 'plan', tilt: 0, yaw: 0, zoom: 1, panX: 0, panY: 0 };
}

export function resetCamera(cam, mode = cam.mode) {
  cam.mode = mode;
  cam.tilt = VIEWS[mode].tilt;
  cam.yaw = VIEWS[mode].yaw;
  cam.zoom = 1;
  cam.panX = 0;
  cam.panY = 0;
}

/** Projection for a canvas of W × H CSS px. Y is flipped here and only here. */
export function makeProjector(cam, W, H, site, focus = null) {
  const cx = site.width / 2;
  const cy = site.length / 2;
  const cosY = Math.cos(cam.yaw);
  const sinY = Math.sin(cam.yaw);
  const cosT = Math.cos(cam.tilt);
  const sinT = Math.sin(cam.tilt);
  const co = Math.abs(cosY);
  const si = Math.abs(sinY);
  const padX = 28;
  const padTop = 44;
  const padBottom = 90; // the row of ride, scale bar and zoom buttons, and the plates under the site
  const ew = site.width * co + site.length * si + 6;
  const eh = (site.width * si + site.length * co + 6) * cosT + 1.5 * sinT;
  const base = Math.min((W - 2 * padX) / ew, (H - padTop - padBottom) / eh);
  const scale = base * cam.zoom;
  // The whole site sits at the middle of the stage unless that would put it
  // under the bottom row; then it moves up just enough.
  const half = (eh * base) / 2;
  const midY = Math.max(padTop + half, Math.min(H / 2, H - padBottom - half));
  const project = (x, y, z = 0) => {
    const X = x - cx;
    const Y = y - cy;
    const u = X * cosY - Y * sinY;
    const w = X * sinY + Y * cosY;
    return { x: W / 2 + cam.panX + u * scale, y: midY + cam.panY - (w * cosT + z * sinT) * scale, d: -w * sinT + z * cosT };
  };
  /** The ground point (z = 0) under a canvas point: what a finger on the plan points at. */
  const unproject = (sx, sy) => {
    const u = (sx - W / 2 - cam.panX) / scale;
    const w = (midY + cam.panY - sy) / (scale * cosT);
    return [cx + u * cosY + w * sinY, cy - u * sinY + w * cosY];
  };
  return { project, unproject, scale, base, W, H, focus };
}

function shade(hex, k) {
  const h = hex.replace('#', '');
  return `#${[0, 2, 4].map((i) => Math.max(0, Math.min(255, Math.round(parseInt(h.slice(i, i + 2), 16) * k))).toString(16).padStart(2, '0')).join('')}`;
}

export function coneColors(course) {
  const colors = new Map();
  for (const p of course.passes) {
    if (p.kind === 'gate') {
      colors.set(p.left, 'blue');
      colors.set(p.right, 'red');
    } else if (p.kind === 'cone') colors.set(p.cone, p.side === 'left' ? 'blue' : 'red');
  }
  return colors;
}

/**
 * Draws the course. Returns hit targets for taps: element labels and zones in
 * screen coordinates.
 *
 * `problems` marks what an edited course has wrong — `{elements: Set of ids,
 * connectors: Set of connector numbers}` — in red, with a «!» on the label.
 * `editing` keeps every element at full strength round the selected one: it is
 * being moved among them, not read on its own.
 */
export function drawScene(ctx, course, cam, W, H, { selected = null, sheet = null, riders = [], zones = true, problems = null, editing = false } = {}) {
  const site = course ? course.site : { width: 40, length: 60 };
  const view = makeProjector(cam, W, H, site);
  const { project, scale } = view;
  const tilted = cam.tilt > 0.01;
  const hits = [];

  const path = (points, stroke, width = 0.09, fill = null, close = false, dash = null) => {
    if (!points.length) return;
    ctx.beginPath();
    points.forEach((p, i) => {
      const q = project(p[0], p[1], p[2] || 0);
      if (i) ctx.lineTo(q.x, q.y);
      else ctx.moveTo(q.x, q.y);
    });
    if (close) ctx.closePath();
    if (fill) {
      ctx.fillStyle = fill;
      ctx.fill();
    }
    if (stroke) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = Math.max(0.8, width * scale);
      ctx.setLineDash(dash ? dash.map((v) => Math.max(2, v * scale)) : []);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  };
  const plate = (text, x, y, { size = 11, fill = '#edf2ed', bg = '#2e3a42', z = 0, dx = 0, dy = 0, hit = null } = {}) => {
    const p = project(x, y, z);
    ctx.font = `600 ${size}px system-ui, -apple-system, sans-serif`;
    const w = ctx.measureText(text).width;
    const px = p.x + dx;
    const py = p.y + dy;
    if (bg) {
      ctx.fillStyle = bg;
      ctx.beginPath();
      ctx.roundRect(px - w / 2 - 7, py - size / 2 - 5, w + 14, size + 10, 5);
      ctx.fill();
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = fill;
    ctx.fillText(text, px, py);
    if (hit) hits.push({ kind: 'label', element: hit, x: px, y: py, w: Math.max(44, w + 14), h: Math.max(44, size + 10) });
  };
  const onGround = (text, x, y, size, fill, angle = 0) => {
    const p = project(x, y, 0.02);
    const u = project(x + Math.cos(angle), y + Math.sin(angle), 0.02);
    const v = project(x - Math.sin(angle), y + Math.cos(angle), 0.02);
    ctx.save();
    // Ground text: the metre basis vectors, with screen-Y already flipped.
    ctx.transform(u.x - p.x, u.y - p.y, -(v.x - p.x), -(v.y - p.y), p.x, p.y);
    ctx.font = `600 ${size}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = fill;
    ctx.fillText(text, 0, 0);
    ctx.restore();
  };

  /** Clips to a ground polygon (metres) for `draw`. */
  const clipped = (poly, draw) => {
    ctx.save();
    ctx.beginPath();
    poly.forEach(([x, y], i) => {
      const q = project(x, y, 0);
      if (i) ctx.lineTo(q.x, q.y);
      else ctx.moveTo(q.x, q.y);
    });
    ctx.closePath();
    ctx.clip();
    draw();
    ctx.restore();
  };
  /**
   * Cutouts and obstacles: hatched, so they read as «not here» at a glance. A
   * cutout is a hole in the slab, darker than the asphalt; an obstacle stands
   * on it, and in 3D rises as a low block. The margin round each (its own, else
   * the edge's) is a reserved zone, drawn like an element's and with them
   * (`zones`), kept on the slab.
   */
  function drawBlocked(list) {
    const slab = [[0, 0], [SW, 0], [SW, SL], [0, SL]];
    const st = ZONE_STYLE.zone;
    for (const b of zones ? list : []) {
      if (b.margin) clipped(slab, () => path(b.margin.map(([x, y]) => [x, y, 0.004]), st.stroke, st.width, null, true, st.dash));
    }
    for (const b of list) {
      const cut = b.kind === 'cutout';
      const z = cut ? 0.001 : 0.006;
      path(b.poly.map(([x, y]) => [x, y, z]), null, 0, cut ? PALETTE.cutout : PALETTE.obstacle, true);
      clipped(b.poly, () => {
        const step = 0.8;
        for (let t = -b.h; t < b.w + b.h; t += step) path([[b.x + t, b.y, z], [b.x + t + b.h, b.y + b.h, z]], cut ? '#ffffff1f' : '#f6c16a55', 0.07);
      });
      path(b.poly.map(([x, y]) => [x, y, z]), cut ? '#ffffff38' : '#f6c16acc', 0.08, null, true);
      if (tilted && !cut) {
        // A low block in 3D: the obstacle is something standing there.
        const H3 = OBSTACLE_HEIGHT;
        const top = b.poly.map(([x, y]) => [x, y, H3]);
        const faces = b.poly.map((p, i) => {
          const q = b.poly[(i + 1) % 4];
          return [[p[0], p[1], 0], [q[0], q[1], 0], [q[0], q[1], H3], [p[0], p[1], H3]];
        });
        const depth = (f) => f.reduce((a, p) => a + project(...p).d, 0);
        faces.sort((a, c) => depth(a) - depth(c)).forEach((f) => path(f, '#f6c16a88', 0.04, '#6b5534ee', true));
        path(top, '#f6c16acc', 0.05, '#7d6640f2', true);
      }
      if (editing) hits.push({ kind: 'blocked', element: `b${b.n}`, poly: b.poly.map(([x, y]) => project(x, y, 0)) });
      const sel = editing && selected === `b${b.n}`;
      if (sel) path(b.poly.map(([x, y]) => [x, y, z + 0.002]), PALETTE.select, 0.14, null, true);
    }
  }

  ctx.clearRect(0, 0, W, H);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // Slab: shadow, sides (3D only), surface, grid, margin line.
  const { width: SW, length: SL } = site;
  if (tilted) {
    path([[0.7, -0.6, -0.5], [SW + 0.7, -0.6, -0.5], [SW + 0.7, SL - 0.6, -0.5], [0.7, SL - 0.6, -0.5]], null, 0, '#14232f22', true);
    const sides = [
      [[0, 0, 0], [SW, 0, 0], [SW, 0, -0.4], [0, 0, -0.4]],
      [[SW, 0, 0], [SW, SL, 0], [SW, SL, -0.4], [SW, 0, -0.4]],
      [[SW, SL, 0], [0, SL, 0], [0, SL, -0.4], [SW, SL, -0.4]],
      [[0, SL, 0], [0, 0, 0], [0, 0, -0.4], [0, SL, -0.4]],
    ];
    const depth = (s) => s.reduce((a, p) => a + project(...p).d, 0);
    sides.sort((a, b) => depth(a) - depth(b)).forEach((s) => path(s, null, 0, PALETTE.side, true));
  }
  path([[0, 0], [SW, 0], [SW, SL], [0, SL]], null, 0, PALETTE.slab, true);
  for (let x = GRID_STEP; x < SW; x += GRID_STEP) path([[x, 0, 0.002], [x, SL, 0.002]], '#ffffff24', 0.05);
  for (let y = GRID_STEP; y < SL; y += GRID_STEP) path([[0, y, 0.002], [SW, y, 0.002]], '#ffffff24', 0.05);
  const m = course ? course.site.margin : 1;
  path([[m, m, 0.004], [SW - m, m, 0.004], [SW - m, SL - m, 0.004], [m, SL - m, 0.004]], '#bac7c355', 0.06, null, true, [0.4, 0.4]);
  const blocked = course ? blockedOutlines(course) : [];
  drawBlocked(blocked);
  onGround('h0x91B', SW - 2.2, SL - 0.55, 0.42, '#98a9aa');

  // Reference corner A (0,0) with its axes, and the site size.
  path([[0, 0, 0.01], [3, 0, 0.01]], '#ffd166', 0.09);
  path([[0, 0, 0.01], [0, 3, 0.01]], '#ffd166', 0.09);
  path([[3, -0.35, 0.01], [3.7, 0, 0.01], [3, 0.35, 0.01]], null, 0, '#ffd166', true);
  path([[-0.35, 3, 0.01], [0, 3.7, 0.01], [0.35, 3, 0.01]], null, 0, '#ffd166', true);
  plate('X', 4.6, 0, { size: 10, bg: null, fill: '#ffd166' });
  plate('Y', 0, 4.6, { size: 10, bg: null, fill: '#ffd166' });
  plate('A (0,0)', 0, 0, { size: 10, dy: 16, dx: -6, bg: '#4a3d12', fill: '#ffe7a3' });
  plate(`${SW} м`, SW / 2, 0, { size: 11, dy: 18, bg: '#3c484f', fill: '#e7eeef' });
  plate(`${SL} м`, 0, SL / 2, { size: 11, dx: -22, bg: '#3c484f', fill: '#e7eeef' });

  // Scale bar at the bottom, between the corner buttons. The projection is
  // orthographic, so a horizontal screen length is the same ground distance in
  // the plan and the 3D view.
  const scaleBar = () =>
    drawScaleBar(ctx, W / 2, H - 30, scale, {
      maxWidth: Math.max(50, Math.min(150, W - 250)), minSegment: 24, height: 6, fontSize: 11,
      ink: '#1f2a31', paper: '#f4f7f5', text: '#1f2a31', halo: '#f4f7f5cc',
    });

  if (!course) {
    scaleBar();
    return { hits, view };
  }

  const colors = coneColors(course);
  const byId = new Map(course.cones.map((c) => [c.id, c]));
  const elementOf = new Map();
  for (const e of course.elements) for (const id of e.cones) elementOf.set(id, e.id);

  // Reserved zones: what the generator keeps free round each thing, as quiet
  // outlines on the ground under everything else. Run-off zones of turning
  // elements keep their faint tint (they are on the plan with the layer off too).
  for (const z of reservedZones(course)) {
    if (z.kind !== 'runOff' && !zones) continue;
    const s = ZONE_STYLE[z.kind];
    const stroke = z.kind === 'turnCone' ? `${PALETTE[z.color]}${s.alpha}` : s.stroke;
    path(z.poly.map(([x, y]) => [x, y, 0.003]), stroke, s.width, s.fill ?? null, true, s.dash);
  }

  // Selected element, or the one being ridden: soft fill of its zone.
  for (const e of course.elements) {
    const poly = e.zone.map(([x, y]) => project(x, y, 0.005));
    hits.push({ kind: 'zone', element: e.id, poly });
    const wrong = problems?.elements.has(e.id);
    if (wrong) path(e.zone.map(([x, y]) => [x, y, 0.005]), PALETTE.problem, 0.1, `${PALETTE.problem}2e`, true);
    if (e.id === selected || riders.some((r) => r.element === e.id)) path(e.zone.map(([x, y]) => [x, y, 0.006]), wrong ? null : '#d8f7ee99', 0.06, '#8bd5bd26', true);
    // The element being edited: a firm outline, so it reads as the thing a finger moves.
    if (editing && e.id === selected) path(e.zone.map(([x, y]) => [x, y, 0.007]), wrong ? PALETTE.problem : PALETTE.select, 0.12, null, true);
  }

  // Walls between low cones (closed sides of boxes and U-turns, corridors) are
  // guides, not marked on the asphalt; a mirror's chalk line is painted.
  for (const e of course.elements) {
    for (const line of e.lines ?? []) {
      const pts = line.cones.map((id) => [byId.get(id).hx / 2, byId.get(id).hy / 2, 0.008]);
      if (line.kind === 'chalk') path(pts, PALETTE.paint, 0.18);
      else path(pts, '#b8c6c0aa', 0.06, null, false, [0.25, 0.3]);
    }
  }

  // A finish by the start: the start-and-finish box, its sides through its four cones.
  if (course.route.shape === 'return') {
    const pts = course.route.start.cones.map((id) => [byId.get(id).hx / 2, byId.get(id).hy / 2, 0.01]);
    path(pts, '#edf0dfcc', 0.07, null, true, [0.4, 0.3]);
  }

  // Start / finish lines: a chequered band between the two low cones.
  const PLATE_TEXT = { start: 'СТАРТ', finish: 'ФИНИШ', both: 'СТАРТ · ФИНИШ' };
  for (const { t, kind, x: lx, y: ly } of terminalPlates(course.route, 1.6)) {
    const [a, b] = t.cones.slice(0, 2).map((id) => [byId.get(id).hx / 2, byId.get(id).hy / 2]);
    const ux = Math.cos((t.dir * Math.PI) / 4);
    const uy = Math.sin((t.dir * Math.PI) / 4);
    const n = 10;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < 2; j++) {
        const s0 = i / n;
        const s1 = (i + 1) / n;
        const o0 = (j - 1) * 0.3;
        const o1 = j * 0.3;
        const pt = (s, o) => [a[0] + (b[0] - a[0]) * s + ux * o, a[1] + (b[1] - a[1]) * s + uy * o, 0.012];
        path([pt(s0, o0), pt(s1, o0), pt(s1, o1), pt(s0, o1)], null, 0, (i + j) % 2 ? '#253239' : '#edf0df', true);
      }
    }
    plate(PLATE_TEXT[kind], lx, ly, { size: 11, bg: '#2e3a42' });
  }

  // Route: element trajectories solid, connectors dashed, arrows every 5 m.
  const arrow = (x, y, a, alpha, color = PALETTE.route) => {
    ctx.globalAlpha = alpha;
    const c = Math.cos(a);
    const s = Math.sin(a);
    const k = Math.max(1, 5 / (0.4 * scale));
    path([[x + c * 0.38 * k, y + s * 0.38 * k, 0.04], [x - c * 0.27 * k + s * 0.23 * k, y - s * 0.27 * k - c * 0.23 * k, 0.04], [x - c * 0.27 * k - s * 0.23 * k, y - s * 0.27 * k + c * 0.23 * k, 0.04]], null, 0, color, true);
    ctx.globalAlpha = 1;
  };
  const elements = new Map(course.elements.map((e) => [e.id, e]));
  let connectors = 0;
  course.route.legs.forEach((leg) => {
    const connector = leg.kind === 'connector';
    const pts = connector ? leg.path : elements.get(leg.element).path;
    const owner = connector ? null : leg.element;
    // Connectors are numbered from 0, the one from the start.
    const wrong = connector && problems?.connectors.has(connectors++);
    const alpha = selected && !editing && owner !== selected ? 0.28 : 1;
    ctx.globalAlpha = alpha;
    path(pts.map(([x, y]) => [x, y, 0.03]), wrong ? PALETTE.problem : PALETTE.route, connector ? (wrong ? 0.16 : 0.1) : 0.14, null, false, connector ? [0.35, 0.35] : null);
    ctx.globalAlpha = 1;
    let total = 0;
    let next = 2.5;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      while (total + len >= next) {
        const f = (next - total) / len;
        arrow(a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, Math.atan2(b[1] - a[1], b[0] - a[0]), alpha, wrong ? PALETTE.problem : PALETTE.route);
        next += 5;
      }
      total += len;
    }
  });

  // Out of the start-and-finish box and back into it.
  for (const { x, y, a } of boxArrows(course.route)) arrow(x, y, a, 1, PALETTE.anchor);

  // Anchors: a ring on the ground around each element's anchor cone (a ring
  // element's centre, as the setup sheet measures it).
  for (const e of course.elements) {
    const c = anchorPoint(e, byId);
    const ring = [];
    for (let i = 0; i <= 40; i++) ring.push([c.x + 0.55 * Math.cos((i * TAU) / 40), c.y + 0.55 * Math.sin((i * TAU) / 40), 0.015]);
    path(ring, PALETTE.anchor, e.id === selected ? 0.09 : 0.06);
  }

  // Dimension lines between cone centres: for the selected or ridden element,
  // and for every element once zoomed in far enough to read them (not while
  // riding, when they would only flicker past).
  const shown = (id) => id === selected || riders.some((r) => r.element === id) || (!riders.length && scale >= DIMENSIONS_FROM_SCALE);
  const dimensions = (sheet?.cards ?? [])
    .filter((card) => shown(card.element))
    .flatMap((card) => card.dims.map((d) => ({ d, layout: dimensionLayout(d, zoneCentre(elements.get(card.element).zone)) })));
  const onSlab = (p) => [p[0], p[1], 0.012];
  for (const { layout } of dimensions) {
    path(layout.line.map(onSlab), '#d5dee0', 0.04);
    for (const seg of [...layout.extensions, ...layout.ticks]) path(seg.map(onSlab), '#d5dee0', 0.03);
  }

  // From the previous anchor to this one, for the selected or ridden element:
  // an L along X, then along Y, each leg labelled with its signed length. Not
  // while editing: the element is being put somewhere, not found with a tape.
  const chains = (sheet?.cards ?? [])
    .filter((card) => !editing && card.fromPrevious && (card.element === selected || riders.some((r) => r.element === card.element)))
    .flatMap((card) => {
      const { from, dx, dy } = card.fromPrevious;
      const p = sheet.cards.find((c) => c.number === from).anchor;
      const q = card.anchor;
      const signed = (v) => (v > 0 ? `+${dist(v)}` : `−${dist(-v)}`);
      const legs = [];
      // Labels go to the outside of the L, away from the other leg.
      if (dx) legs.push({ a: [p.x, p.y], b: [q.x, p.y], label: `X ${signed(dx)} м`, normal: [0, dy > 0 ? -1 : 1] });
      if (dy) legs.push({ a: [q.x, p.y], b: [q.x, q.y], label: `Y ${signed(dy)} м`, normal: [dx < 0 ? -1 : 1, 0] });
      return legs;
    });
  for (const { a, b, normal } of chains) {
    path([a, b].map(onSlab), PALETTE.anchor, 0.05, null, false, [0.35, 0.25]);
    for (const end of [a, b]) {
      const t = [normal[0] * 0.25, normal[1] * 0.25];
      path([[end[0] - t[0], end[1] - t[1]], [end[0] + t[0], end[1] + t[1]]].map(onSlab), PALETTE.anchor, 0.05);
    }
  }

  // Cones, far to near.
  const exaggerate = Math.min(3, Math.max(1, 4.5 / (0.2 * scale)));
  const sorted = [...course.cones].sort((a, b) => project(a.hx / 2, a.hy / 2).d - project(b.hx / 2, b.hy / 2).d);
  // Riders go into the same far-to-near order as the cones.
  const queue = riders.map((r) => ({ r, d: project(r.x, r.y).d })).sort((a, b) => a.d - b.d);
  for (const cone of sorted) {
    const d = project(cone.hx / 2, cone.hy / 2).d;
    while (queue.length && queue[0].d < d) drawRider(queue.shift().r, exaggerate);
    const color = cone.height === 'tall' ? PALETTE[colors.get(cone.id)] : PALETTE.low;
    const dim = selected && !editing && elementOf.get(cone.id) !== selected;
    ctx.globalAlpha = dim ? 0.5 : 1;
    drawCone(cone, color, tilted, exaggerate);
    ctx.globalAlpha = 1;
  }

  function drawCone(cone, color, solid, k) {
    const x = cone.hx / 2;
    const y = cone.hy / 2;
    const tall = cone.height === 'tall';
    const h = (tall ? 0.45 : 0.25) * k;
    const r = (tall ? 0.13 : 0.11) * k;
    const base = (tall ? 0.17 : 0.14) * k;
    if (!solid) {
      // From above: square base, coloured disc, light band, tip.
      path([[x - base, y - base], [x + base, y - base], [x + base, y + base], [x - base, y + base]], null, 0, '#20292e', true);
      const disc = (rr, fill) => {
        const pts = [];
        for (let i = 0; i < 16; i++) pts.push([x + rr * Math.cos((i * TAU) / 16), y + rr * Math.sin((i * TAU) / 16)]);
        path(pts, null, 0, fill, true);
      };
      disc(r, color);
      if (tall) disc(r * 0.62, '#f0f0df');
      disc(r * (tall ? 0.42 : 0.4), shade(color, 1.08));
      if (tall && r * scale >= 7) {
        const side = colors.get(cone.id) === 'blue' ? 'Л' : 'П';
        plate(side, x, y, { size: Math.min(13, r * scale * 0.9), bg: null, fill: '#17232a' });
      }
      return;
    }
    path([[x - 0.25 * k, y, 0.018], [x + 0.24 * k, y - 0.15 * k, 0.018], [x + 0.9 * k, y + 0.8 * k, 0.018], [x + 0.55 * k, y + 0.95 * k, 0.018]], null, 0, '#17232a40', true);
    const faces = [{ p: [[x - base, y - base, 0.03], [x + base, y - base, 0.03], [x + base, y + base, 0.03], [x - base, y + base, 0.03]], c: '#252e33' }];
    const rings = [[0.03, r], [h * 0.43, r * 0.63], [h * 0.62, r * 0.44], [h, r * 0.1]];
    const N = 12;
    for (let j = 0; j < rings.length - 1; j++) {
      for (let i = 0; i < N; i++) {
        const a0 = (i / N) * TAU;
        const a1 = ((i + 1) / N) * TAU;
        const p = [
          [x + Math.cos(a0) * rings[j][1], y + Math.sin(a0) * rings[j][1], rings[j][0]],
          [x + Math.cos(a1) * rings[j][1], y + Math.sin(a1) * rings[j][1], rings[j][0]],
          [x + Math.cos(a1) * rings[j + 1][1], y + Math.sin(a1) * rings[j + 1][1], rings[j + 1][0]],
          [x + Math.cos(a0) * rings[j + 1][1], y + Math.sin(a0) * rings[j + 1][1], rings[j + 1][0]],
        ];
        const lit = 0.69 + 0.29 * (0.5 + 0.5 * Math.cos(a0 - 3.5));
        faces.push({ p, c: shade(j === 1 && tall ? '#f0f0df' : color, lit) });
      }
    }
    for (const f of faces) f.d = f.p.reduce((s, p) => s + project(...p).d, 0) / f.p.length;
    faces.sort((a, b) => a.d - b.d).forEach((f) => path(f.p, null, 0, f.c, true));
  }
  while (queue.length) drawRider(queue.shift().r, exaggerate);

  /**
   * Schematic motorcycle with rider, in metres along (forward, left, up) of the
   * bike, leaning into the turn about its forward axis.
   */
  function drawRider(r, k) {
    const body = RIDER_COLORS[(r.rider ?? 0) % RIDER_COLORS.length];
    const ux = Math.cos(r.heading);
    const uy = Math.sin(r.heading);
    const cl = Math.cos(r.lean);
    const sl = Math.sin(r.lean);
    const at = (f, l, h) => {
      const left = (l * cl + h * sl) * k;
      return [r.x + ux * f * k - uy * left, r.y + uy * f * k + ux * left, (-l * sl + h * cl) * k];
    };
    const ground = (f, l) => [r.x + (ux * f - uy * l) * k, r.y + (uy * f + ux * l) * k, 0.02];
    const ring = (n, fn) => Array.from({ length: n }, (_, i) => fn((i / n) * TAU));
    path(ring(16, (t) => ground(1.05 * Math.cos(t), 0.38 * Math.sin(t))), null, 0, '#0b111466', true);
    const wheel = (f) => path(ring(16, (t) => at(f + 0.32 * Math.cos(t), 0, 0.32 + 0.32 * Math.sin(t))), '#0b0f11', 0.04, '#1b2226', true);
    const rear = project(...at(-0.68, 0, 0.32)).d;
    const front = project(...at(0.68, 0, 0.32)).d;
    const [far, near] = rear < front ? [-0.68, 0.68] : [0.68, -0.68];
    wheel(far);
    path([at(-0.68, 0, 0.32), at(-0.3, 0, 0.74), at(0.25, 0, 0.8), at(0.52, 0, 0.92), at(0.68, 0, 0.32)], body, 0.16);
    path([at(0.45, 0.3, 0.98), at(0.45, -0.3, 0.98)], '#11181c', 0.05);
    path([at(-0.25, 0, 0.86), at(0.08, 0, 1.38)], '#eef2f3', 0.24);
    path([at(0.08, 0.16, 1.32), at(0.45, 0.3, 0.98)], '#eef2f3', 0.08);
    path([at(0.08, -0.16, 1.32), at(0.45, -0.3, 0.98)], '#eef2f3', 0.08);
    wheel(near);
    const head = project(...at(0.14, 0, 1.6));
    ctx.beginPath();
    ctx.arc(head.x, head.y, Math.max(2.5, 0.15 * k * scale), 0, TAU);
    ctx.fillStyle = '#ffd166';
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = '#3b2f0b';
    ctx.stroke();
  }

  // Labels. Element numbers (full names when zoomed in or selected) and the
  // selected anchor claim their place first; dimension labels keep clear of
  // them and of the cones.
  const plateBox = (text, x, y, size, z, dy = 0) => {
    const p = project(x, y, z);
    ctx.font = `600 ${size}px system-ui, -apple-system, sans-serif`;
    const w = ctx.measureText(text).width;
    return [p.x - w / 2 - 7, p.y + dy - size / 2 - 5, p.x + w / 2 + 7, p.y + dy + size / 2 + 5];
  };
  const labels = [];
  // Cutouts and obstacles by name; the selected one in «Правка» with its measurements from A (0,0).
  for (const b of blocked) {
    const sel = editing && selected === `b${b.n}`;
    const text = sel ? `${b.name}: X ${b.x} · Y ${b.y}, ${b.w} × ${b.h} м` : b.name;
    // The selected one's plate sits clear of its far side, off the resize handles.
    const [ly, dy] = sel ? [b.y + b.h, -22] : [b.y + b.h / 2, 0];
    labels.push([text, b.x + b.w / 2, ly, { size: 11, z: tilted && b.kind === 'obstacle' ? OBSTACLE_HEIGHT : 0.02, dy, bg: '#3d3220', fill: '#f6d9a4', hit: editing ? `b${b.n}` : null, top: sel }]);
  }
  for (const e of course.elements) {
    const [cx, cy] = zoneCentre(e.zone);
    const wide = cam.zoom >= 1.6 || e.id === selected || W >= 700;
    // A problem is marked on the label too, not by the red alone.
    const wrong = problems?.elements.has(e.id);
    const text = `${wide ? `${e.order} ${TYPE_NAMES[e.type].toUpperCase()}` : String(e.order)}${wrong ? ' !' : ''}`;
    const sel = e.id === selected;
    const tone = wrong ? { bg: sel ? '#ffe2dd' : '#7c241ce6', fill: sel ? '#6b1710' : '#ffe9e5' } : { bg: sel ? '#ddf4ec' : '#293840e6', fill: sel ? '#213e36' : '#f0f3ee' };
    labels.push([text, cx, cy, { size: 13, z: 0.05, ...tone, hit: e.id, top: sel }]);
    if (sel) {
      // The anchor label goes on the side of the anchor away from the name, so they never overlap.
      const a = anchorPoint(e, byId);
      const below = project(a.x, a.y, 0).y >= project(cx, cy, 0.05).y;
      const m = (v) => String(v).replace('.', ',');
      labels.push([`якорь X ${m(a.x)} · Y ${m(a.y)}`, a.x, a.y, { size: 12, z: 0, dy: below ? 24 : -24, bg: '#4a3d12', fill: '#ffe7a3', top: true }]);
    }
  }
  const coneRadius = Math.max(6, 0.35 * scale);
  const taken = [
    ...course.cones.map((c) => {
      const p = project(c.hx / 2, c.hy / 2, 0);
      return [p.x - coneRadius, p.y - coneRadius, p.x + coneRadius, p.y + coneRadius];
    }),
    ...labels.map(([text, x, y, o]) => plateBox(text, x, y, o.size, o.z, o.dy)),
  ];
  for (const { d, layout } of dimensions) {
    const { spot, box } = placeLabel(layout, 24 / scale, (p) => plateBox(d.label, p[0], p[1], 12, 0.03), taken);
    taken.push(box);
    plate(d.label, spot[0], spot[1], { size: 12, z: 0.03, bg: '#3c484f', fill: '#e7eeef' });
  }
  for (const { a, b, label, normal } of chains) {
    const layout = { mid: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], normal };
    const { spot, box } = placeLabel(layout, 24 / scale, (p) => plateBox(label, p[0], p[1], 12, 0.03), taken);
    taken.push(box);
    plate(label, spot[0], spot[1], { size: 12, z: 0.03, bg: '#4a3d12', fill: '#ffe7a3' });
  }
  // The selected element's plates go on top: its name and anchor are what is being read.
  const onTop = (l) => l[3].top === true;
  for (const [text, x, y, o] of [...labels.filter((l) => !onTop(l)), ...labels.filter(onTop)]) plate(text, x, y, o);
  // The selected blocked area's resize handles, above everything: corners and side midpoints.
  const held = editing && blocked.find((b) => selected === `b${b.n}`);
  if (held) {
    for (const h of blockedHandles(`b${held.n}`, held, (x, y) => project(x, y, 0))) {
      hits.push(h);
      const r = h.sx && h.sy ? 5.5 : 4.5;
      ctx.fillStyle = PALETTE.select;
      ctx.strokeStyle = '#14232f';
      ctx.lineWidth = 2;
      ctx.fillRect(h.x - r, h.y - r, 2 * r, 2 * r);
      ctx.strokeRect(h.x - r, h.y - r, 2 * r, 2 * r);
    }
  }
  scaleBar();
  return { hits, view };
}

/** Element under a tap at (x, y) CSS px, or null. */
export function hitTest(hits, x, y) {
  // Plates drawn later lie on top, so they are asked first.
  for (let i = hits.length - 1; i >= 0; i--) {
    const h = hits[i];
    if (h.kind === 'label' && Math.abs(h.x - x) <= h.w / 2 && Math.abs(h.y - y) <= h.h / 2) return h.element;
  }
  for (const kind of ['zone', 'blocked']) for (const h of hits) {
    if (h.kind !== kind) continue;
    let inside = false;
    const p = h.poly;
    for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
      if ((p[i].y > y) !== (p[j].y > y) && x < ((p[j].x - p[i].x) * (y - p[i].y)) / (p[j].y - p[i].y) + p[i].x) inside = !inside;
    }
    if (inside) return h.element;
  }
  return null;
}

/** Camera zoom/pan that frames the given world bounds [x0, y0, x1, y1]. */
/** Pans so that the ground point (x, y) sits at the centre of the stage. */
export function centreOn(cam, W, H, site, x, y) {
  const p = makeProjector(cam, W, H, site).project(x, y, 0);
  cam.panX += W / 2 - p.x;
  cam.panY += H / 2 - p.y;
}

export function frameBounds(cam, W, H, site, bounds, { top = 60, bottom = 60, left = 0, right = 0 } = {}) {
  const base = makeProjector({ ...cam, zoom: 1, panX: 0, panY: 0 }, W, H, site);
  const w = Math.max(6, bounds[2] - bounds[0]);
  const h = Math.max(6, bounds[3] - bounds[1]);
  const zoom = Math.max(0.8, Math.min(4, Math.min((W - left - right - 60) / (w * base.scale), (H - top - bottom) / (h * base.scale * Math.max(0.4, Math.cos(cam.tilt))))));
  cam.zoom = zoom;
  cam.panX = 0;
  cam.panY = 0;
  const p = makeProjector(cam, W, H, site).project((bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2);
  cam.panX = left + (W - left - right) / 2 - p.x;
  cam.panY = top + (H - top - bottom) / 2 - p.y;
}
