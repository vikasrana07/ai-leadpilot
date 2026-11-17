# ADR-0065 to 0070: automation graph, waits and versions (Phase 9, milestone 1)

Status: accepted and implemented (2026-11-17), milestones 1-4. M1: model, engine, API. M2: Outline editor and create/edit pages. M3: canvas (ADR-0070). M4: graph templates, graph as the single source for writes, review pass (ADR-0071 to 0073 below). Everything was verified against mocks and a local Postgres/Redis only; no real WhatsApp send after a wait, no worker-restart-while-waiting and no load test with many waiting runs has been run.

## ADR-0065 A graph next to the linear columns, not instead of them
`automations.graph` (jsonb, nullable) holds `{ v: 1, nodes, edges }`: nodes are `trigger | branch | action | wait | end`, edges are labelled `next | yes | no | replied | timeout`. Branch nodes carry `match: all | any` plus 1-8 conditions, so AND, OR and if/else are all expressible. Action and trigger data reuse the existing zod schemas (`triggerSchema`, `actionSchema`, `conditionSchema`), so the vocabulary is unchanged (ADR-0029: a closed vocabulary, not code).
Legacy automations keep `trigger/conditions/actions` and `graph = NULL`; they are lifted to a graph at run time by `linearToGraph` (lossless, property-tested over all 8 templates, and `graphToLinear` is its inverse). Graph-authored rows also keep the three columns as a **read-only mirror** (see ADR-0072). Nothing was backfilled, so the migration is non-destructive and rollback is cheap.
**Validation** (`validateGraph`, in `packages/validation`, shared by API and UI): exactly one trigger, no incoming edge to it, unique ids, valid edge labels per node type, acyclic, every node reachable, at least one action. **Limits:** 25 nodes, 12 actions, depth 12, 3 waits per path, wait at most 30 days, 64 KB. Open branch sides and an open wait are warnings (the path simply ends). Issues carry a node or edge id so an editor can show them in place; `POST /automations/validate` returns them without writing anything.

## ADR-0066 Immutable versions; a run never follows later edits
Every definition change inserts a row in `automation_versions` (RLS by tenant; the app role has SELECT + INSERT only, so history cannot be rewritten) and moves `automations.active_version_id`. `matchEvent` stamps `automation_runs.version_id`; `execute` loads the graph from the run's version, never from the live row. Editing an enabled automation therefore applies to new events immediately and cannot change the meaning of runs in flight (including runs parked on a wait). A rename or description change does not create a version (definitions are compared canonically, because jsonb does not preserve key order). Saving is optimistic: `expectedVersion` and a compare-and-set on `graph_version` make a stale save fail with 409 `version_conflict`. Legacy rows get their version lazily on their first event (`source = 'linear'`) or on their next save.
A `linear` version's single `all` branch is evaluated **before** the run is created (the long-standing "conditions not met" gate, unchanged and still recorded as a skipped run); graph-authored branches are decided inside the run.

## ADR-0067 Per-node steps; decisions are persisted
`automation_runs.steps` entries are now `{ i, nodeId, type, status, detail, branch?, resumeAt? }`. For a converted linear automation `i` is still the action index, so run history and old consumers read the same. The position in the graph is rebuilt from the recorded steps alone (`cursorFrom`): finished nodes are never executed again, a failed node is retried, and **a recorded branch decision is followed, never re-evaluated** against lead data that changed in between (tested). Idempotency keys are `runId:nodeId`. Consent, the 24-hour window and the template registry are checked at send time exactly as before.

## ADR-0068 Waits are durable state, not sleeping jobs
A wait node records a `waiting` step, sets the run to `WAITING` with `resume_at` and `waiting_node`, and returns: no worker is held. The minute scanner moves runs whose `resume_at` has passed back to `QUEUED` (compare-and-set on `WAITING`, up to 200 per workspace per tick) and the existing queue picks them up. BullMQ delayed jobs were rejected: they are lost on a Redis flush, cannot be cancelled cleanly, and would hide state from the database that is the source of truth.
**Semantics.** A wait has a `timeout` (or `next`) edge, taken when the time is up, and an optional `replied` edge. A customer message (`message.inbound`) resumes immediately, via `replied`, every run of that lead parked on a wait that has such an edge; without a `replied` edge a reply changes nothing and the wait runs to its deadline. A STOP message (latest WhatsApp consent `OPTED_OUT`) instead ends every waiting run of that lead as `SKIPPED` ("The customer opted out"): opt-out always wins. Turning the automation off ends its waiting runs the same way. Deleting an automation cascades. A reply and the deadline arriving together resume the run once (compare-and-set).
**After the wait** (any resume) the run re-checks the world before acting: automation still enabled, plan still includes automations and is not restricted, lead still exists, no opt-out. Cooldown counts `WAITING` runs, so one lead cannot be re-entered while a run is parked.

