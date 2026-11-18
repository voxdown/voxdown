# Independent review: Writer and Studio workspace behavior

Date: 2026-11-18. Independent Codex review. No numerical score. Product implementation was owned by the other agents. At the parent's request, this reviewer also added keyboard regressions and updated the existing mobile/production/accessibility checks to exercise the changed behavior.

## Correction to the previous review

The preceding [visual parity review](studio-writer-design-parity-review.md) accepted a much narrower slice than the user's intended familiar sibling workspace. Matching typography, layout and selected edit/download tasks did **not** establish parity in View, Focus, keyboard commands, themes, Help or persistence. The user's counterexamples were correct. This review compares those behaviors directly and does not infer completion from appearance or test counts.

## Checklist and final findings

| Common convention | Baseline gap | Independently verified result |
| --- | --- | --- |
| Toolbar and Focus | No View Toolbar choice; Focus retained the toolbar; Escape did not leave Focus. | View Toolbar works and its choice survives reload. Focus temporarily hides it; leaving restores the user's earlier choice. Search and Help consume their own Escape first. Explicit Leave focus remains reachable on desktop and phone. |
| Familiar global shortcuts | Save/Find were editor-only; common Open/Save as/Focus/pane/help bindings were missing. | Actual Ctrl+F and Ctrl+/ work from editor, header and Scenes; Help also works from Preview and restores focus. Ctrl+O/S/Shift+S work from header. Ctrl+Shift+F toggles Focus; Ctrl+backslash toggles Preview; Ctrl+Shift+backslash toggles Scenes and Ctrl+Shift+O focuses scene search. Ctrl+Shift+P opens Commands. Dialogs are not hijacked by these workspace shortcuts. |
| Menu and region navigation | Hiding the toolbar would strand final-menu Tab on hidden Commands. | Edge Tab reaches a visible control with the toolbar hidden. F10 enters menus, arrows traverse/open them, F6 and Shift+F6 reach rendered regions. Existing hover switching and native disclosure navigation remain. |
| Find consistency | Ctrl+F opened CodeMirror search; Edit's identically described action opened restricted scoped replacement. | Edit → Find opens the same CodeMirror search. Scoped replacement is explicitly named separately in Edit; Tools retains the advanced screenplay-revision action. |
| Theme family | System/Light/Dark only. | Auto, Paper, Sepia, Night, Slate and High contrast all apply and survive reload. Auto responds to device light/dark changes. Header current-look entry and phone appearance dialog work; closing restores focus. |
| Help and About | Only Fountain guide; no dedicated shortcut reference or application identity/support. | Help exposes keyboard reference and About. About identifies experimental status/build, local recovery limitations, source/issues/license links and credits. Both dialogs fit 320px and return focus to their opener. |
| Panel indicators | Icons did not distinguish actual visible panels. | Filled strip, pressed state and rendered visibility agree for desktop default/both panels, expanded Preview, Focus, mobile writing, mobile Preview and mobile Scenes. |
| Persistent workspace choices | A4 reset to Letter; margins off reset on; pane visibility reset, although width/typewriter persisted. | A4, disabled live margins, Typewriter, collapsed Scenes and open Preview survive reload together. Existing resizing still has pointer/keyboard operation and stored widths. |
| File connection and saving | Opening a file discarded its writable connection; Save asked for a destination again. | With stubbed native file handles, Open → edit → global Save writes the linked file without a save picker and preserves CRLF. Open cancellation preserves the draft. External modification blocks overwrite. Firefox's actual Save, Save as and menu Save-as downloads preserve exact bytes. |
| Recovery and document replacement | Required behavior evidence beyond file-menu labels. | Firefox native edit survives reload; New preserves the prior draft; File Recovery reopens the exact edited source. Browser recovery remains clearly distinct from a disk file or independent backup. |
| Preferences contract | Writer Page and text has Cancel/Done/defaults; Studio immediately applies preferences. | Studio's immediate changes and Close are a different contract, not a broken Cancel action. Preferences and Appearance now explicitly say changes apply immediately and are saved in this browser (`site/studio/index.html:110`, `site/src/studio/appearance.ts:94`). There is no claim that Writer's cancellable settings transaction has been copied. |

No unresolved blocker was found in the reviewed common-workspace fix set. This is not a claim of complete Writer feature parity. **Recent OS-file handles and background disk autosave remain absent in Studio**, explicitly deferred by the implementer. Browser recovery/snapshots do not substitute for those promises. A native opened-file connection is currently session-only. Writer's example/recent grouping and Studio's Help example/browser recovery grouping also differ.

## Appropriate screenplay differences

