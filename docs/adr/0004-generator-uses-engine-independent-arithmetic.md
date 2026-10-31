# The generator uses only engine-independent arithmetic

Two people must get the same course from the same recipe and seed on any phone (ADR 0003), but ECMAScript leaves `Math.sin`, `Math.cos`, `Math.atan2`, `Math.pow`, `**` and most other `Math` functions "implementation-approximated": V8 (Chrome) and JavaScriptCore (Safari) may differ in the last bit, which is enough to flip a geometric comparison during the search and produce a different course. So generation code under `src/generator/` uses only the operations IEEE 754 rounds exactly — `+ - * /`, `Math.sqrt`, `Math.round`, `Math.floor`, `Math.ceil`, `Math.abs`, `Math.imul` and integer bit operations — and gets its trigonometry from `dmath.js` (range reduction plus fixed polynomials built from those operations). Cones are stored as integer half-metres; trajectories are rounded to 1 cm only when published. The golden hashes are produced under Bun (JavaScriptCore) and re-checked in Chromium (V8) by the `#selfcheck` page.

## Considered Options

- Use `Math.*` and round every coordinate — rounding hides most last-bit differences in the output, but not the ones that change a search decision (an overlap test, a score tie), so courses could still diverge.
- Fixed-point integer geometry throughout — fully exact, but arcs, Dubins connectors and ellipses become awkward and slow to write; the exact-float subset gives the same guarantee for far less code.
