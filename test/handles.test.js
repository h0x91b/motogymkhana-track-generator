// Resize handles of a blocked area in «Правка»: which handle a press is on,
// and what dragging a corner or a side does to the rectangle.

import { describe, expect, test } from 'bun:test';
import { addBlocked, generateCourse, layoutOf, resizeBlockedSide } from '../src/generator/index.js';
import { blockedHandles, handleCursor, hitHandle, HANDLE_REACH } from '../src/render/handles.js';

// 10 px per metre, screen y down: the plan as a phone shows it, y up on the lot.
const project = (x, y) => ({ x: 100 + x * 10, y: 500 - y * 10 });

describe('handles on screen', () => {
  const b = { x: 4, y: 6, w: 6, h: 4 }; // screen: x 140…200, y 400…440
  const hits = blockedHandles('b1', b, project);

  test('eight: four corners and four side midpoints', () => {
    expect(hits).toHaveLength(8);
    const at = (sx, sy) => hits.find((h) => h.sx === sx && h.sy === sy);
    expect(at(-1, -1)).toMatchObject({ x: 140, y: 440 });
    expect(at(1, 1)).toMatchObject({ x: 200, y: 400 });
    expect(at(0, 1)).toMatchObject({ x: 170, y: 400 });
    expect(at(1, 0)).toMatchObject({ x: 200, y: 420 });
    expect(hits.every((h) => h.element === 'b1' && h.kind === 'handle')).toBe(true);
  });

  test('cursors follow the screen: sides ew/ns, corners on their diagonal', () => {
    const cursor = (sx, sy) => hits.find((h) => h.sx === sx && h.sy === sy).cursor;
    expect(cursor(1, 0)).toBe('ew-resize');
    expect(cursor(-1, 0)).toBe('ew-resize');
    expect(cursor(0, 1)).toBe('ns-resize');
    // The top right on screen (x1, y1: y up on the lot) and the bottom left share a diagonal.
    expect(cursor(1, 1)).toBe('nesw-resize');
    expect(cursor(-1, -1)).toBe('nesw-resize');
    expect(cursor(-1, 1)).toBe('nwse-resize');
    expect(handleCursor(1, 0, 3, -40)).toBe('ns-resize'); // a side that points up on a turned plan
  });

  test('a mouse reaches at least 12 px across, a finger at least 28', () => {
    expect(2 * HANDLE_REACH.mouse).toBeGreaterThanOrEqual(12);
    expect(2 * HANDLE_REACH.touch).toBeGreaterThanOrEqual(28);
    expect(hitHandle(hits, 200 + 8, 400 - 8, 'mouse')).toMatchObject({ sx: 1, sy: 1 });
    expect(hitHandle(hits, 200 + 9, 400, 'mouse')).toBeNull();
    expect(hitHandle(hits, 200 + 15, 400 - 15, 'touch')).toMatchObject({ sx: 1, sy: 1 });
    expect(hitHandle(hits, 200 + 17, 400, 'touch')).toBeNull();
  });

  test('the nearest handle wins', () => {
    expect(hitHandle(hits, 165, 398, 'touch')).toMatchObject({ sx: 0, sy: 1 });
    expect(hitHandle(hits, 147, 398, 'touch')).toMatchObject({ sx: -1, sy: 1 });
  });

  test('the middle of the rectangle is never a handle, even a small one under a finger', () => {
    expect(hitHandle(hits, 170, 420, 'touch')).toBeNull();
    const small = blockedHandles('b2', { x: 0, y: 0, w: 2, h: 2 }, project); // 20 × 20 px
    expect(hitHandle(small, 110, 490, 'touch')).toBeNull();
    // From outside a small one still keeps the full reach.
    expect(hitHandle(small, 100 - 14, 500 + 14, 'touch')).toMatchObject({ sx: -1, sy: -1 });
  });

  test('other hits are not handles', () => {
    expect(hitHandle([{ kind: 'label', element: 'e1', x: 0, y: 0, w: 44, h: 44 }], 0, 0)).toBeNull();
  });
});

describe('dragging a side or a corner', () => {
  const layout0 = addBlocked(layoutOf(generateCourse({ width: '40', length: '30', elements: '4', difficulty: 'easy', bike: 'sport' }, '1').course), 'obstacle');
  const k = 0;
  const from = { x: 10, y: 12, w: 4, h: 6 }; // x 10…14, y 12…18
  const layout = { ...layout0, recipe: { ...layout0.recipe, blocked: [{ kind: 'obstacle', ...from }] } };
  const drag = (sx, sy, dx, dy) => {
    const { x, y, w, h } = resizeBlockedSide(layout, k, from, sx, sy, dx, dy).recipe.blocked[k];
    return { x, y, w, h };
  };

  test('a side moves only itself; the opposite one stays put', () => {
    expect(drag(1, 0, 3, 5)).toEqual({ x: 10, y: 12, w: 7, h: 6 });
    expect(drag(-1, 0, -2, 5)).toEqual({ x: 8, y: 12, w: 6, h: 6 });
    expect(drag(0, 1, 9, 2)).toEqual({ x: 10, y: 12, w: 4, h: 8 });
    expect(drag(0, -1, 9, 2)).toEqual({ x: 10, y: 14, w: 4, h: 4 });
  });

  test('a corner moves both of its sides', () => {
    expect(drag(1, 1, 2, -1)).toEqual({ x: 10, y: 12, w: 6, h: 5 });
    expect(drag(-1, -1, -3, -4)).toEqual({ x: 7, y: 8, w: 7, h: 10 });
  });

  test('whole metres', () => {
    expect(drag(1, 1, 1.4, 2.6)).toEqual({ x: 10, y: 12, w: 5, h: 9 });
    expect(drag(-1, 0, -0.6, 0)).toEqual({ x: 9, y: 12, w: 5, h: 6 });
  });

  test('never under 1 × 1 m: crossing the opposite side stops 1 m short of it', () => {
    expect(drag(1, 0, -20, 0)).toEqual({ x: 10, y: 12, w: 1, h: 6 });
    expect(drag(-1, -1, 30, 30)).toEqual({ x: 13, y: 17, w: 1, h: 1 });
  });

  test('stops at the edge of the lot, the opposite side still put', () => {
    expect(drag(1, 1, 100, 100)).toEqual({ x: 10, y: 12, w: 30, h: 18 });
    expect(drag(-1, -1, -100, -100)).toEqual({ x: 0, y: 0, w: 14, h: 18 });
  });

  test('a handle that moves no side changes nothing; other areas are left alone', () => {
    expect(drag(0, 0, 5, 5)).toEqual(from);
    const two = { ...layout, recipe: { ...layout.recipe, blocked: [{ kind: 'obstacle', ...from }, { kind: 'cutout', x: 0, y: 0, w: 3, h: 3 }] } };
    expect(resizeBlockedSide(two, 0, from, 1, 0, 2, 0).recipe.blocked[1]).toEqual({ kind: 'cutout', x: 0, y: 0, w: 3, h: 3 });
  });
});
