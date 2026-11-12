# «Правка» moves and turns the start and finish like elements; a layout keeps their pose only once they are put by hand

Extends ADR 0012 and ADR 0013. The organiser asked to drag the start box (ADR 0018, ADR 0020) on the plan and turn it in 22.5° steps, the way an element is moved and turned (ADR 0019), instead of moving element 1 to get the start where the asphalt has room. The same goes for the start line of a closed course and for both lines of an open one.

A layout may now carry `start` and, for an open course, `finish`: `{x, y, axis}` — the first cone of the line on whole metres and the axis it is crossed along, in half 45° steps (0, 0.5, … 7.5), with the `pivot` a turn leaves behind, as an element's. **Absent, the line follows its element as before** — 2 m before the first element's entry, 2 m past the last one's exit — so a generated course, its layout and its file are what they were, byte for byte. A pose that is exactly where the generator would put the line is treated as absent, so moving the start away and back gives the generated course again.

A line put by hand stays where it is when the elements move. Its zone runs the usual 2 m ahead of it (the lead-in the rider leaves through); the way to element 1 runs straight on when the entry lies ahead within the chaining angle, else straight across the lead-in and a Dubins connector by the generator's rules, with U-turn cones like any connector. An open course's finish put by hand is reached like a closed course's start: lined up one turning radius before it. A `return` course still comes back across its start line into the box (ADR 0020), wherever the box is. What cannot be kept is a problem on the line («Старт выходит за площадку…», «…отодвиньте старт или элемент 3») or on «старт → 1» / «N → финиш», as for elements. U-turn cones on the way from the start are measured on the sheet from element 1's anchor, the nearest thing already laid out.

Moving, turning and typing an angle go through the element functions (`moveElement`, `rotateElement`, `turnElementTo` with `'start'` or `'finish'` for the index), so the editor treats the line as a row like any other: row 0 «Старт · финиш» (open: «Старт», and «Финиш» after the last element), not reorderable or removable, with «Вернуть перед элементом 1» once put by hand.

The course file writes `start` and `finish` when they are put by hand and keeps its version: an older build ignores the fields and opens the course with the lines where it puts them, which is a course it can show, not one it cannot read (the rule of ADR 0013 and ADR 0019).

## Considered Options

- The pose relative to element 1 (an offset that moves with it) — nothing to store when untouched either, but dragging element 1 would drag the box along, which is what the organiser wanted to stop.
- Always store the pose, also for a generated course — simpler code, but every layout and file would change, and the box would no longer follow element 1 until the user touched it.
- Raise the file version so an older build refuses a file with a moved start — an older build can open the course, just with the start where it puts it; refusing it would lose the whole course over the box.
