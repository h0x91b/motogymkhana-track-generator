// Course renderer: canvas 2D with its own projection, after the prototype in
// docs/reference. Plan view = tilt 0; the 3D view tilts and rotates the same
// metric scene. Draws only when asked (no animation loop).

import { TYPE_NAMES } from '../generator/catalog.js';

const TAU = Math.PI * 2;

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
  const padY = 44;
  const ew = site.width * co + site.length * si + 6;
  const eh = (site.width * si + site.length * co + 6) * cosT + 1.5 * sinT;
  const base = Math.min((W - 2 * padX) / ew, (H - 2 * padY) / eh);
  const scale = base * cam.zoom;
  const project = (x, y, z = 0) => {
    const X = x - cx;
    const Y = y - cy;
    const u = X * cosY - Y * sinY;
    const w = X * sinY + Y * cosY;
    return { x: W / 2 + cam.panX + u * scale, y: H / 2 + cam.panY - (w * cosT + z * sinT) * scale, d: -w * sinT + z * cosT };
  };
  return { project, scale, base, W, H, focus };
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
    } else colors.set(p.cone, p.side === 'left' ? 'blue' : 'red');
  }
  return colors;
}

/**
 * Draws the course. Returns hit targets for taps: element labels and zones in
 * screen coordinates.
 */
