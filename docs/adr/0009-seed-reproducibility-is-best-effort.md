# A seed repeats a course only within one build and engine; cross-engine identity is dropped

Supersedes ADR 0004 and the reproducibility framing of ADR 0002 and 0003 ("two people get the same course from the same recipe and seed on any phone").

Courses are shared only as an image (ADR 0003), and old generator versions were never frozen, so retyping a seed on another phone was a guarantee no workflow used. Keeping it cost hand-written trigonometry (`dmath.js`), a ban on `Math.*` and `**` in the generator, golden snapshots that had to be regenerated with a `GENERATOR_VERSION` bump on every course-changing commit, and a `#selfcheck` page comparing hashes across browsers. All of that is gone.

The seed stays as a handle for browsing («Новый seed», «↶») and for tests: generation still draws only from the seeded PRNG streams, never from `Math.random`, time or system randomness. So the same recipe and seed give the same course within one build on one engine, which «↶» (it regenerates a previous seed), keeping the view for an unchanged course and the simplification rule rely on. Across browsers or builds a seed may give a different course, and that is expected. The generator may use any `Math` function. Correctness is guarded by invariant and statistics tests over many seeds and an in-process repeatability test, not by snapshots. The UI shows the build (short commit hash and date) instead of a generator version.

Replacing `dmath.js` with `Math.*` changed 3 of the 7 former golden courses, each by 1 cm rounding noise in a published coordinate.

## Considered Options

- Drop seeds altogether and use `Math.random`: «↶», view keeping and the simplification rule would each need a replacement (cached courses), for no user gain.
- Keep the strict contract and only relax the docs: the per-change version-bump and golden tax would stay, and it was the main cost.
- A wall-clock or adaptive search budget, which this decision makes thinkable: deferred. It would also break same-device repeatability, so «↶» would have to keep course objects; it needs its own decision and a measurement.
