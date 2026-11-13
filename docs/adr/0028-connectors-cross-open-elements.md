# Connectors may cross the line of an open element; only its cones block

Amends ADR 0016. The field tester put a 360° pivot turn («Вращение») after a keyhole and «Правка» reported «Связка 2 → 3 проходит через элемент 3»: the connector into the pivot ran inside its free circle and crossed the line ridden round the cone. Connectors were already tested against footprints, not the zone rectangle (ADR 0016), but the footprint takes in a ZONE_PAD band round the ridden line, and round one cone that line is a ring the route wants to pass through. On the asphalt nothing is there: no wall, no chalk, only the one cone. The organiser's rule is that a turn round one cone is radial, so riding across its circle is fine; what a rider must not hit is a cone.

**Open and bounded elements.** A catalog type is open (`crossable: true`, `CROSSABLE_TYPES`) when it is laid out round one cone with no walls: the pivot turn, the small U-turn, «Конус слева» and «Конус справа», and the waypoint. Every other type is bounded: slaloms, gates, the box, the U-turn with its walls, the keyhole, the snail, eights, circles, the gate turn and the rest keep their ridden line out of the route's way, because there the line is a corridor between cones or the inside of a figure the rider rides once.

**The barrier.** A placed element carries, next to its footprint, the `barrier` the route keeps out of: the footprint itself for a bounded element, only its cone discs (the same pad round each cone) for an open one. Connectors, detours and every element's run-in and run-out are checked against barriers (`barrierOf`, in `pathClear`, `zoneClear` and `clash`), in the generator and in `routeLayout` alike, so a layout taken from a generated course still routes back to it. Element against element is unchanged: two footprints may not overlap, so no other element's cones or lines stand on an open element's line, and the pivot's free circle still keeps out every other cone (ADR 0025). A connector's U-turn cone keeps its disc out of the whole footprint: a cone is placed, and it must not stand on a line someone rides. Run-off zones stay free asphalt the route may cross.

**«Паровозик» is untouched.** In a train the route still may not cross itself (`trainClear`), so a connector across a pivot's ring is a `connector-train` problem there, as before it was a zone problem.

**The plan shows the footprint.** An element with a problem is marked by its footprint outline in red (the outline the reserved-zones layer traces), not by its zone rectangle: the rectangle never was what blocks, and red empty corners read as the cause. A connector through another element marks that element too, not only the two it joins.

Measured with `scripts/bench.mjs` (seeds 1–100): the tester's 40 × 38 medium sport 6 5.14 → 5.12, every other bench recipe unchanged, the time per course the same. The generator rarely needs the ring: it reaches a pivot turn on an axis that faces the way in. The change is for courses laid out by hand.

## Considered Options

- Footprint as the barrier for every type (as before) — reports a problem the organiser does not have, and makes the organiser move a pivot turn away from where the route naturally runs.
- Drop the ridden line from an open element's footprint altogether — would also let other elements' cones and lines stand on the ring, which a rider would then hit while turning.
- Classify by geometry (one cone, no `lines`) instead of a catalog flag — implicit, and would silently make any future one-cone figure with a fixed line crossable; the flag says it where the type is defined.
- Let connectors cross bounded elements' lines too, away from cones — a slalom or a box would then be ridden through sideways mid-figure; not what the rules allow.
