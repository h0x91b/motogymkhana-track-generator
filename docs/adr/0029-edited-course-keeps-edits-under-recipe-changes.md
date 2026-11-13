# An edited course takes recipe changes onto its layout; a new course only on request

Until now any change of the recipe form gave a new course, and an edited course gave way to it (to «↶»). The field tester shrank the lot of a course they had laid out by hand and lost the layout to a fresh one: on an edited course the form describes the site the layout stands on, not a request for another course.

**Applied, not regenerated.** While the course on screen is edited, a valid form change goes onto its layout (`applyRecipe`): the layout takes the new recipe and seed, every element, the start and the finish stay where they are, and `routeLayout` builds the course with what no longer fits marked as problems, as in «Правка». The lot, blocked areas, margins, bike class, shape and «паровозик» change the course at once. A fixed size the form changes for a type is given to that type's elements (the nearest their lattice allows), as «Правка» sizes each by hand; a fixed size dropped leaves them as they are. The number of elements, the types, the difficulty and the seed only steer the generator: the edited course keeps them in its recipe and does not change, and a quiet line under the form says they apply when the course is generated anew. An open course loses its own finish when it closes, as a stored layout of another shape has none.

**The form mirrors the layout.** The layout's recipe and seed are what the form shows: applying is one step of «Правка»'s undo, and an undo, a redo or «Сбросить все правки» writes the form back (as blocked areas moved in «Правка» already did). The course file and «Мои трассы» keep the same document; the saved recipe is the form's.

**A new course is asked for.** «Сгенерировать заново» beside «Готово» (shown only for an edited course) and «Новый seed» generate from the form whatever the edits; the edited course goes to «↶» as before. «Новый seed» stays one tap with no question: the edited course is one «↶» away. An unedited course still follows every form change.

## Considered Options

- Keep replacing the edited course on any form change, with «↶» to get it back — the tester did not know «↶» held it, and a lot measured again after the layout is the usual order on site.
- Ask in the page before replacing an edited course — one more tap on every change, and still no way to fit the layout to the measured lot.
- Apply the change to the layout but keep the recipe out of the undo history — an undo past it would show a course the form no longer describes.
- Re-generate the generation-only fields into the edited course (e.g. add elements for a higher count) — the generator cannot add to a hand layout without moving it; «Правка» inserts elements one by one.
