# ADR-0065 to 0070: automation graph, waits and versions (Phase 9, milestone 1)

Status: accepted (2026-11-17). Dark-launched: the API and engine accept and run graphs; no UI creates them yet (milestones 2-3 add the Outline editor and the canvas).

## ADR-0065 A graph next to the linear columns, not instead of them
`automations.graph` (jsonb, nullable) holds `{ v: 1, nodes, edges }`: nodes are `trigger | branch | action | wait | end`, edges are labelled `next | yes | no | replied | timeout`. Branch nodes carry `match: all | any` plus 1-8 conditions, so AND, OR and if/else are all expressible. Action and trigger data reuse the existing zod schemas (`triggerSchema`, `actionSchema`, `conditionSchema`), so the vocabulary is unchanged (ADR-0029: a closed vocabulary, not code).
Legacy automations keep `trigger/conditions/actions` and `graph = NULL`; they are lifted to a graph at run time by `linearToGraph` (lossless, property-tested over all 8 templates, and `graphToLinear` is its inverse). Graph-authored rows also keep `trigger` (the scanners read it) and a flattened `actions` list (used for display and the "missing WhatsApp template" hint), with `conditions = []`. Nothing was backfilled, so the migration is non-destructive and rollback is cheap.
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

## ADR-0070 Dependency note for the canvas (milestone 3, not installed yet)
The canvas will use `@xyflow/react`, pinned to an exact release at least 14 days old, after checking React 19 peer support, its licence (MIT) and transitive dependencies, and the inline-style needs against the CSP in `next.config.ts`. Auto-layout is a small in-repo layered layout (no `dagre`). Nothing is added in this milestone.

## Consequences and known limits
- `AUTOMATION_GRAPH_ENGINE` flag: **not built**. The graph executor is the only execution path (linear automations run through it); a flag would have kept a second, untested copy of the old loop. Rollback is a code rollback; the new columns are additive.
- A waiting run for a lead that is deleted or merged ends when it resumes ("lead no longer exists"), not at deletion time.
- No business-hours waits and no re-entry-after-cooldown setting (deferred).
- Limits are fixed for all plans; plan-specific node limits are not implemented.
- `RunStatus.WAITING` appears in the run-history filter and badge; reports count it in total runs only.
