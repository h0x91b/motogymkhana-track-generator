// Mean elements placed over seeds 1–100 for benchmark recipes: the field
// tester's two lots and the default big course. `bun scripts/bench.mjs`.

import { generateCourse } from '../src/generator/index.js';

const SEEDS = 100;
const RECIPES = [
  ['40×38 средняя спорт, 6 элементов', { width: 40, length: 38, elements: 6, difficulty: 'medium', bike: 'sport' }],
  ['28×30 лёгкая спорт, 6 элементов', { width: 28, length: 30, elements: 6, difficulty: 'easy', bike: 'sport' }],
  ['40×60 сложная крузер замкнутая паровозик, 8 элементов', { width: 40, length: 60, elements: 8, difficulty: 'hard', bike: 'cruiser', shape: 'closed', train: true }],
];

for (const [name, recipe] of RECIPES) {
  let sum = 0;
  let min = Infinity;
  let max = 0;
  let failed = 0;
  const t = performance.now();
  for (let seed = 1; seed <= SEEDS; seed++) {
    const result = generateCourse(recipe, seed);
    const placed = result.ok ? result.course.placed : 0;
    if (!result.ok) failed++;
    sum += placed;
    min = Math.min(min, placed);
    max = Math.max(max, placed);
  }
  const ms = (performance.now() - t) / SEEDS;
  console.log(`${name}: ${(sum / SEEDS).toFixed(2)} of ${recipe.elements} (min ${min}, max ${max}${failed ? `, ${failed} failed` : ''}), ${ms.toFixed(0)} ms/course`);
}
