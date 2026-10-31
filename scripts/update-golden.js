// Regenerates golden snapshots. Refuses to overwrite a snapshot whose course
// changed while GENERATOR_VERSION stayed the same: bump the version first.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { canonicalJSON, courseHash, generateCourse, GENERATOR_VERSION } from '../src/generator/index.js';

const dir = new URL('../test/golden/', import.meta.url);
const pairs = JSON.parse(readFileSync(new URL('pairs.json', dir), 'utf8'));
let refused = 0;
let written = 0;

for (const pair of pairs) {
  const file = new URL(`${pair.name}.json`, dir);
  const result = generateCourse(pair.recipe, pair.seed);
  if (!result.ok) throw new Error(`${pair.name}: ${JSON.stringify(result.error)}`);
  const course = JSON.parse(canonicalJSON(result.course));
  const hash = courseHash(result.course);
  if (existsSync(file)) {
    const old = JSON.parse(readFileSync(file, 'utf8'));
    if (old.generatorVersion === GENERATOR_VERSION) {
      if (old.hash !== hash) {
        console.error(`✗ ${pair.name}: course changed but GENERATOR_VERSION is still ${GENERATOR_VERSION}. Bump it first.`);
        refused++;
      }
      continue;
    }
  }
  const golden = { name: pair.name, generatorVersion: GENERATOR_VERSION, recipe: pair.recipe, seed: pair.seed, hash, course };
  writeFileSync(file, `${JSON.stringify(golden, null, 1)}\n`);
  written++;
  console.log(`✓ ${pair.name} ${hash}`);
}

console.log(`${written} written, ${pairs.length - written - refused} unchanged, ${refused} refused`);
if (refused) process.exit(1);
