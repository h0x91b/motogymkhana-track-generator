# Спецификация v1: генератор трасс мотоджимханы

- **Статус:** ready-for-agent
- **Дата:** 31 октября 2026
- **Язык предметной области:** [CONTEXT.md](./CONTEXT.md). Все термины спецификации (трасса, элемент, якорь, связка, схема расстановки…) употребляются строго в смысле глоссария.
- **Решения:** [docs/adr/](./docs/adr/). Список решений — это сам каталог, отдельного перечня нет.
- **Справочно:** [исходный handoff](./docs/reference/original-handoff.md) намного шире этой спецификации. Где они расходятся, действует спецификация. [Прототип](./docs/reference/moto-police-course-prototype.html) служит основой рендера и визуального стиля.

Текст спецификации разложен по файлам в [docs/spec/](./docs/spec/), по файлу на раздел, чтобы параллельные изменения попадали в разные файлы. Целиком, по порядку: `find docs/spec -name "*.md" | sort | xargs cat`.

## Problem Statement и Solution

- [Problem Statement и Solution](./docs/spec/1-problem-and-solution.md)

## User Stories — [docs/spec/2-stories/](./docs/spec/2-stories/)

- [Форма и генерация](./docs/spec/2-stories/01-form-and-generation.md)
- [Правила трассы](./docs/spec/2-stories/02-course-rules.md)
- [Просмотр](./docs/spec/2-stories/03-view.md)
- [Правка трассы](./docs/spec/2-stories/04-edit.md)
- [Расстановка](./docs/spec/2-stories/05-setup-walkthrough.md)
- [Картинка](./docs/spec/2-stories/06-image.md)
- [Файл трассы](./docs/spec/2-stories/07-course-file.md)
- [Телефон](./docs/spec/2-stories/08-phone.md)

## Implementation Decisions — [docs/spec/3-implementation/](./docs/spec/3-implementation/)

- [Поставка и архитектура](./docs/spec/3-implementation/01-delivery-and-architecture.md)
- Модули — [docs/spec/3-implementation/02-modules/](./docs/spec/3-implementation/02-modules/):
  [1. Рецепт](./docs/spec/3-implementation/02-modules/01-recipe.md) ·
  [2. PRNG](./docs/spec/3-implementation/02-modules/02-prng.md) ·
  [3. Каталог типов элементов](./docs/spec/3-implementation/02-modules/03-element-catalog.md) ·
  [4. Генератор](./docs/spec/3-implementation/02-modules/04-generator.md) ·
  [5. Модель трассы](./docs/spec/3-implementation/02-modules/05-course-model.md) ·
  [6. Схема расстановки](./docs/spec/3-implementation/02-modules/06-setup-sheet-model.md) ·
  [7. Рендер](./docs/spec/3-implementation/02-modules/07-render.md) ·
  [8. Картинка схемы](./docs/spec/3-implementation/02-modules/08-sheet-image.md) ·
  [9. Приложение и интерфейс](./docs/spec/3-implementation/02-modules/09-app-and-ui.md) ·
  [10. Раскладка и правка](./docs/spec/3-implementation/02-modules/10-layout-and-edit.md) ·
  [11. Файл трассы](./docs/spec/3-implementation/02-modules/11-course-file.md)
- [Маркировка конусов](./docs/spec/3-implementation/03-cone-marking.md)
- [Начальные размеры по сложности](./docs/spec/3-implementation/04-sizes-by-difficulty.md)
- [Размеры элементов в рецепте](./docs/spec/3-implementation/05-sizes-in-the-recipe.md)
- [Сборка](./docs/spec/3-implementation/06-build.md)

## Testing Decisions — [docs/spec/4-testing/](./docs/spec/4-testing/)

- [Что считается хорошим тестом](./docs/spec/4-testing/01-what-makes-a-good-test.md)
- [Швы](./docs/spec/4-testing/02-seams.md)
- [Генератор](./docs/spec/4-testing/03-generator.md)
- [Раскладка и правка](./docs/spec/4-testing/04-layout-and-edit.md)
- [Файл трассы](./docs/spec/4-testing/05-course-file.md)
- [Схема расстановки](./docs/spec/4-testing/06-setup-sheet.md)
- [Межбраузерная воспроизводимость и ручная приёмка](./docs/spec/4-testing/07-cross-browser-and-manual-acceptance.md)
- [Прецеденты](./docs/spec/4-testing/08-prior-art.md)

## Out of Scope и Further Notes

- [Out of Scope](./docs/spec/5-out-of-scope.md)
- [Further Notes](./docs/spec/6-further-notes.md)
