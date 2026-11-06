# The recipe may fix an element type's size in 0.5 m steps; the bike class still sets U-turn minimums

Organisers want a 4 m slalom on a hard course or a wider corridor than the difficulty table gives. So the recipe carries `sizes: { type: { key: metres } }` (`SIZE_OPTIONS` in the catalog): one value per option, on the 0.5 m grid within a range per type (slalom step 3–6 m), replacing that one entry of the difficulty table for that type. The value is the size on a side axis and, as for any single table value, the nearest diagonal lattice length within ±0.25 m (ADR 0005). Its random draw is still taken, so fixing one size does not change the other drawn sizes of the type, and the most compact fallback keeps the fixed size. Where the bike class sets a minimum — U-turn width, box side, figure-eight loop radius (ADR 0006) — a smaller value is raised to it; the recipe keeps what was chosen and the UI and the setup sheet say what was taken. Sizes of unticked types are dropped from the parsed recipe, so they cannot change a course.

## Considered Options

- Free numeric input — invites values no lattice or bike can honour; the organiser asked for 0.5 m steps.
- Per-element sizes (element 3 is a 4 m slalom) — would tie the recipe to one seed's layout, against ADR 0002/0003.
- Letting a fixed size undercut the class minimum — reintroduces turns a cruiser cannot ride.
