# Course shape is a three-way recipe field; a finish by the start is a second line within 8 m

The recipe had one boolean, `closed`: a closed course (one line is start and finish, the last connector rides back through it) or an open one (the generator puts start and finish anywhere). Organisers also want the rider to finish where they started without the course being a loop — the next rider waits at the start, the one finishing pulls up beside them. That is neither value of the boolean, so the recipe now carries `shape: 'open' | 'closed' | 'return'` and the boolean is gone from the normalised recipe. A recipe or saved form that still has only `closed` is read as before: true → `closed`, false or missing → `open`; when both are given, `shape` wins. The course's route carries `shape` instead of `closed`.

A `return` course has two lines like an open one. The finish line's centre lies at most 8 m from the start line's, its direction of travel is the start's or the opposite one, its zone (2 m lead-in, the usual 2 m run-out) does not overlap the start zone or any other zone, and the last connector reaches it like the closing connector of a closed course: a Dubins path to a point one turning radius before the line, then straight across, never entering the start zone. Candidate lines are tried in a fixed order — offsets of 3–8 m across and 0, ±2, ±4 m along the start, sorted by distance to the start, ties in enumeration order — and at most 8 that pass the cheap checks get a connector search per placement. Elements are laid out on the ring the closed course uses, and the looser 400° closing limit applies as for closed courses.

Consequence: recipes changed shape, so every golden snapshot changed and the generator version was bumped; courses for `closed` and `open` recipes are otherwise built exactly as before. On the form's default recipe a `return` course fills more elements than a closed one (the finish has many places to go, the closing line only one).

## Considered Options

- A second boolean «финиш у старта» next to «Замкнутая» — two booleans admit a meaningless fourth combination, and the form would need to forbid it.
- Finish on the start line's extension or a fixed spot beside it — too often blocked by the first element's lead-in or the site edge; a small ordered search fits far more courses at little cost.
- Seeded choice among the valid finish lines — adds a PRNG stream for no visible gain; nearest-first gives the tightest start-and-finish zone, which is the point of the mode.
