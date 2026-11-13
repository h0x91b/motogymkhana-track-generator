// The default `bun test` checks every rule on a small, fixed sample of seeds and
// stays fast enough to be the required PR check. `SLOW=1 bun test` runs the full
// sweeps over hundreds of seeds and the statistical tests (means, ratios, counts
// over many courses), which only mean something on a large sample.

import { setDefaultTimeout, test } from 'bun:test';

export const SLOW = process.env.SLOW === '1';

// A sweep that takes a second alone takes several with every core busy: the
// slow suite gives each test a minute instead of the default 5 s, and ten
// times any timeout a test sets itself (`timeout`).
if (SLOW) setDefaultTimeout(60_000);

/** A test's own timeout, in ms: ten times as long in the slow suite. */
export const timeout = (ms) => (SLOW ? 10 * ms : ms);

/** `full` in the slow run, `fast` in the default one. */
export const sweep = (full, fast) => (SLOW ? full : fast);

/** A test that only runs in the slow suite: a statistic over many seeds. */
export const slowTest = test.skipIf(!SLOW);
