// Mean elements placed over seeds 1–N for benchmark recipes.
//
//   bun scripts/bench.mjs                          the recipes in scripts/bench-recipes.json
//   bun scripts/bench.mjs my-recipes.json          recipes from another file
//   bun scripts/bench.mjs '{"width":30,"length":30,"elements":5}'   one recipe inline
//   bun scripts/bench.mjs --seeds 20 ...           fewer seeds (default 100)
//   bun scripts/bench.mjs runOff=2 pad=0.5         safety values (recipe.safety) for every recipe
//
// A file holds an array (or one entry); an entry is a recipe or { name, recipe }.
// Several files and inline recipes can be mixed. Add your own recipes as
// arguments or in your own file instead of editing this script.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { generateCourse } from '../src/generator/index.js';

const args = process.argv.slice(2);
let seeds = 100;
const at = args.indexOf('--seeds');
if (at >= 0) {
  seeds = Number(args.splice(at, 2)[1]);
  if (!Number.isInteger(seeds) || seeds < 1) {
    console.error('--seeds takes a positive integer');
    process.exit(2);
  }
}

const safety = Object.fromEntries(args.filter((a) => /^\w+=/.test(a)).map((a) => a.split('=')).map(([k, v]) => [k, Number(v)]));
const rest = args.filter((a) => !/^\w+=/.test(a));
const sources = rest.length ? rest : [join(import.meta.dir, 'bench-recipes.json')];
const entries = sources.flatMap((source) => {
  const data = JSON.parse(source.trimStart().startsWith('{') || source.trimStart().startsWith('[') ? source : readFileSync(source, 'utf8'));
  return (Array.isArray(data) ? data : [data])
    .map((e) => (e.recipe ? e : { name: JSON.stringify(e), recipe: e }))
    .map((e) => (Object.keys(safety).length ? { ...e, recipe: { ...e.recipe, safety } } : e));
});

if (Object.keys(safety).length) console.log(`safety: ${JSON.stringify(safety)}`);

for (const { name, recipe } of entries) {
  let sum = 0;
  let min = Infinity;
  let max = 0;
  let failed = 0;
  let firstError = null;
  const t = performance.now();
  for (let seed = 1; seed <= seeds; seed++) {
    const result = generateCourse(recipe, seed);
    const placed = result.ok ? result.course.placed : 0;
    if (!result.ok) {
      failed++;
      firstError ??= JSON.stringify(result.error);
    }
    sum += placed;
    min = Math.min(min, placed);
    max = Math.max(max, placed);
  }
  const ms = (performance.now() - t) / seeds;
  console.log(`${name}: ${(sum / seeds).toFixed(2)} of ${recipe.elements} (min ${min}, max ${max}${failed ? `, ${failed} failed, first: ${firstError}` : ''}), ${ms.toFixed(0)} ms/course`);
}
