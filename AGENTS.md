# AGENTS.md — motogymkhana-constructor

`CLAUDE.md` is a symlink to this file. Edit `AGENTS.md` only.

Mobile-first generator of motogymkhana training courses: form + seed → course → plan / 3D view → one tall setup-sheet PNG shared in a chat.

## Read before changing anything

- [`SPEC.md`](./SPEC.md) — the v1 spec, source of truth for scope and behaviour.
- [`CONTEXT.md`](./CONTEXT.md) — the domain glossary. Use its terms in code, UI and commits; English names in parentheses are the code identifiers. If a new domain concept appears, add it there.
- [`docs/adr/`](./docs/adr/) — decisions that must not be silently reversed. A new hard-to-reverse decision gets a new ADR.
- [`docs/reference/`](./docs/reference/) — the 3D prototype the renderer is based on, and the original (broader, partly superseded) handoff. Where the handoff and `SPEC.md` disagree, `SPEC.md` wins.

## Conventions

- Code, comments, commits and ADRs in English; the UI is in Russian (metres, decimal comma).
- Bun only, zero npm dependencies (the public npm registry is blocked on this machine). Source is ES modules, bundled by a Bun script into one self-contained HTML file.
- Generation draws only from the seeded PRNG streams (`prng.js`): no `Math.random`, time or system randomness inside generation, so the same recipe and seed repeat within one build and engine («↶», the simplification rule and the invariant tests rely on it). Cross-engine byte identity, golden snapshots and a generator version are gone (ADR 0009); any `Math` function is fine.
- Verify UI changes in a real browser (agent-browser, narrow portrait viewport).
- Published at https://github.com/h0x91b/motogymkhana-track-generator, branch `master`. Every push to `master` runs the tests, builds and deploys `dist/` to GitHub Pages (`.github/workflows/pages.yml`). Push only with the user's go-ahead.

## Commands

- `bun test` — unit tests (the generator seam `generateCourse`, the setup-sheet seam `buildSetupSheet`, the editor seam `routeLayout` and the file seam `readCourseFile`/`conesCsv`): repeatability, invariants and statistics over many seeds.
- `bun run build` — writes the single self-contained `dist/motogymkhana-constructor.html` (and `dist/index.html`), stamped with the build id (short commit hash + date) shown in the form.
- `bun scripts/bench.mjs` — mean elements placed over seeds 1–100 for the field tester's lots and the default course.
- `bun run dev` — dev server on `PORT`/`DEV3_PORT` (default 5173), bound to all interfaces for testing on a phone.

## Layout

- `src/generator/` — recipe and seed parsing, PRNG streams, catalog of element types, Dubins connectors, search, canonical JSON, and `layout.js`: the editor's model (a layout, its edits, `routeLayout`). Public API in `index.js`.
- `src/file/` — the course file (`.json`, ADR 0013) and the cone table (`.csv`), no DOM.
- `src/sheet/` — setup-sheet data model. `src/render/` — canvas scene (plan/3D) and the setup-sheet PNG.
- `src/app/` — UI, storage, worker, HTML template and CSS; `editor.js` is «Правка» (edit panel, type picker, undo history). `scripts/` — build and dev server.
