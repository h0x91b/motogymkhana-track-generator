# Single-cone elements fill the gaps a course leaves

A field organiser fills the empty asphalt between real elements with one tall cone: pass it on the left or right («Конус слева» / «Конус справа»), turn back round it («Малый разворот»), or go fully round it («Разворот на месте»). The generator used to simplify such a course to fewer elements instead. These are now catalog types (`pass-left`, `pass-right`, `small-turn`), and the pivot turn is the fourth of the family (`SINGLE_CONE_TYPES`).

**«Разворот на месте» is the pivot turn, not a new type.** The pivot turn already is a full turn of 270°, 360° or 720° round one tall cone on the class radius; a «lighter variant» would differ only in its name. So one concept, one type (`pivot-turn`, «Вращение»); what changes is how it is shown: its cone is red with a yellow stripe, as it stands on the asphalt. That is the one tall cone whose colour is not its side (`passColor`: a pass of more than 180° round a cone is `striped`); the direction is on the card and the line.

**No walls, the class radius is a minimum.** The rider picks the line round one cone, so the element is the cone and the line ridden on at least the class radius (the U-turn radius for the small U-turn, as for the pivot turn); a wider line is fine. A cone passed by turns nothing itself: the connectors turn as the route needs, 0–90° and more, on at least the class radius. The side of a passed cone is its type, so it is never mirrored; mirroring it in «Правка» makes it the other one.

**Smaller run-off.** A small U-turn and a pivot turn keep half the recipe's run-off (`SINGLE_CONE_RUN_OFF`, 2.5 m at the default 5 m, on the option's 0.5 m step); a passed cone has none. An element's own run-off in «Правка» (ADR 0014) is taken as set.

**Fillers, never instead of real elements.** The pass and small-turn types are not dealt as a course's own elements. When the search finds a course with k of its own elements below the m ordered, it searches again for m elements with up to m − k fillers, at most a third of the course (`fillerLimit`); positions past the first k try a filler first, earlier ones only after every dealt type has failed there. k stays the floor, and simplification keeps its rule: (N, seed) simplified to K equals (K, seed), fillers included. The pivot turn is dealt as before and fills gaps too. In «паровозик» the small U-turn is a looped type like the pivot turn; passed cones are allowed.

Measured on the tester's 40 × 38 m medium sport 6 (default form, `scripts/bench.mjs`, seeds 1–100): see the PR report; elements placed rise and the plain-course count never drops, at the cost of one more search where a course came out short.

## Considered Options

- Fillers dealt like any type — three of 23 types, so about one element in eight would be a lone cone even on a roomy site where a real element fits.
- A post-pass inserting fillers into the finished course (as «Правка» inserts) — keeps the plain course, but every insertion reroutes connectors the search did not check, and a closed or «return» course would have to be closed again; not tried.
- A separate «lighter» full turn beside the pivot turn — two names for one exercise on the sheet.
- One `pass-cone` type whose mirroring is the side — the side would hide behind a flag and the picker could not offer «Конус слева» and «Конус справа».
