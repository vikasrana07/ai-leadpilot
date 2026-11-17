# Accessibility and responsive audit (Phase 8, 2026-11-17)

Target: WCAG 2.2 AA and phone/tablet usability. **Method:** (1) a scripted sweep of every screen at 375x812 and 768x1024 in the installed Google Chrome (`e2e/tools/responsive-audit.mjs`: page overflow, elements poking past the viewport, interactive elements under 40 px), (2) `axe-core` over every main screen in light and dark themes plus the platform console (`e2e/tools/axe-audit.mjs`, and the CI spec `e2e/tests/10-a11y.spec.ts`), (3) keyboard-pattern tests (`10-a11y`), (4) phone-viewport journeys (`11-mobile`), (5) manual computation of colour contrast for every design token pair.
**What this is not:** no screen-reader run (VoiceOver/NVDA/TalkBack) was done, no real phone or iOS Safari was used (Chrome device emulation only), and axe finds only part of WCAG issues. The extension-driven browser window could not be resized below desktop width, so mobile checks used Playwright's Chrome emulation instead.

## Responsive status (375 / 768)
| Screens | 375 | 768 | Notes |
|---|---|---|---|
| Dashboard, Leads list, Inbox, Properties, Appointments, AI Assistant, Knowledge, Tasks, Automations, Reports, Team, Roles, Integrations, Usage, Audit, Security, Webhooks | ok | ok | tables/lists are stacked cards or scroll inside their own container |
| Lead detail | **fixed** | ok | action buttons overflowed by 49 px: header actions now wrap |
| Sales pipeline | ok (columns scroll horizontally by design) | ok | move-menu button grew to a 36 px target on phones |
| API keys | **fixed** | ok | card with an `overflow-x` code block pushed the page 25 px wide (cards are now `min-w-0`) |
| Billing, Settings | ok | ok | test-mode buttons and selects are 36-40 px |
| Invoice page | not swept (needs an invoice id) | | print layout was not re-checked |
| Auth pages (login, register, ...) | ok | ok | inputs are 16 px on phones (no iOS zoom) |
| Platform console (overview, tenants, plans, audit, deletions, security) | ok | ok | nav links now 36 px tall on phones |
| Header (menu, workspace, search, bell, theme, account) | **fixed** | ok | buttons are 40 px on phones; the workspace name truncates at 7 rem so the row never overflows (it did after the 40 px change: caught by the sweep) |
| Dialogs (add lead, import, book, API key, webhook, billing details, invite, add property) | **fixed** | ok | tall dialogs were clipped (API key: top -12 px at 667 px height); all dialogs now scroll inside the viewport (`max-h: 100dvh - 24px`) |
Known remaining: the email-verification banner is tall on 375 px screens (it wraps to 3 lines); small secondary buttons are 36 px, not 44 px (above the 24 px WCAG 2.5.8 minimum); the Reports KPI cards stack one per row on phones (long but usable). Sweeps used a mostly empty demo workspace (8 leads, no inbox traffic), so very dense data states on phones are less tested.

## Accessibility findings
| # | Finding | Severity | Status |
|---|---|---|---|
| 1 | Command palette was not a dialog: no role/name, Tab could leave it, focus was not restored on close | Serious | **Fixed** (role=dialog, aria-modal, Tab kept in the input, focus restored) |
| 2 | Dialogs opened from app state did not return focus to the opener (Radix only restores to a `<Trigger>`) | Serious | **Fixed** (opener remembered and refocused); tested |
| 3 | No skip link | Moderate | **Fixed** (app shell and auth pages; `<main>` focusable) |
| 4 | Visible label not contained in the accessible name (workspace switcher, search box, account menu, score ring), WCAG 2.5.3 | Serious | **Fixed** (labels contain the visible text; avatar initials drawn by CSS so they are not text) |
| 5 | Form errors were not tied to their fields | Serious | **Fixed**: `Field` now sets `aria-describedby`/`aria-invalid` on its control; error is a live alert; tested |
| 6 | Form-control borders had 1.3:1 contrast (WCAG 1.4.11 needs 3:1) | Serious | **Fixed**: new `--input` token (light 3.6:1, dark 3.8:1 on the surface); placeholder text raised from 3.1:1 to the muted-foreground token (5.9:1) |
| 7 | `success` and `warning` text on their soft backgrounds were 4.45:1 and 4.49:1 | Moderate | **Fixed** (darkened to 5.8:1) |
| 8 | White text on the danger colour in dark theme was 2.8:1 (danger buttons, support banner) | Serious | **Fixed**: `--danger-foreground` token; the support banner uses a fixed dark red (6.5:1) |
| 9 | Links inside text relied on colour alone (axe `link-in-text-block`) | Serious | **Fixed**: links are underlined app-wide |
| 10 | Progress bar without a name (AI assistant), scrollable permission lists not keyboard-focusable (Roles) | Serious | **Fixed** |
| 11 | Touch targets: header icons 36 px, checkboxes 13 px, pipeline/task buttons 20-22 px, filter chips 26 px | Moderate | **Fixed** on phones (>= 36 px; checkboxes 24 px); desktop keeps its denser sizes |
| 12 | Lead stage `<select>` saved one move per typed letter | Functional | **Fixed**: choice is held and saved once (short pause, blur or Enter); a blur-after-save double submit was found and guarded; E2E types a whole stage name and asserts exactly one move |
| 13 | Settings/Security/Team... shown during a read-only support session although the API refuses them | Functional | **Fixed**: hidden from the sidebar, command palette and account menu (verified in Chrome with a real support session) |
Axe result after fixes: **0 violations** on 22 app screens + login/register in light and dark, and on the 6 platform screens + login in both themes (WCAG 2.0/2.1/2.2 A and AA rules). Contrast of all token pairs was computed (script in the PR notes, results: every text pair >= 4.5:1 and form borders >= 3:1 in both themes after the fixes).

