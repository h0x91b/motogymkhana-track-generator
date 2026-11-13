# Every course is a named saved course, saved as it changes

«Мои трассы» (PR 30) kept courses only when «Сохранить» was tapped, at the bottom of the recipe, while the last form and the last edited layout were remembered on their own under two other keys (ADR 0012). Two memories of one course, one of them out of sight, and a good course was lost to a forgotten tap. Now the course on screen always is a saved course: it has a name and is written under its entry in `motogymkhana-constructor:courses:v1` half a second after every change — the form, the seed, «Правка», the blocked areas, the start and finish. The top bar names it and opens the list of the others.

**One format, one key.** An entry is the course-file document (ADR 0013) under an `id`, a `name`, `createdAt` and `savedAt` (the last change, by which the list is ordered). A course never renamed carries `auto: true` and its name follows its recipe and seed: «40×60 м · сложная · seed 1 · 13.11.2026», the date being the day it was made. Which entry is on screen is under `motogymkhana-constructor:current:v1`. An unchanged document is not written again (the build that wrote it does not count), so opening a course does not move it up the list.

**Settled courses only.** Nothing is written while the form has an error (the course on screen belongs to the previous recipe), while a course is being generated or opened, or during a drag. A pending write is flushed before switching, opening a file, starting a new course and when the page is hidden.

**Opening is switching.** Switching to a saved course, «Новая трасса» (this recipe, a new seed, no edits) and opening a file or pasted text all put another course on screen in place of this one, which is saved already. «↶» therefore works within one course and is cleared on a switch; an opened file is a new saved course, named after the file unless it is one of this app's own `motogymkhana-…` names. Deleting the course on screen opens the last edited of the rest, or a new one.

**Migration.** The last form and edited layout of an older build (`form:v1`, `edit:v1`) are read once, when no saved course is current; their course is saved as a course the moment it is shown, and only then are the two keys removed. A full or missing storage is a sentence for the user — once in a toast, then «Не сохраняется» in the top bar — and the stored courses stay as they were.

## Considered Options

- Keep «Сохранить» and only move the list to the top bar — still two memories of one course, and the one on screen is lost on a cleared tab or another phone in hand.
- Autosave into the `form`/`edit` keys and copy to the list by hand — the same split with extra steps; the list would show stale copies.
- A new key and format for named courses — two formats to read forever; the course-file document already says everything, and PR 30's entries keep working as they are.
- A `role="menu"` drop-down — a menu cannot hold the inline rename field and delete confirmation; the list is a dialog (a sheet from the bottom on a phone, a drop-down under the top bar on a wide screen) whose arrows step through its controls.
