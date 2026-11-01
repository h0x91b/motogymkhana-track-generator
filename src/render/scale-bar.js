// The site grid and the map-style scale bar that reads it off. Shared by the
// scene and the setup-sheet picture so both show the same grid.

export const GRID_STEP = 5; // metres between grid lines

/**
 * How the bar looks at `pxPerMetre`: `count` segments of `unit` metres, the
 * distance written at every `labelEvery`-th tick, the bar at most `maxWidth`
 * px long. Segments are grid cells, two of them when they fit; zoomed far out
 * the labels thin out instead, and zoomed so far in that one cell does not
 * fit, the segments get shorter and the bar adds the cell size (`caption`).
 */
export function scaleBarFor(pxPerMetre, maxWidth, minSegment) {
  const cell = GRID_STEP * pxPerMetre;
  if (cell >= minSegment) {
    if (cell <= maxWidth) return { unit: GRID_STEP, count: 2 * cell <= maxWidth ? 2 : 1, labelEvery: 1, caption: false };
    const unit = 2 * pxPerMetre <= maxWidth ? 2 : 1;
    return { unit, count: 2 * unit * pxPerMetre <= maxWidth ? 2 : 1, labelEvery: 1, caption: true };
  }
  const labelEvery = Math.ceil(minSegment / cell);
  const count = 2 * labelEvery * cell <= maxWidth ? 2 * labelEvery : labelEvery;
  return { unit: GRID_STEP, count, labelEvery, caption: false };
}

/**
 * Draws the bar, its top at y: alternating ink and paper segments, the
 * distances above ("0 5 10 м"), the cell size below when the segments are
 * not cells. The group, labels included, is centred on cx.
 */
export function drawScaleBar(ctx, cx, y, pxPerMetre, { maxWidth, minSegment, height, fontSize, ink, paper, text, halo = null }) {
  const { unit, count, labelEvery, caption } = scaleBarFor(pxPerMetre, maxWidth, minSegment);
  const seg = unit * pxPerMetre;
  ctx.save();
  ctx.font = `600 ${fontSize}px system-ui, -apple-system, sans-serif`;
  // The unit follows the last number, which stays centred on its tick.
  const last = ctx.measureText(String(unit * count)).width;
  const before = ctx.measureText('0').width / 2;
  const after = last / 2 + ctx.measureText(' м').width;
  const x0 = cx - (before + seg * count + after) / 2 + before;
  const label = (value, x, at, align, baseline) => {
    ctx.textAlign = align;
    ctx.textBaseline = baseline;
    if (halo) {
      ctx.lineWidth = 3;
      ctx.strokeStyle = halo;
      ctx.lineJoin = 'round';
      ctx.strokeText(value, x, at);
    }
    ctx.fillStyle = text;
    ctx.fillText(value, x, at);
  };
  if (halo) {
    // Light rim, so the ink segments still read on the dark asphalt.
    ctx.lineWidth = 3;
    ctx.strokeStyle = halo;
    ctx.strokeRect(x0 - 0.5, y - 0.5, seg * count + 1, height + 1);
  }
  for (let k = 0; k < count; k++) {
    ctx.fillStyle = k % 2 === 0 ? ink : paper;
    ctx.fillRect(x0 + k * seg, y, seg, height);
  }
  ctx.lineWidth = 1;
  ctx.strokeStyle = ink;
  ctx.strokeRect(x0 + 0.5, y + 0.5, seg * count - 1, height - 1);
  for (let k = 0; k <= count; k += labelEvery) label(String(unit * k), x0 + k * seg, y - 3, 'center', 'bottom');
  label(' м', x0 + seg * count + last / 2, y - 3, 'left', 'bottom');
  if (caption) label(`клетка ${GRID_STEP} м`, x0 + (seg * count) / 2, y + height + 3, 'center', 'top');
  ctx.restore();
}