## Verified in tests (run in `scripts/e2e.sh`)
skip link, dialog focus trap/Escape/restore, command palette by keyboard, account menu arrow keys/Escape/restore, announced form errors, reduced-motion honoured, axe light+dark, phone login, no sideways scroll on 9 main screens at 390 px, leads search/open at phone size, nav drawer by touch and keyboard, dialogs inside the viewport, and (Phase 9) the automation editor: keyboard-only build, axe on its pages and open panels, 375/768 px fit.

## Automation builder: the Outline editor (Phase 9, milestone 2, 2026-11-17)
**Parity rule.** The Outline is a complete editor on its own, at every screen width. The canvas of milestone 3 must be a second *view of the same reducer* (`apps/web/lib/automation-graph-state.ts`) and may never gain a capability the Outline lacks: anything you can do by dragging, you can do with a button, a menu item or a select. The E2E (`e2e/tests/12-automation-builder.spec.ts`) builds a branching automation using only the keyboard.

**Structure.** Each path is a nested list (`ol` named "Steps for: If / Otherwise"), each step a button, each structural edit a menu item (the ⋯ menu per step) or an "Add action / condition / wait" button whose label names where it adds. Joining two paths and re-pointing a path is the "What happens next" select in the step settings (cycles are not offered; a refused edit is announced and shown). Steps nothing leads to (only possible in data from the server) are listed in their own section with delete.

