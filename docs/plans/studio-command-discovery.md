# Find tools without crowding the writing screen

Commands now groups the growing toolset into Plan and revise, Writing space, Files and
recovery, Export and perform, Learn and inspect, and Navigate. A category filter combines
with search. Search matches every typed word in any order across labels, categories and
curated aliases, including common terms such as theme, font, print, page setup and compare.

Existing commands remain available. Disabled tools remain visible, and availability is
checked again before execution. Arrow keys skip disabled results; Up from the first result
returns to search. Enter runs the first enabled result. Escape closes even a populated
search input; composing input does not execute commands. Each new opening clears filters.

Independent review covered all 32 commands, alias/category discovery, keyboard behavior,
IME event handling, changing availability and a 320px layout with no axe violations.
Four browser regressions cover filtering, disabled navigation, stale availability and
composition/Escape/reopening. Real IME and screen-reader acceptance remain manual.
