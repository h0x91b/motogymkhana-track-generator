# Cutouts and obstacles are rectangles in the recipe; the margin applies to their edges

Field testers' lots are not empty rectangles: one is П-shaped, another has a car parked on it. A lot is now the site rectangle minus **blocked areas** (`recipe.blocked`): up to 8 axis-aligned rectangles on whole metres, each a **cutout** (no asphalt there) or an **obstacle** (something standing on the asphalt). They are recipe fields, so recipe + seed still give one course (ADR 0002, 0009), and a layout carries them with its recipe (ADR 0012).

For the generator both kinds are the same thing. The site margin (`safetyOf(recipe).edge`) is kept from their edges as from the lot's: cones, element lines and connectors stay out of the rectangle grown by the margin, while a run-off zone, a U-turn cone's footprint and a start or finish line's waiting area only stay out of the rectangle itself (tested as footprint shapes against it) — they may reach into the margin, as at the lot's edge (ADR 0007). The kinds differ only in how they are drawn and named.

Three changes make the search work on a cut lot rather than merely refuse it:

- **Free rectangles.** A type is feasible, and its drawn sizes fit, only if the element fits one maximal rectangle of free asphalt (with its margin and run-off zone). Without this the type deck keeps dealing turning elements that fit 40 × 38 but no leg of the П, and the budget runs out on them.
- **Detours.** A Dubins connector cannot go round anything. When the straight way between two poses is blocked, the connector may be two Dubins paths joined at a waypoint one turning radius off a corner of a blocked area's margin, passing it along a side; every connector rule (turn limit, U-turn cones, «паровозик») holds for the joined path.
- **Layout targets** that fall in a blocked area move just past its nearest side.

All three only run when the recipe has blocked areas: a plain rectangle is generated exactly as before (a test holds it), so the benchmark recipes keep their numbers.

In «Правка» blocked areas are added, dragged, resized and removed like elements. They describe the lot, not the course, so each such edit is also written into the recipe form — without generating — so the next course on the same lot keeps them.

## Considered Options

- Arbitrary polygons: the real shape of any lot, but nothing in the form or on a phone to draw one with, and every rule would need polygon clipping. Rejected for now; rectangles cover a П, an L, a cut corner and a parked car.
- A grid of blocked cells: easy to test against, but entering a 12 × 22 m cutout cell by cell is unusable, and a cell size is one more thing to choose.
- Cutouts only from the edge, obstacles as circles: two models for one rule. Rejected; a pillar is a 1 × 1 m obstacle.
- Obstacles kept out of the recipe, as edits only: the course would no longer follow from recipe + seed, and a new seed would forget the parked car.
