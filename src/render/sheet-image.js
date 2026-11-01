// The setup-sheet pictures: a series of 9:16 portrait PNGs that together are
// enough to lay the course out without the app. 1080 × 1920 survives a
// messenger's downscaling (≈1600 px on the long side) with readable text; one
// tall picture does not. The first frame carries the plan, the rest the cards.
// Light background so it reads in a chat and on a black-and-white print: tall
// cones carry the letter of their side. No recipe, seed or hidden marks on it
// (SPEC, «Картинка схемы»).

import { fmt } from '../sheet/setup-sheet.js';
import { dimensionLayout, placeLabel, zoneCentre } from './dimension.js';
import { drawScaleBar, GRID_STEP } from './scale-bar.js';

const W = 1080;
const H = 1920;
const PAD = 40;
const INK = '#1f2a31';
const MUTED = '#5b6870';
const RULE = '#d5dcda';
const ROUTE = '#0f8b8d';
const BLUE = '#2b72c4';
const RED = '#cc4330';
const ANCHOR = '#b07d00';
const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

const font = (ctx, size, weight = 400) => {
  ctx.font = `${weight} ${size}px ${FONT}`;
};

function wrap(ctx, text, width) {
  const words = text.split(' ');
  const lines = [];
  let line = '';
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (ctx.measureText(next).width > width && line) {
      lines.push(line);
      line = w;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

function coneGlyph(ctx, x, y, cone, { anchor = false, r = 11 } = {}) {
  if (cone.height === 'tall') {
    ctx.fillStyle = cone.color === 'blue' ? BLUE : RED;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = INK;
    ctx.stroke();
    font(ctx, Math.round(r * 1.25), 700);
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(cone.color === 'blue' ? 'Л' : 'П', x, y + 1);
  } else {
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(x, y, r * 0.62, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = INK;
    ctx.stroke();
  }
  if (anchor) {
    ctx.beginPath();
    ctx.arc(x, y, r + 6, 0, Math.PI * 2);
    ctx.lineWidth = 3;
    ctx.strokeStyle = ANCHOR;
    ctx.stroke();
  }
}

function badge(ctx, x, y, text, r = 18) {
  ctx.fillStyle = INK;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  font(ctx, Math.round(r * 1.1), 700);
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y + 1);
}

function arrowHead(ctx, x, y, a, size, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x + Math.cos(a) * size, y + Math.sin(a) * size);
  ctx.lineTo(x + Math.cos(a + 2.5) * size * 0.8, y + Math.sin(a + 2.5) * size * 0.8);
  ctx.lineTo(x + Math.cos(a - 2.5) * size * 0.8, y + Math.sin(a - 2.5) * size * 0.8);
  ctx.closePath();
  ctx.fill();
}

/** Plan block no taller than maxHeight: returns its height and a draw(ctx, top) function. */
function planBlock(course, sheet, maxHeight) {
  const left = PAD + 64;
  const bottomSpace = 110; // site dimension line, then the scale bar
  const avail = W - left - PAD;
  const s = Math.min(avail / course.site.width, (maxHeight - bottomSpace - 30) / course.site.length);
  const pw = course.site.width * s;
  const ph = course.site.length * s;
  const ox = left + (avail - pw) / 2;
  const height = ph + bottomSpace + 30;
  const byId = new Map(course.cones.map((c) => [c.id, c]));
  const colorOf = new Map();
  for (const card of sheet.cards) {
    const e = course.elements.find((x) => x.id === card.element);
    e.cones.forEach((id, i) => colorOf.set(id, card.cones[i].color));
  }

  function draw(ctx, top) {
    const oy = top + 20;
    const X = (x) => ox + x * s;
    const Y = (y) => oy + ph - y * s;
    // Site, grid with measured ticks, margin.
    ctx.fillStyle = '#eef1ef';
    ctx.fillRect(ox, oy, pw, ph);
    // Lines every grid step; their distances every step, or every other one when they would crowd.
    const every = GRID_STEP * s >= 44 ? GRID_STEP : 2 * GRID_STEP;
    ctx.lineWidth = 1;
    ctx.strokeStyle = RULE;
    font(ctx, 18);
    ctx.fillStyle = MUTED;
    for (let x = 0; x <= course.site.width; x += GRID_STEP) {
      ctx.beginPath();
      ctx.moveTo(X(x), Y(0));
      ctx.lineTo(X(x), Y(course.site.length));
      ctx.stroke();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      if (x > 0 && x % every === 0) ctx.fillText(String(x), X(x), Y(0) + 6);
    }
    for (let y = 0; y <= course.site.length; y += GRID_STEP) {
      ctx.beginPath();
      ctx.moveTo(X(0), Y(y));
      ctx.lineTo(X(course.site.width), Y(y));
      ctx.stroke();
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      if (y > 0 && y % every === 0) ctx.fillText(String(y), X(0) - 8, Y(y));
    }
    ctx.setLineDash([8, 8]);
    ctx.strokeStyle = '#9aa7ad';
    const m = course.site.margin;
    ctx.strokeRect(X(m), Y(course.site.length - m), (course.site.width - 2 * m) * s, (course.site.length - 2 * m) * s);
    ctx.setLineDash([]);
    ctx.lineWidth = 3;
    ctx.strokeStyle = INK;
    ctx.strokeRect(ox, oy, pw, ph);

    // Site dimension lines.
    ctx.lineWidth = 2;
    ctx.strokeStyle = INK;
    const dimY = Y(0) + 44;
    ctx.beginPath();
    ctx.moveTo(X(0), dimY);
    ctx.lineTo(X(course.site.width), dimY);
    ctx.moveTo(X(0), dimY - 8);
    ctx.lineTo(X(0), dimY + 8);
    ctx.moveTo(X(course.site.width), dimY - 8);
    ctx.lineTo(X(course.site.width), dimY + 8);
    ctx.stroke();
    const dimX = X(0) - 52;
    ctx.beginPath();
    ctx.moveTo(dimX, Y(0));
    ctx.lineTo(dimX, Y(course.site.length));
    ctx.moveTo(dimX - 8, Y(0));
    ctx.lineTo(dimX + 8, Y(0));
    ctx.moveTo(dimX - 8, Y(course.site.length));
    ctx.lineTo(dimX + 8, Y(course.site.length));
    ctx.stroke();
    font(ctx, 22, 700);
    const label = (text, x, y, rot = 0) => {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(rot);
      const w = ctx.measureText(text).width;
      ctx.fillStyle = '#fff';
      ctx.fillRect(-w / 2 - 8, -14, w + 16, 28);
      ctx.fillStyle = INK;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, 0, 1);
      ctx.restore();
    };
    label(`ширина ${course.site.width} м`, (X(0) + X(course.site.width)) / 2, dimY);
    label(`длина ${course.site.length} м`, dimX, (Y(0) + Y(course.site.length)) / 2, -Math.PI / 2);
    drawScaleBar(ctx, (X(0) + X(course.site.width)) / 2, Y(0) + 92, s, {
      maxWidth: 280, minSegment: 60, height: 12, fontSize: 20, ink: INK, paper: '#fff', text: INK,
    });

    // Closed sides of boxes and U-turn zones: not marked on the asphalt, drawn
    // dotted so they cannot be mistaken for a connector without colour.
    ctx.setLineDash([2, 6]);
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#8d9a9f';
    for (const e of course.elements) {
      if (e.type !== 'box' && e.type !== 'u-turn') continue;
      const pts = e.cones.map((id) => byId.get(id));
      const closed = e.type === 'u-turn' ? pts : pts.slice(1);
      ctx.beginPath();
      closed.forEach((c, i) => (i ? ctx.lineTo(X(c.hx / 2), Y(c.hy / 2)) : ctx.moveTo(X(c.hx / 2), Y(c.hy / 2))));
      ctx.stroke();
    }
    ctx.setLineDash([]);

    // Route.
    const elements = new Map(course.elements.map((e) => [e.id, e]));
    for (const leg of course.route.legs) {
      const connector = leg.kind === 'connector';
      const pts = connector ? leg.path : elements.get(leg.element).path;
      ctx.beginPath();
      pts.forEach(([x, y], i) => (i ? ctx.lineTo(X(x), Y(y)) : ctx.moveTo(X(x), Y(y))));
      ctx.lineWidth = connector ? 3 : 4;
      ctx.strokeStyle = ROUTE;
      ctx.setLineDash(connector ? [10, 8] : []);
      ctx.stroke();
      ctx.setLineDash([]);
      let total = 0;
      let next = 3;
      for (let i = 1; i < pts.length; i++) {
        const [ax, ay] = pts[i - 1];
        const [bx, by] = pts[i];
        const len = Math.hypot(bx - ax, by - ay);
        while (total + len >= next) {
          const f = (next - total) / len;
          arrowHead(ctx, X(ax + (bx - ax) * f), Y(ay + (by - ay) * f), Math.atan2(-(by - ay), bx - ax), 11, ROUTE);
          next += 6;
        }
        total += len;
      }
    }

    // Start / finish lines.
    const terms = course.route.closed ? [[course.route.start, 'СТАРТ / ФИНИШ']] : [[course.route.start, 'СТАРТ'], [course.route.finish, 'ФИНИШ']];
    for (const [t, text] of terms) {
      const [a, b] = t.cones.map((id) => byId.get(id));
      ctx.lineWidth = 6;
      ctx.strokeStyle = INK;
      ctx.setLineDash([6, 6]);
      ctx.beginPath();
      ctx.moveTo(X(a.hx / 2), Y(a.hy / 2));
      ctx.lineTo(X(b.hx / 2), Y(b.hy / 2));
      ctx.stroke();
      ctx.setLineDash([]);
      const ux = Math.cos((t.dir * Math.PI) / 4);
      const uy = Math.sin((t.dir * Math.PI) / 4);
      font(ctx, 20, 700);
      const tx = X(t.x - ux * 2);
      const ty = Y(t.y - uy * 2);
      const w = ctx.measureText(text).width;
      ctx.fillStyle = INK;
      ctx.beginPath();
      ctx.roundRect(tx - w / 2 - 8, ty - 15, w + 16, 30, 6);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, tx, ty + 1);
    }

    // Dimension lines between cone centres, when the plan is large enough to read them.
    const dimensions = s < 10 ? [] : sheet.cards.flatMap((card) =>
      card.dims.map((d) => ({ d, layout: dimensionLayout(d, zoneCentre(elements.get(card.element).zone)) })));
    ctx.strokeStyle = MUTED;
    for (const { layout } of dimensions) {
      for (const [seg, width] of [[layout.line, 2], ...layout.extensions.map((e) => [e, 1.2]), ...layout.ticks.map((t) => [t, 2])]) {
        ctx.lineWidth = width;
        ctx.beginPath();
        ctx.moveTo(X(seg[0][0]), Y(seg[0][1]));
        ctx.lineTo(X(seg[1][0]), Y(seg[1][1]));
        ctx.stroke();
      }
    }

    // Cones (anchors ringed).
    const anchors = new Set(course.elements.map((e) => e.anchor));
    const r = Math.max(8, Math.min(12, s * 0.45));
    for (const c of course.cones) {
      coneGlyph(ctx, X(c.hx / 2), Y(c.hy / 2), { height: c.height, color: colorOf.get(c.id) ?? 'neutral' }, { anchor: anchors.has(c.id), r });
    }

    // Element numbers: the zone point nearest its centre that keeps clear of
    // every cone and of the element's own trajectory.
    // Dimension labels keep clear of the cones and of each other; element
    // numbers keep clear of all of them.
    font(ctx, 16, 700);
    const taken = course.cones.map((c) => [X(c.hx / 2) - r - 3, Y(c.hy / 2) - r - 3, X(c.hx / 2) + r + 3, Y(c.hy / 2) + r + 3]);
    for (const dim of dimensions) {
      const w = ctx.measureText(dim.d.label).width;
      const boxAt = ([x, y]) => [X(x) - w / 2 - 5, Y(y) - 11, X(x) + w / 2 + 5, Y(y) + 11];
      const { spot, box } = placeLabel(dim.layout, 24 / s, boxAt, taken);
      taken.push(box);
      dim.spot = spot;
    }
    for (const { d, spot } of dimensions) {
      const w = ctx.measureText(d.label).width;
      // A label beside the site edge stays inside the picture.
      const mx = Math.min(W - 8 - w / 2 - 5, Math.max(8 + w / 2 + 5, X(spot[0])));
      const my = Y(spot[1]);
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.roundRect(mx - w / 2 - 5, my - 11, w + 10, 22, 4);
      ctx.fill();
      ctx.fillStyle = INK;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(d.label, mx, my + 1);
    }
    const conePts = [...course.cones.map((c) => [c.hx / 2, c.hy / 2]), ...dimensions.map(({ spot }) => spot)];
    const clearance = (p, pts) => Math.min(...pts.map((q) => Math.hypot(q[0] - p[0], q[1] - p[1])));
    const pathClearance = (p, path) => {
      let best = Infinity;
      for (let i = 1; i < path.length; i++) {
        const [ax, ay] = path[i - 1];
        const dx = path[i][0] - ax;
        const dy = path[i][1] - ay;
        const len2 = dx * dx + dy * dy || 1;
        const t = Math.max(0, Math.min(1, ((p[0] - ax) * dx + (p[1] - ay) * dy) / len2));
        best = Math.min(best, Math.hypot(ax + dx * t - p[0], ay + dy * t - p[1]));
      }
      return best;
    };
    for (const e of course.elements) {
      const z = e.zone;
      const cx = (z[0][0] + z[2][0]) / 2;
      const cy = (z[0][1] + z[2][1]) / 2;
      const cands = [];
      for (let i = 0; i <= 8; i++) {
        for (let j = 0; j <= 8; j++) {
          const u = i / 8;
          const v = j / 8;
          const x = z[0][0] + (z[1][0] - z[0][0]) * u + (z[3][0] - z[0][0]) * v;
          const y = z[0][1] + (z[1][1] - z[0][1]) * u + (z[3][1] - z[0][1]) * v;
          if (x > 0.8 && y > 0.8 && x < course.site.width - 0.8 && y < course.site.length - 0.8) cands.push([x, y]);
        }
      }
      cands.sort((p, q) => Math.hypot(p[0] - cx, p[1] - cy) - Math.hypot(q[0] - cx, q[1] - cy));
      const ok = cands.find((p) => clearance(p, conePts) >= 1.4 && pathClearance(p, e.path) >= 0.9);
      const best = ok ?? cands.reduce((a, p) => (clearance(p, conePts) > clearance(a, conePts) ? p : a), cands[0] ?? [cx, cy]);
      badge(ctx, X(best[0]), Y(best[1]), String(e.order), 17);
    }

    // Reference corner.
    ctx.lineWidth = 4;
    ctx.strokeStyle = ANCHOR;
    ctx.beginPath();
    ctx.moveTo(X(0), Y(0));
    ctx.lineTo(X(0) + 70, Y(0));
    ctx.moveTo(X(0), Y(0));
    ctx.lineTo(X(0), Y(0) - 70);
    ctx.stroke();
    arrowHead(ctx, X(0) + 74, Y(0), 0, 14, ANCHOR);
    arrowHead(ctx, X(0), Y(0) - 74, -Math.PI / 2, 14, ANCHOR);
    font(ctx, 22, 700);
    ctx.fillStyle = ANCHOR;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText('X', X(0) + 92, Y(0) - 14);
    ctx.fillText('Y', X(0) + 12, Y(0) - 92);
    ctx.fillStyle = INK;
    ctx.beginPath();
    ctx.roundRect(X(0) - 36, Y(0) + 6, 96, 32, 6);
    ctx.fill();
    ctx.fillStyle = '#ffe7a3';
    ctx.textAlign = 'center';
    ctx.fillText('A (0,0)', X(0) + 12, Y(0) + 23);
  }
  return { height, draw };
}

