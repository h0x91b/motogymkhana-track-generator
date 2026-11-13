# AGENTS.md — motogymkhana-constructor

`CLAUDE.md` is a symlink to this file. Edit `AGENTS.md` only.

Mobile-first generator of motogymkhana training courses: form + seed → course → plan / 3D view → one tall setup-sheet PNG shared in a chat.

## Read before changing anything

- [`SPEC.md`](./SPEC.md) — the v1 spec, source of truth for scope and behaviour. It is a table of contents; the text lives in [`docs/spec/`](./docs/spec/), one file per area (`find docs/spec -name '*.md' | sort | xargs cat` reads it all in order).
- [`CONTEXT.md`](./CONTEXT.md) — the domain glossary. Use its terms in code, UI and commits; English names in parentheses are the code identifiers. If a new domain concept appears, add it there, in its alphabetical place within the section.
- [`docs/adr/`](./docs/adr/) — decisions that must not be silently reversed. A new hard-to-reverse decision gets a new ADR; the directory listing is the index, nothing lists ADRs by hand.
- [`docs/reference/`](./docs/reference/) — the 3D prototype the renderer is based on, and the original (broader, partly superseded) handoff. Where the handoff and `SPEC.md` disagree, `SPEC.md` wins.

## Conventions

- Code, comments, commits and ADRs in English; the UI is in Russian (metres, decimal comma).
- Bun only, zero npm dependencies (the public npm registry is blocked on this machine). Source is ES modules, bundled by a Bun script into one self-contained HTML file.
- Generation draws only from the seeded PRNG streams (`prng.js`): no `Math.random`, time or system randomness inside generation, so the same recipe and seed repeat within one build and engine («↶», the simplification rule and the invariant tests rely on it). Cross-engine byte identity, golden snapshots and a generator version are gone (ADR 0009); any `Math` function is fine.
- Verify UI changes in a real browser (agent-browser, narrow portrait viewport).
- Published at https://github.com/h0x91b/motogymkhana-track-generator, branch `master`. Every push to `master` runs the tests, builds and deploys `dist/` to GitHub Pages (`.github/workflows/pages.yml`). Push only with the user's go-ahead.

## Commands

- `bun test --parallel` (`bun run test`) — unit tests (the generator seam `generateCourse`, the setup-sheet seam `buildSetupSheet`, the editor seam `routeLayout` and the file seam `readCourseFile`/`conesCsv`): repeatability and every invariant, on a few seeds per recipe. The required PR check, and it must stay under 20 s on CI: `--parallel` runs the test files in one worker per core (a few seconds; plain `bun test` runs them one after another, about 8 s). A new seed sweep or statistic goes through `sweep`/`slowTest` from `test/helpers/slow.js`.
- `SLOW=1 bun test --parallel` (`bun run test:slow`) — the full sweeps over hundreds of seeds and the statistical tests (means, ratios, counts over many courses); several minutes. Not a PR check: the `Slow tests` workflow (`.github/workflows/slow.yml`) runs it after every push to `master` and nightly, not required for merging, so a regression shows up as a red run there; still run it by hand after a change to the generator. Under it every test gets a minute (`test/helpers/preload.js`); a test that can take longer than a few seconds sets its own with `timeout()` from `test/helpers/slow.js`.
- `bun run build` — writes the single self-contained `dist/motogymkhana-constructor.html` (and `dist/index.html`), stamped with the build id (short commit hash + date) shown in the form.
- `bun scripts/bench.mjs [--seeds N] [file.json | '{recipe}' ...]` — mean elements placed over seeds 1–N (default 100); `key=value` arguments set `recipe.safety` for every recipe; without recipe arguments, the recipes in `scripts/bench-recipes.json`. Pass your recipe as an argument instead of editing the script.
- `bun scripts/new-adr.mjs <slug> [--number N]` — creates `docs/adr/NNNN-<slug>.md` with the next number not used on this checkout or any origin branch (so not in an open PR either), or checks the assigned one.
- `bun run dev` — dev server on `PORT`/`DEV3_PORT` (default 5173), bound to all interfaces for testing on a phone.

## Working in parallel

Several agents work on this repo at once, each in its own PR. Keep the PRs from colliding:

- Before starting, run `gh pr list` and look at the files the open PRs touch (`gh pr view <N> --json files`). If one is changing the same code, say so to whoever coordinates instead of racing it.
- Shared scaffolding — a new script, helper, test fixture or module several tasks need — lands first as its own small PR. Never create a file that another open PR is also creating; reuse it once it is merged, or ask.
- ADR numbers: the coordinator assigns the number in the brief; create the file with `bun scripts/new-adr.mjs <slug> --number N`. Without an assigned number, run it without `--number` and mention the number in the PR.
- Docs: a change to the spec goes into its area file under `docs/spec/`; a new area is a new file plus one line in `SPEC.md`. A new glossary term goes in its alphabetical place in `CONTEXT.md`, with blank lines around it. Never append to a shared list just because the end is convenient.
- Rebase onto `origin/master` right before opening the PR (and again if it falls behind), then rerun `bun test`.

## Layout

- `src/generator/` — recipe and seed parsing, PRNG streams, catalog of element types, Dubins connectors, search, canonical JSON, and `layout.js`: the editor's model (a layout, its edits, `routeLayout`). Public API in `index.js`.
- `src/file/` — the course file (`.json`, ADR 0013) and the cone table (`.csv`), no DOM.
- `src/sheet/` — setup-sheet data model. `src/render/` — canvas scene (plan/3D) and the setup-sheet PNG.
- `src/app/` — UI, storage, worker, HTML template and CSS; `editor.js` is «Правка» (edit panel, type picker, undo history). `scripts/` — build, dev server, bench and `new-adr`. `docs/spec/` — the spec text behind `SPEC.md`.
