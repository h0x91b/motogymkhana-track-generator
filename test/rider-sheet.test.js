// The rider's sheet seam: `renderRiderSheet` draws one A4 page for every
// element type, picks the page's orientation by the lot, and draws none of the
// setup sheet's measuring aids. Drawn on a stand-in canvas that records the
// calls, so it checks code paths and what is drawn, not pixels.

import { expect, mock, test } from 'bun:test';
import * as dimension from '../src/render/dimension.js';
import * as reserved from '../src/render/reserved.js';
import * as scaleBar from '../src/render/scale-bar.js';
import { generateCourse } from '../src/generator/index.js';
import { ELEMENT_TYPES } from '../src/generator/recipe.js';
import { routeLayout } from '../src/generator/layout.js';
import { readCourseFile } from '../src/file/course-file.js';
import { buildSetupSheet } from '../src/sheet/setup-sheet.js';
import { buildRide } from '../src/render/ride.js';
import { timeout } from './helpers/slow.js';

// Spies on the setup sheet's drawing helpers for dimensions, zones and the
// scale bar, in place before the rider's sheet is loaded.
const spies = {
  cardDimensions: mock(dimension.cardDimensions),
  placeLabel: mock(dimension.placeLabel),
  reservedZones: mock(reserved.reservedZones),
  blockedOutlines: mock(reserved.blockedOutlines),
  drawScaleBar: mock(scaleBar.drawScaleBar),
};
mock.module('../src/render/dimension.js', () => ({ ...dimension, cardDimensions: spies.cardDimensions, placeLabel: spies.placeLabel }));
mock.module('../src/render/reserved.js', () => ({ ...reserved, reservedZones: spies.reservedZones, blockedOutlines: spies.blockedOutlines }));
mock.module('../src/render/scale-bar.js', () => ({ ...scaleBar, drawScaleBar: spies.drawScaleBar }));
const { A4, LINE_COLORS, renderRiderSheet, riderPage, selfCrossings } = await import('../src/render/rider-sheet.js');

/** A 2D context that records its calls and text, 10 px a character. */
function recordingContext(log) {
  const ctx = {
    measureText: (text) => ({ width: String(text).length * 10 }),
    fillText: (text) => log.text.push(String(text)),
    setLineDash: (dash) => log.dashes.push(dash),
  };
  return new Proxy(ctx, {
    get: (t, k) => (k in t ? t[k] : () => {}),
    set: (t, k, v) => {
      if (k === 'strokeStyle') log.strokes.add(v);
      t[k] = v;
      return true;
    },
  });
}
function draw(course) {
  const log = { text: [], dashes: [], strokes: new Set() };
  const makeCanvas = (width, height) => ({ width, height, getContext: () => recordingContext(log) });
  const canvas = renderRiderSheet(course, buildSetupSheet(course), makeCanvas, { title: 'Трасса', date: '13.11.2026' });
  return { canvas, log };
}

const userCourse = async () => {
  const text = await Bun.file(new URL('./fixtures/edited-40x52.json', import.meta.url)).text();
  return routeLayout(readCourseFile(text).layout).course;
};

test('every element type draws on the rider sheet, numbered in riding order', () => {
  for (const type of ELEMENT_TYPES) {
    const { course } = generateCourse({ width: 60, length: 80, elements: 3, difficulty: 'medium', shape: 'open', types: [type, 'gate'] }, 1);
    expect(course.elements.some((e) => e.type === type)).toBe(true);
    const { log } = draw(course);
    const n = course.elements.filter((e) => e.type !== 'waypoint').length;
    for (let k = 1; k <= n; k++) expect(log.text).toContain(String(k));
  }
}, timeout(20_000));

test('an A4 page at 300 dpi: portrait for a long lot, landscape for a wide one', async () => {
  const { canvas } = draw(await userCourse());
  expect([canvas.width, canvas.height]).toEqual([A4.short, A4.long]);
  expect(riderPage({ width: 40, length: 60 }).landscape).toBe(false);
  expect(riderPage({ width: 80, length: 40 })).toMatchObject({ width: A4.long, height: A4.short, landscape: true });
});

test('no dimensions, zones, scale bar or coordinates on the rider sheet', async () => {
  for (const s of Object.values(spies)) s.mockClear();
  const { course } = generateCourse({ width: 40, length: 60, elements: 8, difficulty: 'hard', shape: 'closed', bike: 'cruiser' }, 3);
  for (const c of [await userCourse(), course]) {
    const { log } = draw(c);
    for (const [name, s] of Object.entries(spies)) expect({ name, calls: s.mock.calls.length }).toEqual({ name, calls: 0 });
    // Metres only in the header's lot size; no «X 12,5», «ΔY» or anchors.
    expect(log.text.filter((t) => /(^|\s)м($|[\s.,·])/u.test(t))).toEqual([expect.stringContaining(`${c.site.width} × ${c.site.length} м`)]);
    expect(log.text.some((t) => /^(X|Y|Δ)|Якорь|ширина|длина/.test(t))).toBe(false);
  }
});

test('the riding line takes one colour per element, and the line crosses itself where the course does', async () => {
  const course = await userCourse();
  const { log } = draw(course);
  const n = course.elements.filter((e) => e.type !== 'waypoint').length;
  for (const colour of LINE_COLORS.slice(0, Math.min(n, LINE_COLORS.length))) expect(log.strokes.has(colour)).toBe(true);
  // Box-eight, keyholes and the pivot turn cross their own line.
  expect(selfCrossings(buildRide(course)).length).toBeGreaterThan(3);
});
