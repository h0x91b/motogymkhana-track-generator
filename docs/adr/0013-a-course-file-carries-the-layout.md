# A course can be saved to a file and opened back; the file carries the layout

Reverses the "no JSON import/export" part of ADR 0003. «Сохранить .json» writes everything that defines the course on screen into one file, and «Открыть .json» puts that same course back: the form gets the file's recipe and seed, and the file's elements go on top of the course this build generates for them, as in «↶» (ADR 0012). «Конусы .csv» exports one row per physical cone with X and Y from the reference corner. The setup-sheet images stay the way a course is shared in a chat; a file is for keeping a course and moving it between devices or people who use the app.

The file is the course's layout — recipe, seed and the elements in route order — under a header: `format: "motogymkhana-course"`, an integer `version` (1), the `build` that saved it and whether the course was `edited`. **The elements are written for every course, edited or not.** A seed repeats a course only within one build (ADR 0009), so a file with just the recipe and seed would open as a different course after the next deploy. Opened on another build, a file whose course this build generates differently is shown as an edited course, with this build's course one undo away; if this build cannot generate a course for that recipe at all, the file's elements are routed and shown anyway. A file with only a recipe and seed (written by hand) is accepted and opens as whatever this build generates.

A reader refuses a file with a newer `version` instead of half-opening it; `version` goes up only for a change an older build cannot read. The recipe travels whole, so a field added to the recipe later travels with it, and an older file without that field reads as the recipe parser's default.

The cone list CSV uses semicolons, decimal commas and a byte-order mark, so a spreadsheet in a Russian locale opens it straight into columns.

## Considered Options

- Recipe and seed only for an unedited course, the layout only once edited: the smallest file, but it silently opens as another course after any generator retune. Rejected.
- A full course snapshot (every cone and path): opens exactly whatever the build, but it cannot be edited in «Правка», since an edited course is its layout, and it ties the file to the course's internal shape. Rejected.
- A link carrying the course: rejected for now, see ADR 0003; it would need the same layout (about 1–2 KB of JSON, several hundred characters compressed in a URL) and nothing else, since the page is static.
