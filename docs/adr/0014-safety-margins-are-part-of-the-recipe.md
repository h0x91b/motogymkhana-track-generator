# Safety margins are part of the recipe, and an element can set its own

The free asphalt the generator keeps — run-off round turning elements (ADR 0007), the zone pad round every element, the keep-out round a connector's U-turn cone, the «паровозик» route clearance and the lot edge margin — used to be constants. A field tester with a 40 × 38 m lot could not fit what he wanted and asked to switch them off and pack elements by hand. So they are now `recipe.safety`: five distances in metres on their own steps, 0 switching a rule off. The defaults are the old constants, and a recipe keeps only the values off their defaults, so a recipe without the field is the old recipe and gives the same course byte for byte.

In «Правка» an element can set its own run-off and pad over the recipe's (`element.safety` in the layout); `routeLayout` builds it with them, its card on the setup sheet says so, and problems quote the margin actually broken. The connector rules (cone keep-out, train clearance) and the edge stay course-wide: they are about the route and the lot, not one element.

Outside «паровозик» there is no route-to-route distance — connectors cross by design, one rider at a time — so the non-train «gap between route pieces» is the U-turn cone keep-out, and the train one is the train clearance, whose same-stretch window (TRAIN_NEAR) grows to twice the clearance so a wider clearance does not fail every turn.

The lot edge margin is `safetyOf(recipe).edge`, the one source for anything set back from the edge of the asphalt (lot cutouts and obstacles included, when they come).

Narrowing a margin is the organiser's call and the course says it on the sheet («Безопасность не по умолчанию: …»): the image is all a rider sees (ADR 0003).

Measured, mean elements placed over seeds 1–100 (`scripts/bench.mjs`): the tester's 40 × 38 m medium sport closed «паровозик» 6 goes 3.14 at defaults → 3.22 at run-off 2 m → 3.20 at 0, and 3.44 with run-off 0, pad 0.25 m and train clearance 1.5 m. On that lot the closed shape and the train check cost more than the run-off: open without «паровозик» goes 3.67 → 4.55 at run-off 0 (40 seeds).

## Considered Options

- A single «tight mode» switch — simplest, but the tester needed the edge kept for kerbs while the run-off went, and a switch cannot say which.
- Per-element overrides for every margin — the cone keep-out and the train clearance belong to connectors, not elements; overriding them per element has no clear meaning.
- Keeping the margins but letting the editor ignore them — the problems would stay red on a course the organiser chose deliberately, and the generator could not help pack it.