export function drawScene(ctx, course, cam, W, H, { selected = null, showLabels = true } = {}) {
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

  ctx.clearRect(0, 0, W, H);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // Slab: shadow, sides (3D only), surface, faint 5 m grid, margin line.
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
  for (let x = 5; x < SW; x += 5) path([[x, 0, 0.002], [x, SL, 0.002]], '#ffffff10', 0.035);
  for (let y = 5; y < SL; y += 5) path([[0, y, 0.002], [SW, y, 0.002]], '#ffffff10', 0.035);
  const m = course ? course.site.margin : 1;
  path([[m, m, 0.004], [SW - m, m, 0.004], [SW - m, SL - m, 0.004], [m, SL - m, 0.004]], '#bac7c355', 0.06, null, true, [0.4, 0.4]);
  onGround('h0x91B', SW - 2.2, SL - 0.55, 0.42, '#98a9aa');

  // Reference corner A (0,0) with its axes, and the site size.
  path([[0, 0, 0.01], [3, 0, 0.01]], '#ffd166', 0.09);
  path([[0, 0, 0.01], [0, 3, 0.01]], '#ffd166', 0.09);
  path([[3, -0.35, 0.01], [3.7, 0, 0.01], [3, 0.35, 0.01]], null, 0, '#ffd166', true);
  path([[-0.35, 3, 0.01], [0, 3.7, 0.01], [0.35, 3, 0.01]], null, 0, '#ffd166', true);
  plate('X', 4.6, 0, { size: 10, bg: null, fill: '#ffd166' });
  plate('Y', 0, 4.6, { size: 10, bg: null, fill: '#ffd166' });
  plate('A (0,0)', 0, 0, { size: 10, dy: 16, dx: -6, bg: '#4a3d12', fill: '#ffe7a3' });
  if (showLabels) {
    plate(`${SW} м`, SW / 2, 0, { size: 10, dy: 18, bg: '#3c484f', fill: '#e7eeef' });
    plate(`${SL} м`, 0, SL / 2, { size: 10, dx: -22, bg: '#3c484f', fill: '#e7eeef' });
  }

  if (!course) return { hits, view };

  const colors = coneColors(course);
  const byId = new Map(course.cones.map((c) => [c.id, c]));
  const elementOf = new Map();
  for (const e of course.elements) for (const id of e.cones) elementOf.set(id, e.id);

  // Selected element: soft fill of its zone.
  for (const e of course.elements) {
    const poly = e.zone.map(([x, y]) => project(x, y, 0.005));
    hits.push({ kind: 'zone', element: e.id, poly });
    if (e.id === selected) path(e.zone.map(([x, y]) => [x, y, 0.005]), '#d8f7ee99', 0.06, '#8bd5bd26', true);
  }

  // Painted guides between the low corner cones of boxes and U-turn zones.
  for (const e of course.elements) {
    if (e.type !== 'box' && e.type !== 'u-turn') continue;
    const pts = e.cones.map((id) => [byId.get(id).hx / 2, byId.get(id).hy / 2, 0.008]);
    // Only the closed sides: a U-turn zone is open on its entry side (corners
    // 4–1), a box on its entry (4–1) and exit (1–2) sides.
    const closed = e.type === 'u-turn' ? pts : pts.slice(1);
    path(closed, '#b8c6c0aa', 0.06, null, false, [0.25, 0.3]);
  }

  // Start / finish lines: a chequered band between the two low cones.
  const terminals = course.route.closed ? [[course.route.start, 'СТАРТ · ФИНИШ']] : [[course.route.start, 'СТАРТ'], [course.route.finish, 'ФИНИШ']];
  for (const [t, label] of terminals) {
    const [a, b] = t.cones.map((id) => [byId.get(id).hx / 2, byId.get(id).hy / 2]);
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
    if (showLabels) plate(label, t.x - ux * 1.6, t.y - uy * 1.6, { size: 10, bg: '#2e3a42' });
  }

  // Route: element trajectories solid, connectors dashed, arrows every 5 m.
  const arrow = (x, y, a, alpha) => {
    ctx.globalAlpha = alpha;
    const c = Math.cos(a);
    const s = Math.sin(a);
    const k = Math.max(1, 5 / (0.4 * scale));
    path([[x + c * 0.38 * k, y + s * 0.38 * k, 0.04], [x - c * 0.27 * k + s * 0.23 * k, y - s * 0.27 * k - c * 0.23 * k, 0.04], [x - c * 0.27 * k - s * 0.23 * k, y - s * 0.27 * k + c * 0.23 * k, 0.04]], null, 0, PALETTE.route, true);
    ctx.globalAlpha = 1;
  };
  const elements = new Map(course.elements.map((e) => [e.id, e]));
  course.route.legs.forEach((leg) => {
    const connector = leg.kind === 'connector';
    const pts = connector ? leg.path : elements.get(leg.element).path;
    const owner = connector ? null : leg.element;
    const alpha = selected && owner !== selected ? 0.28 : 1;
    ctx.globalAlpha = alpha;
    path(pts.map(([x, y]) => [x, y, 0.03]), PALETTE.route, connector ? 0.1 : 0.14, null, false, connector ? [0.35, 0.35] : null);
    ctx.globalAlpha = 1;
    let total = 0;
    let next = 2.5;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      while (total + len >= next) {
        const f = (next - total) / len;
        arrow(a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, Math.atan2(b[1] - a[1], b[0] - a[0]), alpha);
        next += 5;
      }
      total += len;
    }
  });

  // Anchors: a ring on the ground around each element's anchor cone.
  for (const e of course.elements) {
    const c = byId.get(e.anchor);
    const ring = [];
    for (let i = 0; i <= 40; i++) ring.push([c.hx / 2 + 0.55 * Math.cos((i * TAU) / 40), c.hy / 2 + 0.55 * Math.sin((i * TAU) / 40), 0.015]);
    path(ring, PALETTE.anchor, e.id === selected ? 0.09 : 0.06);
  }

  // Cones, far to near.
  const exaggerate = Math.min(3, Math.max(1, 4.5 / (0.2 * scale)));
  const sorted = [...course.cones].sort((a, b) => project(a.hx / 2, a.hy / 2).d - project(b.hx / 2, b.hy / 2).d);
  for (const cone of sorted) {
    const color = cone.height === 'tall' ? PALETTE[colors.get(cone.id)] : PALETTE.low;
    const dim = selected && elementOf.get(cone.id) !== selected;
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

  // Element numbers in passing order; full names when zoomed in or selected.
  if (showLabels) {
    for (const e of course.elements) {
      const cx = (e.zone[0][0] + e.zone[2][0]) / 2;
      const cy = (e.zone[0][1] + e.zone[2][1]) / 2;
      const wide = cam.zoom >= 1.6 || e.id === selected || W >= 700;
      const text = wide ? `${e.order} ${TYPE_NAMES[e.type].toUpperCase()}` : String(e.order);
      const sel = e.id === selected;
      plate(text, cx, cy, { size: 12, z: 0.05, bg: sel ? '#ddf4ec' : '#293840e6', fill: sel ? '#213e36' : '#f0f3ee', hit: e.id });
      if (sel) {
        const a = byId.get(e.anchor);
        plate(`якорь X ${a.hx / 2} · Y ${a.hy / 2}`, a.hx / 2, a.hy / 2, { size: 11, dy: -22, bg: '#4a3d12', fill: '#ffe7a3' });
      }
    }
  }
  return { hits, view };
}

/** Element under a tap at (x, y) CSS px, or null. */
export function hitTest(hits, x, y) {
  for (const h of hits) {
    if (h.kind === 'label' && Math.abs(h.x - x) <= h.w / 2 && Math.abs(h.y - y) <= h.h / 2) return h.element;
  }
  for (const h of hits) {
    if (h.kind !== 'zone') continue;
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
export function frameBounds(cam, W, H, site, bounds) {
  const base = makeProjector({ ...cam, zoom: 1, panX: 0, panY: 0 }, W, H, site);
  const w = Math.max(6, bounds[2] - bounds[0]);
  const h = Math.max(6, bounds[3] - bounds[1]);
  const zoom = Math.max(0.8, Math.min(4, Math.min((W - 60) / (w * base.scale), (H - 120) / (h * base.scale * Math.max(0.4, Math.cos(cam.tilt))))));
  cam.zoom = zoom;
  cam.panX = 0;
  cam.panY = 0;
  const p = makeProjector(cam, W, H, site).project((bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2);
  cam.panX = W / 2 - p.x;
  cam.panY = H / 2 - p.y;
}
