# U-turns inside elements are sized by the bike class; figure-eight loops are circles

**Superseded in part by [ADR 0021](./0021-open-figures-cone-spacing-from-difficulty.md):** the figure eight's cones no longer stand at its loop centres; they stand the difficulty table's distance apart, and the class radius sizes only the loops.

Connectors already turn no tighter than the bike class allows (Ø 9 m on a cruiser, Ø 7.5 m on a sport bike), but the U-turns inside elements came from the difficulty table: a 6 m hard U-turn, a 1.5 m pivot line, 2–2.5 m mirror and gate-turn loops. A cruiser cannot ride those, and the organiser's field figures (a real U-turn is Ø 9 m on a cruiser, 7–8 m on a sport bike) say the same. So the bike class sets the minimum radius of every U-turn inside an element — U-turn, box, pivot turn, mirror, gate turn and the figure eight's loops — and the difficulty only adds margin to that radius: +1 m easy, +0.5 m medium, 0 hard (`uTurnRadius`). The figure eight's loops become circles round their cones instead of ellipses stretched along the centre line (which reverses the original user story); its base follows from the circles, D = 2√2 r, so the crossing lines meet at right angles. On a diagonal these sizes take the nearest lattice length that is not smaller. Slaloms, zigzag, corridors and the other types keep their difficulty sizes; the licence-test box eight keeps its exam sizes and its oval loops.

Consequence: these elements are much larger (a hard cruiser U-turn or box is 11 m wide, a figure eight 13 m between cones), the figure eight is always a big element and a box, pivot turn, mirror or gate turn often is, so fewer elements fit a given site.

## Considered Options

- Keep difficulty sizes and only warn — courses would keep turns a cruiser cannot ride.
- Bike class picks among the old difficulty tables — the hard and medium tables are still far below Ø 9 m.
- Elliptical eight loops whose narrow end respects the class — the loops would be longer still for the same minimum radius, and an organiser lays out a circle with one tape.
