# Single cones are free-heading waypoints

Amends ADR 0024. A «Конус слева» 6 m past a gate made the connector loop round and run through the next element: the passed cone was a rigid 3 m straight along the element's axis, so the route had to arrive and leave along that axis whatever the course around it wanted. The rule a rider rides by is only the side: «Конус слева» has the cone on the rider's left, «Конус справа» on the right, passed at about `WEAVE` (1 m); nothing forces a heading, a turn or a straight.

**A free heading.** `pass-left`, `pass-right` and `small-turn` are `freeHeading` types (`FREE_HEADING_TYPES`): their axis is the route's, not the layout's. A passed cone is a point (`point`: path `[p, p]`, no run-in, run-out or ends) beside the cone at `max(WEAVE, pad + 0.05)`; the small U-turn is the 180° arc round its cone on its side, at least the class radius, entered from whichever way the route comes. The pivot turn stays fixed: making it free is one flag, but it would change dealt courses widely, so it is left for its own decision.

**The heading is chosen the same way in the generator and in `routeLayout`.** Candidates are the 16 axes (22.5° apart), ordered by the unconstrained Dubins length from the previous exit to the entry plus from the exit to the next pose, ties to the heading nearest the bearing and then to the index; at most `FREE_TRIES` (6) are tried. The first that gives final legs without problems wins, else the one with the fewest. "First valid in a fixed order" is monotone like `connect()`, so `routeLayout(layoutOf(course))` is the course again. A free element's out-leg is only checked when the next element is fixed; free elements after it are not obstacles yet, in both. The generator fixes a free element's heading when it evaluates the next candidate (it rewires that element's placement, leg and zones); until then it carries a stand-in. The legs are joined at the point as detours are (ADR 0015), so no U-turn cone is merged across the join: the passed cone itself marks the turn.

**Start and finish stay on the grid.** A free first or last element can face a half step, and the start or finish line before or past it is turned with it. Its first cone stays on whole metres and every other cone goes to the nearest point of the 0.5 m grid, so the line is a few degrees off square to the element but every cone of a course is set out with a tape from the reference corner; the same holds for a start or finish turned a half step in «Правка».

**Old axes are ignored.** Layouts and files that store an axis for these types load as they are; the axis is kept but does not change the course. «Правка» shows no angle and no turn buttons for them, only what they are ridden like; mirroring still swaps the side.

**«Опорная точка» (waypoint).** The same machinery without a cone: a point the user puts on the plan in «Правка» (a row of its own in the element list, «вставить под» or a long press on the plan, nearest connector decides the place), the route passes through it with a free heading. It is not in the cone inventory, the cone tables or the CSV; the plan, 3D and the PNG draw a small diamond, the sheet lists it as a route note. The generator never places one. A file with a waypoint is version 3 (ADR 0013: an older build cannot read it).

Measured on the tester's 40 × 38 m medium sport 6 (default form, `scripts/bench.mjs`, seeds 1–100): 5.10 → 5.14 elements placed of 6, about 30% more time per course.

## Considered Options

- Keep the straight and only allow more axes for it — the 3 m straight still forces a heading the course may not want, and a free circle would still be needed for a tight approach.
- Choose the heading after the search, as a post-pass — the search would check connectors that change afterwards, and the round trip through `layoutOf` would need the post-pass in `routeLayout` too.
- Search every heading for every free element jointly — exact, but exponential in a row of fillers and far over the test budget.
- A waypoint as a recipe or layout property beside the elements — it would need its own ordering and list; as an element row it rides the existing list, undo and file.
