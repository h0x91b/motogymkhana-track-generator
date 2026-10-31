# AGENTS.md — motogymkhana-constructor

`CLAUDE.md` is a symlink to this file. Edit `AGENTS.md` only.

Mobile-first generator of motogymkhana training courses: form + seed → deterministic course → plan / 3D view → one tall setup-sheet PNG shared in a chat.

## Read before changing anything

- [`SPEC.md`](./SPEC.md) — the v1 spec, source of truth for scope and behaviour.
- [`CONTEXT.md`](./CONTEXT.md) — the domain glossary. Use its terms in code, UI and commits; English names in parentheses are the code identifiers. If a new domain concept appears, add it there.
- [`docs/adr/`](./docs/adr/) — decisions that must not be silently reversed. A new hard-to-reverse decision gets a new ADR.
- [`docs/reference/`](./docs/reference/) — the 3D prototype the renderer is based on, and the original (broader, partly superseded) handoff. Where the handoff and `SPEC.md` disagree, `SPEC.md` wins.

## Conventions

- Code, comments, commits and ADRs in English; the UI is in Russian (metres, decimal comma).
- Bun only, zero npm dependencies (the public npm registry is blocked on this machine). Source is ES modules, bundled by a Bun script into one self-contained HTML file.
- The generator is deterministic: no `Math.random`, time or system randomness inside generation. Any change that alters generated courses bumps the generator version.
- Verify UI changes in a real browser (agent-browser, narrow portrait viewport).
- Do not create the GitHub repo, push, or enable GitHub Pages without the user's explicit go-ahead.
- Generator code (`src/generator/`) uses only engine-independent arithmetic: no `Math.sin/cos/atan2/pow`, no `**` — use `dmath.js` (ADR 0004).

## Commands

- `bun test` — unit tests (the generator seam `generateCourse` and the setup-sheet seam `buildSetupSheet`).
- `bun run build` — writes the single self-contained `dist/motogymkhana-constructor.html` (and `dist/index.html`).
- `bun run dev` — dev server on `PORT`/`DEV3_PORT` (default 5173), bound to all interfaces for testing on a phone.
- `bun run golden` — rewrites golden snapshots; refuses when a course changed but `GENERATOR_VERSION` did not.
- `#selfcheck` on the built page regenerates the golden pairs in that browser and compares hashes.

## Layout

- `src/generator/` — recipe and seed parsing, PRNG streams, catalog of element types, Dubins connectors, search, canonical JSON. Public API in `index.js`.
- `src/sheet/` — setup-sheet data model. `src/render/` — canvas scene (plan/3D) and the setup-sheet PNG.
- `src/app/` — UI, storage, worker, HTML template and CSS. `scripts/` — build, dev server, golden updater.
