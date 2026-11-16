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
skip link, dialog focus trap/Escape/restore, command palette by keyboard, account menu arrow keys/Escape/restore, announced form errors, reduced-motion honoured, axe light+dark, phone login, no sideways scroll on 9 main screens at 390 px, leads search/open at phone size, nav drawer by touch and keyboard, dialogs inside the viewport.

## Not verified / known gaps
Screen readers; real iOS/Android devices and browsers; Firefox and Safari; zoom to 400% and text spacing overrides; the Kanban drag-and-drop alternative beyond the existing keyboard stage change (the move menu works by keyboard but its menu semantics were not re-audited); charts have no data-table alternative (Reports); the invoice page's print layout; WCAG 3.3.8 (accessible authentication) beyond standard password + TOTP fields; the live regions of toasts rely on the toast library's defaults.
