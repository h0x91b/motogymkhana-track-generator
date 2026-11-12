// The setup-sheet picture seam: `renderSheetImages` draws every frame of a
// course without throwing. Drawn on a stand-in canvas that records nothing, so
// it checks the code paths, not the pixels.

import { expect, test } from 'bun:test';
import { generateCourse } from '../src/generator/index.js';
import { buildSetupSheet } from '../src/sheet/setup-sheet.js';
import { renderSheetImages } from '../src/render/sheet-image.js';

/** A 2D context where every call is a no-op and text is 10 px a character. */
function fakeContext() {
  const ctx = {
    measureText: (text) => ({ width: String(text).length * 10, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2 }),
    createLinearGradient: () => ({ addColorStop() {} }),
    createRadialGradient: () => ({ addColorStop() {} }),
    getLineDash: () => [],
  };
  return new Proxy(ctx, { get: (t, k) => (k in t ? t[k] : () => {}), set: (t, k, v) => { t[k] = v; return true; } });
}
const makeCanvas = (width, height) => ({ width, height, getContext: () => fakeContext() });

test('every frame of the setup sheet draws without an error', () => {
  for (const recipe of [
    { width: 40, length: 60, elements: 8, difficulty: 'hard', bike: 'cruiser', shape: 'closed', train: true },
    { width: 40, length: 60, elements: 6, difficulty: 'medium', shape: 'open', safety: { pad: 0, coneGap: 0 } },
  ]) {
    const { course } = generateCourse(recipe, 1);
    const frames = renderSheetImages(course, buildSetupSheet(course), makeCanvas);
    expect(frames.length).toBeGreaterThan(1);
  }
}, 30_000);

test('a course with every element turned off the lattice in «Правка» draws too', async () => {
  const { layoutOf, rotateElement, routeLayout } = await import('../src/generator/layout.js');
  const { course: generated } = generateCourse({ width: 60, length: 80, elements: 8, difficulty: 'medium', shape: 'open', types: ['corridor-slalom', 'box-eight', 'swerve', 'tunnel', 'lane-change', 'u-turn', 'box', 'mirror', 'snail'] }, 1);
  let layout = layoutOf(generated);
  for (let i = 0; i < layout.elements.length; i++) layout = rotateElement(layout, i, 1);
  const { course } = routeLayout(layout);
  expect(course.elements.every((e) => e.offLattice)).toBe(true);
  expect(renderSheetImages(course, buildSetupSheet(course), makeCanvas).length).toBeGreaterThan(1);
}, 30_000);
