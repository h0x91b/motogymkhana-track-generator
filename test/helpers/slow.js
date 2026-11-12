// The default `bun test` checks every rule on a small, fixed sample of seeds and
// stays fast enough to be the required PR check. `SLOW=1 bun test` runs the full
// sweeps over hundreds of seeds and the statistical tests (means, ratios, counts
// over many courses), which only mean something on a large sample.

import { test } from 'bun:test';

export const SLOW = process.env.SLOW === '1';

/** `full` in the slow run, `fast` in the default one. */
export const sweep = (full, fast) => (SLOW ? full : fast);

/** A test that only runs in the slow suite: a statistic over many seeds. */
export const slowTest = test.skipIf(!SLOW);
