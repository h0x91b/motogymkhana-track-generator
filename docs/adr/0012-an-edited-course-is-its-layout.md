# An edited course is its layout, routed by the generator's rules; broken rules become problems

Adds manual editing, which ADR 0003 ruled out of v1 and deferred "to a later editor stage". A generated course is still a pure function of recipe + seed. Once edited in «Правка» it is not: its source of truth is a **layout** — the recipe, the seed and the elements in route order, each with its type, nominal sizes, axis, mirroring and anchor on whole metres.

`routeLayout(layout)` turns a layout back into a course. It puts every element exactly where the layout says and runs the start, the connectors with their U-turn cones and the finish with the generator's own functions and rules, so an edited course is ridden, drawn and laid out like a generated one. It is a pure function with no search over placements and no randomness: the layout of a generated course gives that course back byte for byte, which the tests hold over all three shapes, both bike classes and «паровозик».

Where a rule cannot be kept the course is still built, and the rule comes back as a **problem** (which rule, which elements, which connector, what to do). An editor has to show an element where the user put it, not refuse the move or silently shift it; the user fixes the problem or leaves it. For a connector with no rule-abiding path the least bad one is drawn: on the site first, then out of zones, then loop-free.

Sizes are kept nominal (metres in 0.5 m steps, counts, angles) and mapped onto the lattice of the axis class on every routing, so turning an element onto a diagonal and back does not drift (ADR 0005). Turning and mirroring keep the middle of the zone as a pivot for the same reason. Size ranges are wider than the difficulty table and include it; minimums that follow from the bike class (ADR 0006) are never undercut.

Undo, redo and storage keep layouts and nothing else. The edited layout is stored under its own versioned localStorage key and shown again only for the recipe and seed it was made from; a new course replaces it, and «↶» brings it back with its form. Sharing stays image-only (ADR 0003).

## Considered Options

- Pin elements and regenerate the rest: keeps "pure function of inputs", but the user cannot put an element where they want it, and every pin changes everything else. Rejected: it is a different generator, not an editor.
- Edit cones freely: the most power, but an element stops being an instance of a catalog type, so sides, passes, the ride line, zones and the setup sheet's dimensions lose their meaning. Rejected for now.
- Refuse or auto-correct a move that breaks a rule: simpler to render, but dragging an element through a crowded site becomes a fight with the tool. Rejected in favour of problems.
- Let the user draw connectors too: deferred; routing them by the rules is what keeps an edited course rideable.
