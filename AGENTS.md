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
