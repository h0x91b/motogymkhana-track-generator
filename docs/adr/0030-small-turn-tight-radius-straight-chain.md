# A small U-turn goes down to 3 m on any bike and is ridden straight into and out of

An organiser lays a small U-turn («Малый разворот») as one tall cone in the gap between real elements: the rider comes past, turns back round it and rides on into the next element. On the asphalt that turn is tighter than a connector: a 40 × 52 m course from the field turns round a lone cone beside a slalom, under a crescent, where no turn on the cruiser's 4.5 m class radius fits. ADR 0027 held the small U-turn to at least the class radius, and its way out could only meet the next element through a Dubins connector on the class radius unless the next entry was within CHAIN_REACH (0.5 m).

**A radius from 3 m, on any bike.** `SMALL_TURN_RADIUS_MIN` = 3 m in «Правка» and in the recipe (`sizes['small-turn'].radius`, 3–8 m in 0.5 m steps, a radius in plain metres on any axis), as for the pivot turn (ADR 0025). The default stays the class value (the U-turn radius at the difficulty), so a generated course does not change unless the recipe asks: a tighter turn is the organiser's choice, never the generator's own. With ADR 0025 this is the second exception to ADR 0006; the connectors themselves keep the class radius.

**Straight in and out, at any distance.** The small U-turn chains ahead (`chainsAhead`): its exit is joined by a straight to the next element's entry when that entry faces the same way and lies ahead within CHAIN_ANGLE (10°), however far, and the exit of the element before is joined straight to its entry the same way. Such a straight keeps to the asphalt and out of every zone like a connector; every other pair keeps the 0.5 m CHAIN_REACH. The generator and «Правка» share the rule (`chainLeg`), so a generated course still routes back to itself.

## Considered Options

- Lower the connector radius round a small U-turn: would let connectors turn tighter than the class anywhere near one, which ADR 0006 exists to prevent.
- Let the small U-turn turn by more than 180° (enter on a slant): what a rider does when there is no room, but it needs element frames off the axes and a new size; left for its own decision.
- Extend CHAIN_REACH for every element: a long straight between two walled elements is a connector the search would then never vary; only the open, rider-picks-the-line small U-turn earns it.
