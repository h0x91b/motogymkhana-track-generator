// Soft criteria are judged on many seeds, never on a single course.

import { expect, test } from 'bun:test';
import { generateCourse } from '../src/generator/index.js';
import { fullRoute, turns } from './helpers/course-geometry.js';

const RECIPES = [
  { width: 40, length: 60, elements: 8, difficulty: 'medium', closed: true },
  { width: 40, length: 60, elements: 8, difficulty: 'medium', closed: false },
  { width: 30, length: 45, elements: 10, difficulty: 'hard', closed: true },
  { width: 60, length: 80, elements: 12, difficulty: 'easy', closed: false },
];
const SEEDS = 60;

const courses = RECIPES.map((recipe) => Array.from({ length: SEEDS }, (_, seed) => generateCourse(recipe, seed).course));
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;

test('left and right turning is balanced on average', () => {
  for (const set of courses) {
    const imbalance = mean(set.map((c) => {
      const t = turns(fullRoute(c));
      return Math.abs(t.left - t.right) / (t.left + t.right);
    }));
    expect(imbalance).toBeLessThan(0.2);
  }
});

test('elements are spread over the whole site, not bunched in a corner', () => {
  for (const set of courses) {
    const centres = (c) => c.elements.map((e) => [(e.zone[0][0] + e.zone[2][0]) / 2, (e.zone[0][1] + e.zone[2][1]) / 2]);
    const coverage = mean(set.map((c) => {
      const pts = centres(c);
      const span = (k) => Math.max(...pts.map((p) => p[k])) - Math.min(...pts.map((p) => p[k]));
      return Math.min(span(0) / c.site.width, span(1) / c.site.length);
    }));
    const quadrants = mean(set.map((c) => new Set(centres(c).map((p) => (p[0] < c.site.width / 2 ? 0 : 1) + (p[1] < c.site.length / 2 ? 0 : 2))).size));
    expect(coverage).toBeGreaterThan(0.5);
    expect(quadrants).toBeGreaterThan(3.5);
  }
});

test('with every type allowed, a course uses most of them rather than a few compact ones', () => {
  for (const set of courses.slice(0, 2)) {
    const distinct = mean(set.map((c) => new Set(c.elements.map((e) => e.type)).size));
    expect(distinct).toBeGreaterThan(6);
  }
});