## ADR-0069 Dry run walks the graph
`POST /automations/:id/dry-run` returns `path` (every node visited, per-condition pass/fail, `wouldWaitMinutes`) alongside the existing `steps`, `conditionsMet` and `context`. Waits are simulated (the no-reply path is followed). A draft `graph` in the body previews unsaved edits and is never stored. A DRY_RUN run row is recorded, as before.

## ADR-0070 The canvas: `@xyflow/react`, vetted and pinned (milestone 3)
**Decision.** The canvas is a second *view* of the same editor reducer (`apps/web/lib/automation-graph-state.ts`), built on `@xyflow/react`. React Flow owns only pan/zoom, measuring and an in-progress drag; what exists, where it is saved and what is selected stays in the graph. Auto-layout is our own layered layout (`apps/web/lib/automation-layout.ts`, unit-tested); no `dagre`.

**Dependency vetting (checked 2026-11-17).**

| Fact | Value |
|---|---|
| Package / version | `@xyflow/react` **12.12.1**, pinned exactly (no caret) in `apps/web/package.json` |
| Published | 2026-11-02 (15 days before this check; the 13.0.x line, published 2026-11-16, was deliberately not used) |
| Licence | MIT |
| React peer range | `react >= 17`, `react-dom >= 17` (the app is on React 19) |
| Direct dependencies | `@xyflow/system` 0.0.84 (exact), `classcat` ^5.0.3, `zustand` ^4.4.0 |
| New packages in the lockfile (14) | `@xyflow/react`, `@xyflow/system`, `classcat`, `zustand@4.5.7` (the app's own `zustand` 5.1.0 is separate), `d3-drag`, `d3-selection`, `d3-transition`, `d3-zoom`, `d3-dispatch` and their `@types/d3-*` |
| Install scripts | none |
| `pnpm audit --prod` after install | no known vulnerabilities |
| Size | 1.2 MB unpacked; loaded only on the automation editor pages (they are lazy), not the rest of the app |

**CSP.** `style-src 'self' 'unsafe-inline'` already allows React Flow's inline styles; no change to `next.config.ts`. It loads nothing remote: its stylesheet is imported locally (`@xyflow/react/dist/style.css`) and there are no fonts, images or scripts from other hosts. The only external thing is the small "React Flow" attribution link in a corner, which is a plain link and is left visible.

**Accessibility decisions.** React Flow's own keyboard handling is switched off (`disableKeyboardA11y`) because it moves selected nodes with the arrow keys and announces that in a hidden description; the canvas has its own map instead (arrows follow connections, Enter opens settings, Delete asks first). The guaranteed keyboard and screen-reader path is the Outline, which keeps full parity: connecting steps by dragging is the Outline's "What happens next" select. Below 768 px the canvas is read-only.

**Known limits.** Positions are stored on the nodes (`pos`) and count as an edit; a step added after some were dragged is placed by the auto-layout and may overlap until you press Tidy. Multi-select and box-select are off. Edges cannot be focused with the keyboard (use the Outline or the step's settings). A past run is drawn on the *current* graph; steps deleted since are counted in the banner but cannot be drawn.

## ADR-0071 Graph templates (milestone 4)
Eight starters that use branches and waits sit next to the eight linear ones and the six industry ones (`GRAPH_TEMPLATES` in `apps/api/src/ops/automation-templates.ts`): five for every workspace (*follow up if a new lead does not reply in 24 hours*, *fast-track hot and referred leads*, *win back no-shows and escalate*, *assign new leads and escalate after 2 hours*, *re-engage a lead that went quiet*) and one each for coaching (enrolment nudge after a demo class), healthcare (a non-clinical check-in after a consultation) and home services (follow up on an unanswered quote). A template carries its own `graph`; its `trigger` and `actions` are derived from it, `conditions` is empty, and `requiresWhatsappTemplates` is computed from the graph (a test pins that). `GET /automations/templates` returns `graph`, `summary`, `branching` and `hasWaits` for every template (linear ones are lifted), filtered by the workspace's pack. Installing a graph template creates a **graph** automation (disabled, `templateKey` set); installing one of the linear starters still creates a **linear** automation, exactly as before: a linear automation's up-front conditions gate is recorded as a skipped run, a graph branch is decided inside the run, and changing that for the existing starters would have changed documented behaviour and tests for no user benefit.

## ADR-0072 The graph is the definition; the linear columns are a mirror (milestone 4)
New writes (create, update, from-template) validate and store the graph, then write the legacy columns from it: exactly (`trigger`, `conditions`, `actions`) when the graph is a straight line (`graphToLinear`), otherwise `trigger` plus the flat list of every action with `conditions = []`. Everything that decides behaviour reads the graph: the engine runs the pinned version; event matching (`matchEvent`) and the scanners' trigger discovery (`appointment.upcoming` hours, `lead.inactive` days) read the trigger from the graph via `safeTrigger` (a row whose stored definition cannot be read is skipped and logged instead of breaking the workspace). Remaining readers of the old columns, all display-only: the automation DTO (`trigger`, `conditions`, `actions`, and the "missing WhatsApp templates" hint), the workspace export (`automations` is exported as-is), and tests that insert legacy rows on purpose.
**Before the columns can be dropped** (not done; deliberately non-destructive): (1) a backfill migration that writes `graph` for every legacy row (`linearToGraph`) and creates its version; (2) the DTO and web (`apps/web/lib/ops.ts`, the automations page cards) switch to `graph`/`summary`, and the web stops sending the legacy body shape; (3) `export-tables.ts` keeps exporting `automations` (the columns it lists change, and the export format changes for customers: announce it); (4) remove the legacy body support in `prepare` and the `source = 'linear'` up-front gate in `matchEvent`, which means the eight linear starters become graph starters and their documented "conditions not met" skipped-run behaviour changes to an in-run branch step; (5) update the tests that insert legacy rows (`automation.test.ts`, `automation-graph.test.ts`) and the public docs. Until then the mirror is cheap and keeps older readers correct.

## ADR-0073 Review pass (milestone 4)
A read-through of the validator, executor, engine, scanner and API found no cross-tenant path, no way to run a version other than the pinned one, and no duplicate-send path on resume. Findings and fixes are listed in `PROGRESS.md` (Phase 9, milestone 4). The one change made in the engine: a stored definition that cannot be parsed no longer throws for every event and every scan of the workspace.

## Deviations from the original plan
- No `AUTOMATION_GRAPH_ENGINE` flag (see below). Linear automations run through the graph executor.
- `@dagrejs/dagre` was not added; the layout is ours (ADR-0070).
- The first, reduced canvas for mobile is read-only by design; editing is the Outline.
- Linear starters keep installing as linear automations (ADR-0071), instead of all templates installing as graphs.
- Business-hours waits, per-plan node limits and a draft/publish step were left out.

## Consequences and known limits
- `AUTOMATION_GRAPH_ENGINE` flag: **not built**. The graph executor is the only execution path (linear automations run through it); a flag would have kept a second, untested copy of the old loop. Rollback is a code rollback; the new columns are additive.
- A waiting run for a lead that is deleted or merged ends when it resumes ("lead no longer exists"), not at deletion time.
- No business-hours waits and no re-entry-after-cooldown setting (deferred).
- Limits are fixed for all plans; plan-specific node limits are not implemented.
- `POST /automations/validate` runs up to two lookups per assignee or stage reference (at most 12 actions) and relies on the global rate limit; it is not separately throttled.
- A crash between an action finishing and its step being saved can repeat a non-send action (a task or a notification) on retry; sends carry idempotency keys and do not repeat. Same as the linear engine before it.
- `RunStatus.WAITING` appears in the run-history filter and badge; reports count it in total runs only.
