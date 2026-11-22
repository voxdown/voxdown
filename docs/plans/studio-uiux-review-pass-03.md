# Independent UI/UX review: third polish integration

Date: 2026-11-18. Separate Codex reviewer, no implementation changes. Inspected actual rendered screenshots and exercised keyboard/pointer workflows at1440,1101,768,375,320 pixels in light/dark, plus320×568 short-phone dialogs.

**UI9.2/10; UX9.1/10.** The application now has a coherent visual system and predictable workspace controls. The remaining material weakness is concentrated in two export dialogs rather than the general shell.

## Closed findings

- Dark menu resting surfaces now match the restrained light-theme hierarchy. Primary buttons retain clear contrast.
- Preview action-menu Tab exit now reaches the page-scroll region, not File.
- View exposes pressed states for Focus, Scenes, Preview and margins.
- Shared headers are present across the additional tool dialogs; sticky Close controls remained visible and hit-testable after scrolling every sampled short-phone dialog to its bottom.
- Numbering's shorter introduction and optional details materially improve the task. Compare file selection is no longer preceded by a long implementation explanation.
- Sides, breakdown and rehearsal singular labels were corrected.
- Main workspace width/theme interactions remain free of horizontal overflow and page errors. Menu and resizing operations did not alter source in the main interaction matrix.

## Remaining acceptance criteria

### Adaptation and FDX export: concise decision, accessible details

For a simple one-scene script on320×568, Adaptation produced an1806px scroll body with its download button arounddocumenty1789; FDX produced1171px with download aroundy1155. Even the desktop Adaptation first screen was dominated by a long technical bullet report and did not show its download action.

Retain visible consequences and warnings: separate/interchange file, private-content exclusions, any actual feature losses, dual-dialogue acknowledgement and validation/error state. Move detailed conversion mechanics and routine zero-count statements into a clearly labeled disclosure. Place the validated summary and primary download near the relevant choices; mandatory acknowledgements must still gate downloading. Generated text and full compatibility details should remain inspectable.

Adaptation also still displayed “1 speaking roles” and “1 scene headings”; apply the same singular/plural polish as the other tools.

### Recovery header control consistency

The short-phone Recovery dialog's Close label appeared noticeably larger than the shared Close controls in neighboring dialogs (approximately26px versus16px). Normalize that inherited style while keeping its touch target and existing accessible label.

## Evidence

- `/tmp/studio-ux-pass3-{1440,1101,768,375,320}-{light,dark}-{main,file,view,tools,statistics,preferences}.png`
- `/tmp/studio-ux-pass3-{1440,320}-{Scene-cards,Number-scenes,Actor-sides-PDF,Adapt-screenplay,Scene-and-cast-breakdown,Rehearsal-cue-cards,Compare-with-local,Scoped-find-and-replace,Rename-a-character}.png`
- `/tmp/studio-ux-pass3-small-{1440,320}-{Adapt-screenplay,Source-diagnostics,Private-notes,Recovery-and-snapshots,Export-Final-Draft-XML,Portable-backup}.png`
- `/tmp/studio-ux-integration3.log`, `/tmp/studio-ux-smalltasks.log`

Some secondary captures coincided with development hot reload and therefore show an empty draft rather than the original fixture. They support layout assessment only; no source-integrity claim is based on those interrupted captures. The later short-phone export captures used a freshly populated one-scene fixture.

Scores remain expert review judgements, not physical-device usability-study results. The finite remaining criteria above should be rechecked visually and through their actual validation/download interactions before deciding whether9.5 is earned.