**Keyboard map.**
| Keys | Where | Does |
|---|---|---|
| Tab / Shift+Tab | everywhere | steps, menus, add buttons, settings, in reading order |
| Enter or Space | a step | opens its settings and moves focus to their heading |
| Enter, Space or ArrowDown | ⋯ menu button | opens the menu; arrows move, Enter chooses, Escape closes and returns focus |
| Done | step settings | closes them and returns focus to the step |
| Ctrl/Cmd+S | anywhere | saves |
| Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z (or Ctrl+Y) | outside text fields | undo / redo (inside a text field the browser's own undo applies) |

**Live regions.** A polite status region announces structural changes once ("Added step: ...", "Deleted step: ...", "Moved step down: ...", refusals) and keeps quiet while settings are typed. Refusals also show as a visible alert for 8 seconds. The plain-English summary is a polite live region that follows the graph with a 1.2 s delay, so a screen reader hears the result of an edit once, not every keystroke. A failed save moves focus to the "Problems to fix" list, whose items link to their step.

**Not colour alone.** Test results use an icon plus words ("Condition not met: takes Otherwise", "Would wait 1 day"); problems say "Problem:" or "Heads up:" with an icon.

**Phones and tablets.** Step settings open as a bottom panel (62% of the screen height) and the outline keeps scroll room above it; steps, ⋯ buttons, add buttons, selects and inputs are at least 40 px tall below 1024 px (checked in E2E at 375 and 768 px together with "no sideways scroll").

**Found and fixed on the way.** Any ⋯ menu whose trigger is the shared `Button` could not be opened with Enter: `Button` is a `motion.button`, framer-motion fires a synthetic `pointerdown` for the key press, and Radix treated it as a second click that closed the menu straight away (the Team page member menu had the same bug, unnoticed because the earlier keyboard test used the account menu, which is not a `Button`). `Dropdown` now ignores pointer events the browser did not generate.

**Axe result:** 0 violations on `/automations/new` and `/automations/<id>/edit` in light and dark, and on the editor with the trigger, an action, a condition and a wait open in both themes.

**Not verified / limits.** Screen readers (VoiceOver, NVDA, TalkBack) were not used: the announcements and the tree of lists are verified by DOM assertions and axe only. The browser Back button is not intercepted (Next's router has no safe hook), so an accidental Back leaves without a prompt; the editor keeps a draft in the tab's sessionStorage and offers to restore it, and links and reload/close do prompt. Drag-free reordering exists only as Move up/down within one straight path.

## Automation builder: the canvas (Phase 9, milestone 3, 2026-11-17)
**What it is.** A second *view* of the same editor state as the Outline (`automation-graph-state.ts`; one reducer, one undo history, one set of validation errors). Switch with **Outline | Canvas** above the steps; a desktop remembers the choice, a phone always starts in the Outline. Built on `@xyflow/react` 12.12.1 (vetting in `docs/decisions/0010-automation-graph.md`).

**Parity rule still holds.** The Outline can do everything the canvas can, including connecting steps ("What happens next" in the step settings is the keyboard form of dragging a line). The canvas is never the only way to do anything.

**Canvas keyboard map** (React Flow's own keyboard handling is switched off because it moves selected steps with the arrow keys; this is ours):
| Key | Does |
|---|---|
| Tab / Shift+Tab | move between the toolbar, the steps and the zoom controls |
| Arrow Down / Up | follow the connection to the next step (If before Otherwise) / back to the step that leads here |
| Arrow Left / Right | neighbouring step on the same row |
| Enter or Space | open the step's settings (focus moves to them) |
| Delete / Backspace | delete the selected step after a confirmation (a selected connection goes at once); Ctrl/Cmd+Z undoes |
| Escape | clear the selection |
| Ctrl/Cmd+S, Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z | save, undo, redo (outside text fields), as in the Outline |
Toolbar buttons (Add action / condition / wait after the selected step, Tidy, Fit, Delete) are ordinary buttons with names. Each step has an accessible name ("Condition: If temperature is HOT. 1 problem to fix. Condition met: takes the If path."); the canvas group's name carries the plain-English summary; connections are named too. Test and past-run results use an icon **and** words on each step, a thick line with a tick on the path taken, dashed lines for paths not taken and a dashed "Not reached" card, so nothing depends on colour.

**Phones (below 768 px).** The Outline stays the editor. The canvas is **read-only**: pan, zoom, tap a step to open its settings in the bottom sheet; no dragging, connecting, deleting, toolbar or minimap. A past run opened from run history is read-only at every width.

**Colour and motion.** Edges and labels use the theme tokens (label text is foreground on the card colour; lines are 5.9:1 against the canvas in light). The auto-fit animation is skipped under `prefers-reduced-motion`.

**Checked in `e2e/tests/14-automation-canvas.spec.ts` (all pass):** build with palette buttons, connect by dragging, a loop refused with the reason shown, tidy, undo, connection delete, save; test overlay and past-run overlay; remembered view; keyboard arrows/Enter/Delete-with-confirm; phone read-only; no console or network errors; **axe 0 violations** on `/automations/new` and `/automations/<id>/edit` in canvas mode (with settings open), light and dark, desktop and 375 px. Axe found and we fixed: `aria-label` on connection handles (prohibited on a plain element), the attribution link being under 24 px, and the zoom controls overlapping it.

**Limits.** Screen readers were not used; the canvas is spatial and a screen-reader user is expected to use the Outline (the canvas names and live announcements are verified by DOM only). Connections cannot be focused with the keyboard (use the Outline). Edges are drawn behind steps, so after removing a join on a layout that was tidied earlier a long line can pass behind other cards; Tidy re-lays it out. Multi-select and box-select are off. A step added after some were dragged is placed by auto-layout and may overlap until Tidy.

## Not verified / known gaps
Screen readers; real iOS/Android devices and browsers; Firefox and Safari; zoom to 400% and text spacing overrides; the Kanban drag-and-drop alternative beyond the existing keyboard stage change (the move menu works by keyboard but its menu semantics were not re-audited); charts have no data-table alternative (Reports); the invoice page's print layout; WCAG 3.3.8 (accessible authentication) beyond standard password + TOTP fields; the live regions of toasts rely on the toast library's defaults.
