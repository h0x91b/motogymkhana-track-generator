// Golden snapshots pin the generator's output to GENERATOR_VERSION: changing a
// course without bumping the version fails here. After a deliberate change,
// bump the version and run `bun run golden`.

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { canonicalJSON, courseHash, generateCourse, GENERATOR_VERSION } from '../src/generator/index.js';

const dir = new URL('./golden/', import.meta.url);
const pairs = JSON.parse(readFileSync(new URL('pairs.json', dir), 'utf8'));

describe('golden courses', () => {
  test('the golden set includes seed 0 and the largest seed', () => {
    expect(pairs.some((p) => p.seed === 0)).toBe(true);
    expect(pairs.some((p) => p.seed === 4294967295)).toBe(true);
  });

  for (const pair of pairs) {
    test(pair.name, () => {
      const golden = JSON.parse(readFileSync(new URL(`${pair.name}.json`, dir), 'utf8'));
      expect(golden.generatorVersion, 'snapshot is from another generator version: run `bun run golden`').toBe(GENERATOR_VERSION);
      const result = generateCourse(pair.recipe, pair.seed);
      expect(result.ok).toBe(true);
      // Structural comparison first for a readable diff, then the exact bytes and hash.
      expect(JSON.parse(canonicalJSON(result.course))).toEqual(golden.course);
      expect(canonicalJSON(result.course)).toBe(canonicalJSON(golden.course));
      expect(courseHash(result.course)).toBe(golden.hash);
    });
  }
});
