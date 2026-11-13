# «Правка» turns elements in 22.5° steps, off the lattice

Supersedes ADR 0001 for edited elements only. The organiser asked to turn an element by 22.5°, not just 45°, to fit it to the lot and the route by hand. In «Правка» an element can now stand at any multiple of 22.5° — sixteen orientations — and a side-only type (the small and fast circles, the snail, the keyhole, the crescent), which stood at four, at any multiple of 45°. The generator does not change: it still places elements only on its eight 45° axes (four for side-only types), so a generated course, its layout and its file are what they were.

An orientation is the layout's `axis` in 45° steps, as before, now allowed a half step (0, 0.5, … 7.5). An element on an axis the lattice has (ADR 0005) is built exactly as before. One off it — a half step, or a side-only type on a diagonal — is **off the lattice**: built along a site side, with its nominal sizes as true lengths in 0.5 m steps, and turned as a whole about its anchor. The anchor stays on whole metres; the other cones fall wherever the turn puts them (real coordinates), and the course marks the element `offLattice`. Because a ring is not snapped to a lattice, it keeps its shape at 45°, which is why side-only types can take diagonals here when the generator cannot give them one.

This costs what ADR 0001 said it would: an off-lattice element cannot be laid out with equal X/Y steps. Its card gives each cone's ΔX/ΔY from the anchor (and the CSV every cone's X/Y from the reference corner) to 0.1 m, its dimension lines and notes say true lengths, and its axis is printed as an angle («под углом 22,5° к ширине»). Collisions, run-off and footprints are oriented-box and polygon geometry that never assumed axis alignment; start and finish lines behind or past such an element are turned with it (their cones still on the 0.5 m grid, ADR 0027).

A course file is written with the oldest version that reads it: 1 for a course on the lattice, 2 once any element is off it, so a build from before this change says «Файл сохранён более новой версией» instead of calling the file broken.

## Considered Options

- A second anchor per off-lattice element — the classic way to set an arbitrary angle on asphalt, but it doubles the measuring for that element and the sheet already lists every cone's offset. Rejected for now.
- Free angles (any degree) — the same machinery would take them, but nobody asked, and a small fixed set keeps the field, the buttons and the file easy to reason about.
- Let the generator use 22.5° too — a larger search for a layout that is harder to set up; generated courses stay on the lattice.
