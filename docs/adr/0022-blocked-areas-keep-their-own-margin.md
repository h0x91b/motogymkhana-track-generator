# Blocked areas keep their own margin

ADR 0015 kept one margin round every cutout and obstacle: the lot edge margin (`safetyOf(recipe).edge`). Real lots disagree. A parked car wants more room than a painted kerb line (a door opens, a bumper sticks out), while a 1 × 1 m pillar in the middle of a tight lot is often fine to pass at half a metre. So each blocked area may now carry its own `margin` in the recipe: metres on the edge margin's scale, 0–3 m in 0.5 m steps. Absent, the area keeps the lot edge margin, and the recipe has no `margin` key, so every recipe, course file and stored form written before stays the same course.

What the margin means is unchanged from ADR 0015, only whose it is: cones, element lines and connectors keep out of the rectangle grown by **its** margin; a run-off zone, a U-turn cone's footprint and a start or finish line's waiting area still only keep out of the bare rectangle. A free rectangle of the lot is shrunk on each side by the margin of the area that side runs along (the largest, when several do), and by the edge margin on a side at the lot's edge. Detours go round the area's own margin.

The margin is edited in the area's row, in the form and in «Правка» (−/+ and a typed field), and shown where the area is: the plan, 3D and the setup sheet draw it as the dashed line of an element's reserved zone (the «Зоны» toggle hides it on screen), and the sheet line of the area names it. A layout problem quotes the margin of the area actually broken.

## Considered Options

- Separate margins per kind (one for cutouts, one for obstacles) in `recipe.safety` — two numbers instead of one, but the car and the pillar are both obstacles and still disagree.
- A margin per side of the area — the honest model of a car (doors on two sides), but four fields per row on a phone for a difference of half a metre; deferred until a lot needs it.
- Storing the edge value explicitly on every area — simpler code, but then changing the edge margin no longer moves the areas that never chose their own, and every old recipe would change its canonical form.
