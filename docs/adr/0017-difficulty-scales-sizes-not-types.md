# Difficulty scales element sizes, never the set of element types

Easy, medium and hard used to differ in two ways: in the sizes inside elements and in which types the generator could use — the snail, the licence-test eight and the keyhole were kept off easy courses (`TYPE_LEVELS`), and ticking only them at easy was a types error. The organiser wants a beginner to ride every figure, just a roomier one, so difficulty now changes only sizes: slalom pitches, gate and corridor widths, offsets and the margin added to the U-turn radius (easy +1 m, medium +0.5 m, hard 0). Every type has a row at every difficulty in `DIFFICULTY_TABLE`, and the type checkboxes are the only filter (with «паровозик», which drops looped types for a different reason).

The three types that had no easy row get one by stepping once more from hard to medium: easy = medium + (medium − hard), on the 0.5 m lattice. The snail's corridor is 3 m (2.5 medium, 2 hard), the licence-test eight's gate 3.5 m (3, 2.5), the keyhole's opening 3 m (2.5, 2; still capped at the ring radius less 1 m). The licence-test eight's centre distance and box (6 m, 13 × 8 m) are exam sizes and stay the same at every difficulty, as they already were at medium and hard; the keyhole ring is set by the bike class, as before.

The cost is fill on easy: the big snail and licence-test eight now compete for space there. Mean elements placed over seeds 1–100 (`scripts/bench.mjs`), before → after: 40 × 38 m easy sport open 6, 3.84 → 3.56; closed «паровозик» 6, 3.18 → 3.03; 40 × 60 m easy cruiser open 8, 5.66 → 5.51; closed «паровозик» 8, 4.15 → 4.26. Medium is unchanged.

## Considered Options

- Keep gating the three types at easy — the difference between levels would stay partly in *what* is ridden, which is not how the organiser grades a group.
- Easy rows as a fixed multiple of hard (×1.5, rounded to 0.5 m) — gives a 3 m snail corridor but a 4 m eight gate and a 3 m keyhole opening above the cap; extending the existing medium-to-hard step keeps the three levels evenly spaced, as the other rows are.
- Hide the three types at easy in the form but let the recipe ask for them — two sources of truth for the same rule.