function textBlock(lines) {
  // lines: [{text, size, weight, color}]
  return {
    measure(ctx, width) {
      let h = 0;
      this.rows = [];
      for (const l of lines) {
        font(ctx, l.size, l.weight);
        for (const t of wrap(ctx, l.text, width)) {
          this.rows.push({ ...l, text: t, y: h });
          h += l.size * 1.35;
        }
        h += l.gap ?? 0;
      }
      return h;
    },
    draw(ctx, x, y) {
      for (const r of this.rows) {
        font(ctx, r.size, r.weight);
        ctx.fillStyle = r.color ?? INK;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillText(r.text, x, y + r.y);
      }
    },
  };
}

function cardBlock(card, width) {
  const inner = width - 36;
  const head = textBlock([
    { text: card.name, size: 28, weight: 700, gap: 4 },
    { text: `Якорь: X ${fmt(card.anchor.x)} м · Y ${fmt(card.anchor.y)} м`, size: 26, weight: 700, color: '#6b4c00', gap: card.fromPrevious ? 2 : 6 },
    ...(card.fromPrevious ? [{ text: card.fromPrevious.label, size: 21, weight: 600, color: '#6b4c00', gap: 6 }] : []),
    { text: `Ось: ${card.axis.label}`, size: 20 },
    { text: `Проезд: ${card.travel}`, size: 20, gap: 6 },
    ...card.notes.map((n) => ({ text: n, size: 20, color: '#2f3d45' })),
  ]);
  const rowH = 32;
  const cols = card.axis.diagonal ? ['№', 'конус', 'ΔX', 'ΔY'] : ['№', 'конус', 'вдоль', 'поперёк'];
  return {
    measure(ctx) {
      this.headH = head.measure(ctx, inner - 44);
      this.height = 18 + this.headH + 14 + rowH * (card.cones.length + 1) + (card.axis.diagonal ? 0 : 30) + 18;
      return this.height;
    },
    draw(ctx, x, y) {
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#b9c3c0';
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.roundRect(x, y, width, this.height, 12);
      ctx.fill();
      ctx.stroke();
      badge(ctx, x + 36, y + 36, String(card.number), 20);
      head.draw(ctx, x + 66, y + 18);
      let ty = y + 18 + this.headH + 14;
      const colX = [x + 22, x + 78, x + 200, x + 330];
      font(ctx, 18, 600);
      ctx.fillStyle = MUTED;
      ctx.textBaseline = 'middle';
      cols.forEach((c, i) => {
        ctx.textAlign = 'left';
        ctx.fillText(c, colX[i], ty + rowH / 2);
      });
      ty += rowH;
      for (const cone of card.cones) {
        ctx.strokeStyle = RULE;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x + 16, ty);
        ctx.lineTo(x + width - 16, ty);
        ctx.stroke();
        font(ctx, 20, 600);
        ctx.fillStyle = INK;
        ctx.textAlign = 'left';
        ctx.fillText(String(cone.n), colX[0], ty + rowH / 2);
        coneGlyph(ctx, colX[1] + 12, ty + rowH / 2, cone, { anchor: cone.n === 1, r: 10 });
        font(ctx, 18);
        ctx.fillStyle = MUTED;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(cone.height === 'tall' ? 'высокий' : 'низкий', colX[1] + 36, ty + rowH / 2);
        font(ctx, 22, 700);
        ctx.fillStyle = INK;
        ctx.textAlign = 'left';
        const a = card.axis.diagonal ? cone.dx : cone.along;
        const b = card.axis.diagonal ? cone.dy : cone.across;
        ctx.fillText(`${fmt(a)} м`, colX[2] + 20, ty + rowH / 2);
        ctx.fillText(`${fmt(b)} м`, colX[3], ty + rowH / 2);
        ty += rowH;
      }
      if (!card.axis.diagonal) {
        font(ctx, 17);
        ctx.fillStyle = MUTED;
        ctx.textAlign = 'left';
        ctx.fillText('поперёк: «+» — влево от направления оси', x + 22, ty + 16);
      }
    },
  };
}

