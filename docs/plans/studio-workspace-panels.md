# Workspace panels: UX polish

The Scenes panel now has a real desktop collapse state. Resizing the Scenes or preview divider changes only workspace geometry; screenplay text, selection, history and printed page layout remain untouched.

## Behavior

- Desktop (1101px and wider): Scenes starts at 224px, adjustable from 180–360px. Preview can grow until the writing area reaches 320px, and cannot shrink below 280px. Hiding either panel returns its actual grid space to writing.
- Tablet (701–1100px): Scenes is an overlay with Close and Escape dismissal. Its height follows the workspace rather than a guessed header height. Preview resizing starts at 760px. Narrower split views fit both panels without a divider.
- Phone (700px and narrower): existing writing/preview choice remains; neither divider is presented.
- Divider keyboard controls: Left/Right move the divider 16px; Shift changes this to 40px; Home/End set minimum/maximum panel width. Double-click restores the default.
- Pointer capture keeps dragging reliable outside the divider. Escape, pointer cancellation, lost capture, blur and a layout transition that hides a divider revert an unfinished drag. Successful pointer release commits it.
- Width preferences persist locally when storage is available. Malformed values are ignored or bounded; blocked storage does not affect editing. Temporary viewport clamps do not overwrite a larger saved width.
- Focus writing and expanded preview keep their existing meaning, and hide both handles. An open dialog retains its own Escape behavior.

## Integration

Import `panels.css` after `studio.css`, then mount `mountWorkspacePanels` with app/workspace/outline/writing/preview elements and optional outline toggle/close buttons. Route the existing Scenes action through `toggleOutline()` or `setOutline()`. The controller creates and owns both separator elements, updates the toggle's `aria-expanded`, and observes workspace size and app layout classes. Existing preview visibility and expanded preview controllers remain responsible for their respective states.

## Evidence

Seven native Chromium browser tests exercise actual CSS geometry, desktop collapse/reopen, keyboard bounds and direction, reset, pointer commit/cancel, source and backward selection preservation, responsive viewport changes, tablet Close/Escape, existing focus/preview states, corrupt/blocked storage and disposal.

Actual app screenshots at 1440px and 768px were inspected locally with the new controller applied. No horizontal page overflow; the editor retained its 320px minimum in the narrower split. This is desktop browser emulation, not a physical touch-device acceptance claim. Independent integrated UI review is still required.

Tablet/phone Scenes also dismisses when a primary pointer is pressed outside the overlay, without preventing the original pointer action or moving focus. Menus, the Scenes toggle, open dialogs and desktop panels are excluded. A native browser test verifies dismissal keeps the outside button focused and leaves source/backward selection unchanged.