Courier screenplay text, live element margins, scene navigation, Fountain pairing and optional Enter/Tab behavior, printed page guides, PDF/FDX and actor-sides exports belong in Studio. Writer's prose fonts, paragraph spacing, drawn VoxDown marks, speaker assignment, voice rendering, EPUB/book print and novel-specific workbench features need not be copied merely to make the apps familiar. Commands on Ctrl/⌘ K is reasonable in Studio; Writer's same key assigns speakers, a domain-specific action.

Prose-style hints, smart quotes, paragraph focus dimming and inline hover formatting remain separate feature decisions. Their absence should not be hidden behind a blanket parity claim.

## Evidence

Isolated browsers loaded Writer with **The Dragon Who Would Not Roar** and Studio with repository **The Lighthouse**. Writer's actual Toolbar off/on → Focus → Escape behavior and global Find/shortcut reference were exercised as the reference. Source inspection covered Writer menus, preferences, theme catalog and file/save code, plus Studio's corresponding implementation.

Independent native Chromium **and Firefox** checks covered toolbar choice, Focus, nested Escape, Find/Help from multiple regions, pane toggles, reload persistence, About focus restoration and phone Help bounds. Additional Chromium checks exercised all six looks, media changes, native radio choices, and panel-icon states. Rendered screenshots of Slate, phone appearance, phone About/shortcuts and the phone workspace were opened and inspected. Actual downloaded bytes were compared; CodeMirror's virtualized DOM was not treated as the complete document.

The native file-handle probe **stubbed the browser picker and handles**; it did not claim to automate an OS permission dialog. Firefox download fallback used real browser download events and compared actual files. This distinction matters when assessing the file-connection result.

Permanent regressions added/updated by this reviewer:

- `site/test/studio-workspace-shortcuts.test.ts`: four integrated browser tests for Focus/nested Escape, global Find/Help and dialog safety, exact Open/Save/Save-as fallback, F10/F6/menu edge Tab and Commands alias.
- `site/test/studio-mobile-focus.test.ts`: eight checks updated for hidden toolbar, retained menus, explicit exit and keyboard Commands. Source, selection, undo, short viewport geometry, diagnostics and worker retry assertions retained.
- `scripts/check-studio.mjs`: current theme values and actual Focus entry/exit, including hidden toolbar.
- `scripts/check-studio-accessibility.mjs`: all six themes plus About, shortcuts and Appearance; keyboard access to Commands while Focus hides the toolbar.

All **12** owned browser tests passed. Final built-site Chromium production integration passed. The expanded built-site accessibility gate passed **101 states**, with zero axe violations and passing custom labels/focus/reflow/target assertions. These results support the specific behaviors above; they are not a numerical design rating.

Temporary independent probes: `/tmp/writer-workspace-audit.mjs`, `/tmp/studio-workspace-audit-baseline.mjs`, `/tmp/studio-workspace-audit-final.mjs`, `/tmp/studio-workspace-file-audit.mjs`, `/tmp/studio-workspace-keys-files.mjs`, `/tmp/studio-workspace-looks-audit.mjs`, `/tmp/studio-workspace-panels-audit.mjs`. Final gate logs: `/tmp/studio-workspace-production.log` and `/tmp/studio-workspace-a11y-production.log`.

The installed frontend-design and web-design-guidelines skills were reread; current [Web Interface Guidelines](https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md) were fetched for this review.

## Limits

This is a source and isolated desktop-browser audit with responsive viewports. Physical phone browser chrome/software keyboards, assistive-technology sessions, real OS file permissions and external screenplay-app interoperability are not certified. The independent checks here used Control-key desktop input; platform-specific shortcut labels were checked by the supporting agent, not mistaken for a physical Mac keyboard session. Parent-owned Firefox/WebKit production, offline and performance gates are separate evidence. No publishing or user-file modification was performed.

## Final integration validation

The parent completed `pnpm check`: lint, TypeScript, **2,966 tests in 144 files**, and package builds passed. The final static site builds successfully. Production Studio checks passed in Chromium, Firefox and WPE WebKit; direct-file safety and both root/nested-path offline checks passed. New native-open tests use explicit picker/handle stubs and cover same-file Save, Save as, cancellation, exact BOM/CRLF bytes and external-change refusal.

The desktop performance gate passed at normal CPU speed. Sustained typing keydown-to-next-frame p95 was **16 ms**; typing across worker updates p95 was **15.4 ms**, with no observed long tasks in either sample. These are desktop regression measurements, not a physical-phone performance claim. Browser-reported PDF bundle size remains the existing build warning; PDF code is loaded on demand.

No remote repository changes or deployment were made. Writer's source behavior and preferences were not changed; Studio reuses Writer's read-only appearance catalog.
