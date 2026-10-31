# A course is a pure function of recipe + seed; the image is the only way to share it

A course is always regenerated from its recipe and seed: v1 has no manual editing, no pinning, no saved courses, no links or share codes, and no JSON import/export. People share courses by posting one tall setup-sheet image in a chat, so the image must be self-sufficient for laying the course out on asphalt. Local storage only remembers the last form. Because nothing but the image outlives a session, we do not freeze old generator versions — the generator can be retuned freely, and an old seed simply yields the current generator's course.

## Considered Options

- Links carrying recipe + seed (+ frozen generator versions so they never die) — the original brief's contract; rejected because chats carry images, not links.
- Saved courses with a geometry snapshot in localStorage — rejected; the archive is the chat and the photo gallery.
- Manual edits shared as JSON files — deferred to a later editor stage.
