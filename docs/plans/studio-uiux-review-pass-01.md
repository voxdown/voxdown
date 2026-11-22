# Independent UI/UX review: first polish integration

Date: 2026-11-18. Separate Codex reviewer, no implementation edits. Local live development build; reviewed screenshots directly and exercised actual interactions at 1440, 768 and 320 CSS pixels in light/dark.

**UI 8.2/10; UX 8.1/10.** A substantial improvement from baseline, but not at the requested9.5 threshold. These are expert judgements of observed scope, not measured user-satisfaction scores.

## Improvements verified

- File/View/Tools/Help menus remove the undifferentiated file-button row. File tasks are grouped much more predictably.
- Workbench now has a real header, grouped statistic values, attached target label/field and optional calculation explanation. The reported screenshot defect is resolved.
- Preferences checkbox labels stay with their controls and long explanations use disclosures.
- Scene panel can collapse on desktop; mobile drawer Escape now closes it.
- Both panel separators resize with pointer. Scene separator Home/End produced180/360px widths.
- Commands has a wide search field, proper header/close placement, readable results and compact keyboard footer; mobile first results appear far earlier than baseline.
- All reviewed states fit viewport width. No browser page errors occurred during the matrix.
- Menu/dialog and resizing operations preserve source and selected text. Preferences returns focus to View; workbench returns focus to Tools. Undo still reverted the preceding text edit after panel resizing.

## Remaining findings

### High priority

1. **Phone writing space regressed.** At320 the editor begins around y292 versus baseline y270. Two-row navigation plus a wrapping toolbar uses too much vertical space. Focus is no longer visibly available in the phone header or View menu, so the convenient escape route requires discovering Commands. Keep ordinary phone layout compact and provide a clearly available Focus/Exit control.
2. **Menu Tab flow skips its contents.** After clicking File, pressing Tab moves to View and closes File. ArrowDown works, but users following ordinary disclosure navigation cannot Tab into the menu. Manage focus or DOM order so Tab enters open items and ShiftTab/escape returns predictably.
3. **Preferences introduction is now false.** It says settings do not change printed pages, while Paper size was moved into this dialog and does change PDF pagination. Separate document layout settings from writing-space settings or update the description precisely.

### Medium priority

4. **View menu is incomplete.** It includes margins/reference/preferences/storage/offline but not Focus or panel visibility. Users expect View to own workspace layout. Give panel actions predictable names and state, keeping the direct toolbar toggles if useful.
5. **Tablet preview remains too small by default.** At768 the page is314px wide and its text unreadable; resizing/expansion is available, but the initial split still prioritizes a paper thumbnail over a comfortable writing area. Consider a better tablet default or clear writing/preview mode choice.
6. **Very short speech reports a whole minute.** Fourteen spoken words displays “About1minute of speech.” Use “Less than1minute” or an appropriate seconds estimate; do not imply precision the model cannot support.
7. **Dark surface styling differs from light.** Menu triggers and dropdown items are solid rounded blocks in dark mode, where light mode uses restrained transparent rows. Match resting/hover/active surface hierarchy between themes.
8. **Command ordering still reflects construction order.** The default Files category starts ImportFDX, Storage, Save, Offline, Backup, then New/Open. Align with the logical File menu ordering.
9. **File menu lacks ExportPDF.** The persistent PDF button is useful, but File's export group should include the primary supported export as well.
10. **Phone footer can wrap awkwardly.** On a fresh draft, the long recovery message and Line1 produce a two-line footer with a narrow broken line-number column. Reserve a nonwrapping position field and let status truncate/wrap deliberately.

## Evidence

- `/tmp/studio-ux-pass1-{1440,768,320}-{light,dark}-{main,file,view,tools,statistics,preferences}.png`
- `/tmp/studio-ux-pass1-{1440,320}-{commands,toolsmenu}.png`
- `/tmp/studio-ux-integration.log`
- Actual pointer/keyboard/source-safety probe: `/tmp/studio-ux-interaction2.mjs`

No physical-device, screen-reader or user-study claim is made. Next review should recheck the concrete findings above and a wider range of secondary dialogs before any product-wide high score.
