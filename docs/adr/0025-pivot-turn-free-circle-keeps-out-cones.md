# A pivot turn takes any quarter turn, its free radius goes down to 3 m, and its free circle keeps out cones only

The organiser lays a pivot turn («Вращение») out as one striped cone and a free radius round it, and asks for it in quarter turns: 90°, 180°, 270° and so on up to two laps (720°). He also sets free radii down to 3 m on every bike, a cruiser included, which is below the class radius ADR 0006 holds every in-element U-turn to. And he says what the free circle means on the asphalt: no other cone may stand inside it; riding through it is fine.

**Any multiple of 90° from 90° to 720°.** The size is a stepper over those eight angles (`PIVOT_ANGLES`); the element leaves on its entry turned by the angle and runs 1 m out past the circle, so 90°, 180°, 450°, 540° and 630° exit to the side or back like 270° did. The difficulty still deals 270° (easy), 270°/360° (medium) and 360°/720° (hard): a quarter or half turn round a lone cone is a «Правка» choice, not something the generator should spring on a rider. Only more than 180° makes the cone striped; at 90° and 180° it is an ordinary tall cone in its side colour (`passColor`).

**A free radius from 3 m, on any bike.** `PIVOT_RADIUS_MIN` = 3 m in «Правка» and in the recipe (`sizes['pivot-turn'].radius`, 3–8 m in 0.5 m steps, a radius in plain metres on any axis). The default stays the class value (U-turn radius + 0.5 m). The line is still ridden 0.5 m inside the radius, so at 3 m it turns on 2.5 m, tighter than a connector: the organiser's choice, made by hand, never the generator's own. This is the one exception to ADR 0006.

**The free circle keeps out cones, not lines.** Every placed element, start or finish line and connector U-turn cone carries its cone centres (`spots`); a pivot turn also carries a `keepOut` circle of its free radius round its cone. A cone of anything else strictly inside it is a collision (`coneInKeepOut`): the generator does not place it, and «Правка» reports `in-free-radius` (or a start/finish overlap, or a connector-cone problem). Footprints are unchanged (ADR 0016): the pivot's own is its cone and its ridden line, so connectors and other elements' lines may cross the circle where the line leaves it free. The run-off zone stays the single-cone half (`SINGLE_CONE_RUN_OFF`), and it still keeps other elements' footprints away from the line.

## Considered Options

- Reserve the whole disc as part of the footprint: simplest, but forbids exactly what the organiser allows (a connector through the free part of a 90° or 180° turn) and reserves asphalt nobody needs.
- Keep the class minimum and only widen the angles: does not match how the element is laid out on the asphalt; a 3 m free radius is a real organiser figure.
- Deal 90°/180° at easy: would turn a pivot turn into a passed cone or a small U-turn the course already has as fillers (ADR 0024).