/** A fresh 9:16 frame with its number in the corner and the credit at the foot. */
function frame(makeCanvas, number, total) {
  const canvas = makeCanvas(W, H);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#f7f8f6';
  ctx.fillRect(0, 0, W, H);
  const tag = `${number}/${total}`;
  font(ctx, 30, 800);
  const w = ctx.measureText(tag).width;
  ctx.fillStyle = INK;
  ctx.beginPath();
  ctx.roundRect(W - PAD - w - 28, PAD, w + 28, 48, 10);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(tag, W - PAD - (w + 28) / 2, PAD + 25);
  font(ctx, 20, 600);
  ctx.fillStyle = '#8a969c';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'bottom';
  ctx.fillText('by h0x91B', W - PAD, H - PAD + 10);
  return { canvas, ctx };
}

const TAG_SPACE = 150; // the frame number in the top right corner
const FOOTER = 50;

/** Card rows (pairs) packed into frames by height, in passing order. */
function packCards(cards, available) {
  const frames = [];
  let current = [];
  let used = 0;
  for (let i = 0; i < cards.length; i += 2) {
    const row = cards.slice(i, i + 2);
    const h = Math.max(...row.map((c) => c.height)) + 20;
    if (current.length && used + h > available) {
      frames.push(current);
      current = [];
      used = 0;
    }
    current.push(row);
    used += h;
  }
  if (current.length) frames.push(current);
  return frames;
}

