// The default `bun test` checks every rule on a small, fixed sample of seeds and
// stays fast enough to be the required PR check. `SLOW=1 bun test` runs the full
// sweeps over hundreds of seeds and the statistical tests (means, ratios, counts
// over many courses), which only mean something on a large sample.

import { test } from 'bun:test';

export const SLOW = process.env.SLOW === '1';

// A sweep that takes a second alone takes several with every core busy: the
// slow suite gives each test a minute instead of the default 5 s (preload.js),
// and ten times any timeout a test sets itself (`timeout`).

/** A test's own timeout, in ms: ten times as long in the slow suite. */
export const timeout = (ms) => (SLOW ? 10 * ms : ms);

/** `full` in the slow run, `fast` in the default one. */
export const sweep = (full, fast) => (SLOW ? full : fast);

/** A test that only runs in the slow suite: a statistic over many seeds. */
export const slowTest = test.skipIf(!SLOW);

/**
 * Seeds `from` to `from + n - 1` in the slow run, the `fast` list in the default
 * one. Generation time varies tenfold between seeds of one recipe, so the fast
 * list names cheap seeds that still show what the test checks.
 */
export const seeds = (n, fast, from = 1) => (SLOW ? Array.from({ length: n }, (_, k) => k + from) : fast);
