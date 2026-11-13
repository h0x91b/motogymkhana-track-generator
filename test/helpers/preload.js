// Loaded before every test file (bunfig.toml), so the slow suite's longer
// default timeout reaches every file, not only those that import slow.js: a
// test that takes a second alone takes several while the sweeps keep every
// core busy, and a fast-suite file would time out at bun's 5 s.

import { setDefaultTimeout } from 'bun:test';

if (process.env.SLOW === '1') setDefaultTimeout(60_000);