/**
 * Draws the sheet as a series of 9:16 frames and returns their canvases.
 * @param {(w: number, h: number) => HTMLCanvasElement | OffscreenCanvas} makeCanvas
 */
export function renderSheetImages(course, sheet, makeCanvas) {
  const probe = makeCanvas(1, 1).getContext('2d');
  const width = W - 2 * PAD;
  const fmtCone = (c) => `X ${fmt(c.x)} · Y ${fmt(c.y)}`;
  const subtitle = `Площадка ${sheet.site.width} × ${sheet.site.length} м · ${sheet.cards.length} элем. · все расстояния между центрами конусов, от опорного угла A`;
  const intro = textBlock([
    { text: 'Схема расстановки трассы', size: 44, weight: 800, gap: 4 },
    { text: subtitle, size: 22, color: MUTED },
  ]);
  const terminals = textBlock([
    ...(sheet.closed
      ? [{ text: `Старт и финиш — одна линия: низкие конусы ${sheet.start.cones.map(fmtCone).join(' и ')}, проезд ${sheet.start.travel}`, size: 22, weight: 600 }]
      : [
        { text: `Старт: низкие конусы ${sheet.start.cones.map(fmtCone).join(' и ')}, проезд ${sheet.start.travel}`, size: 22, weight: 600 },
        { text: `Финиш: низкие конусы ${sheet.finish.cones.map(fmtCone).join(' и ')}, проезд ${sheet.finish.travel}`, size: 22, weight: 600 },
      ]),
  ]);
  const legend = textBlock([
    { text: 'Л — синий высокий конус, остаётся слева от мотоцикла. П — красный высокий, остаётся справа. Белый кружок — низкий конус (углы, границы, старт, финиш). Кольцо — якорь элемента. Сплошная линия со стрелками — элемент, штрихи со стрелками — связка, точки — закрытые стороны коробки и разворота (не размечаются), толстые штрихи — линия старта и финиша.', size: 20, color: '#2f3d45' },
  ]);
  const { tallBlue, tallRed, low } = sheet.coneList;
  const list = textBlock([
    { text: `Ведомость: высоких синих ${tallBlue} · высоких красных ${tallRed} · низких ${low} · всего ${tallBlue + tallRed + low}`, size: 26, weight: 700 },
  ]);
  const hIntro = intro.measure(probe, width - TAG_SPACE);
  const hTerm = terminals.measure(probe, width);
  const hLegend = legend.measure(probe, width);
  const hList = list.measure(probe, width);
  // The plan takes whatever height the first frame has left.
  const plan = planBlock(course, sheet, H - 2 * PAD - FOOTER - hIntro - 20 - 16 - hLegend - 20 - hTerm - 20 - hList);

  const colW = (width - 20) / 2;
  const cards = sheet.cards.map((c) => cardBlock(c, colW));
  cards.forEach((c) => c.measure(probe));
  const heading = (from, to) => textBlock([
    { text: `Карточки элементов ${from}–${to}`, size: 40, weight: 800, gap: 4 },
    { text: subtitle, size: 22, color: MUTED },
  ]);
  const hHeading = heading(1, 1).measure(probe, width - TAG_SPACE);
  const cardFrames = packCards(cards, H - 2 * PAD - FOOTER - hHeading - 24);
  const total = 1 + cardFrames.length;

  const first = frame(makeCanvas, 1, total);
  let y = PAD;
  intro.draw(first.ctx, PAD, y);
  y += hIntro + 20;
  plan.draw(first.ctx, y);
  y += plan.height + 16;
  legend.draw(first.ctx, PAD, y);
  y += hLegend + 20;
  terminals.draw(first.ctx, PAD, y);
  y += hTerm + 20;
  list.draw(first.ctx, PAD, y);
  const canvases = [first.canvas];

  let shown = 0;
  cardFrames.forEach((rows, k) => {
    const { canvas, ctx } = frame(makeCanvas, k + 2, total);
    const count = rows.reduce((n, row) => n + row.length, 0);
    const head = heading(shown + 1, shown + count);
    head.measure(ctx, width - TAG_SPACE);
    head.draw(ctx, PAD, PAD);
    let cy = PAD + hHeading + 24;
    for (const row of rows) {
      row[0].draw(ctx, PAD, cy);
      if (row[1]) row[1].draw(ctx, PAD + colW + 20, cy);
      cy += Math.max(...row.map((c) => c.height)) + 20;
    }
    shown += count;
    canvases.push(canvas);
  });
  return canvases;
}
