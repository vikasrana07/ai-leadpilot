# ADR-0026 to 0032: appointments, automation, notifications (Phase 5)

Status: accepted (2026-11-16)

## ADR-0026 Double booking is prevented by the database, not by code
Two `EXCLUDE USING gist` constraints on `appointments` (tenant+agent+`tstzrange(starts_at, ends_at, '[)')`, and tenant+lead+range) apply to `PENDING`/`CONFIRMED` rows. Ranges are half-open so back-to-back visits are legal. The service only turns a violation (`23P01`) into a friendly 409 (`slot_taken`, `lead_busy`) and, when no agent was requested, falls through to the next free candidate. Verified by a test that fires 12 simultaneous bookings at one slot: exactly one wins.
**Why:** application-level "check then insert" always loses a race. **Cost:** needs the `btree_gist` extension (created in the first migration).

## ADR-0027 Working hours are wall-clock in the workspace timezone
Rules are `(day_of_week, start_minute, end_minute)`; exceptions are a local `YYYY-MM-DD` with optional minutes. Slot generation converts wall-clock to UTC per day with `Intl` (no date library), so a 09:00 slot stays 09:00 across a DST change and its real duration is unchanged. A nonexistent local time moves forward; an ambiguous one takes the earlier instant. A person's own rules replace the workspace default; with nothing configured Monday to Saturday 10:00-19:00 applies. 30-minute grid, 30-minute minimum notice.

## ADR-0028 Transactional outbox + relay, BullMQ for execution, scanners for time
Services write domain events (`lead.created`, `appointment.booked`, ...) to `outbox_events` in the same transaction as the change. A relay claims batches through a `SECURITY DEFINER` function (`FOR UPDATE SKIP LOCKED`, 2-minute lease, so a crashed relay's rows are re-claimed), processes each event in one tenant transaction guarded by an `event_marks` row (redelivery is a no-op), then marks it processed; failures back off and become `failed` after 10 tries. Matching automations get an `automation_runs` row (unique per automation+event) and a BullMQ job (`automation-runs` queue, 5 attempts, exponential backoff, failed jobs kept as the dead-letter set). A repeatable `maintenance` job runs the scanners every minute.
Cross-tenant work (claiming events, listing tenants) is limited to four `SECURITY DEFINER` functions; everything else stays under RLS.
Runs are claimed with a compare-and-set (`QUEUED` to `RUNNING`), steps persist as they finish and are never repeated on retry, sends carry an idempotency key, and a run stuck `RUNNING` for 10 minutes is re-queued.
**Process model:** the API does not process background work unless `WORKERS_ENABLED=true`. `apps/worker` runs the same Nest modules without HTTP (`src/worker.ts`) with it on. Any number of workers is safe.

## ADR-0029 Automations are a small closed vocabulary, not code
Trigger (16 types, some parameterised), up to 8 AND-ed conditions (`eq neq gt gte lt lte in`; an unknown value never satisfies a numeric comparison), up to 6 actions (send WhatsApp template, send message, assign least-busy / to person, create task, notify, change stage, add tag). Validated with zod on write and again on enable. Eight starter templates ship **disabled**. Message actions go through `ConversationsService.sendSystem`, i.e. the same consent, 24-hour-window and template-registry rules as a human; a refusal is a recorded *skipped* step, not a failure and not retried.
**Loop protection:** events caused by an automation carry `depth+1` and `originAutomationId`; an automation ignores its own events and chains stop at depth 3. Per-lead cooldown (default 60 min). Every considered automation leaves a run row (even `SKIPPED` with the reason), so "why did it not fire?" is answerable.
**Dry run** performs real reads (consent, window, template registry, channel state) and no writes, and records a `DRY_RUN` run.

## ADR-0030 Reminders and other time-driven events fire exactly once
Scanners only *emit* events, guarded by `event_marks(tenant_id, key)` inserted in the emitting transaction (`appt-up:<id>:<hours>`, `inactive:<lead>:<days>:<last-contact>`, `ai-recover:<message>`; tasks use a compare-and-set on `reminded_at`; SLA uses a unique `inbound_message_id`). Reminders are skipped when the visit was booked inside the reminder window, and when the scanner was down so long that more than half the lead time is gone.

## ADR-0031 AI scheduling is grounded in the same availability
`check_availability(date, durationMinutes)` returns real slots; `create_appointment(date, time, notes)` takes a date and wall-clock time (not a timestamp the model could invent), re-checks that exact slot against availability and existing bookings, and books it as `PENDING` (a person confirms) with source `ai`. The lead comes from the server context. A customer with an upcoming visit cannot get a second one from the AI. A new output guard rejects replies that state a clock time no tool result contained (`unsupported_time`).

## ADR-0032 Notifications are personal, preference-aware and never about your own actions
In-app only (email/push/WhatsApp-to-staff are V1.1). Ten types; each member can mute any. Created in the relay's transaction, pushed over the existing SSE stream (`notification.created`, delivered only to the target membership). The actor of an event is not notified about it. SLA: a customer message in a human-handled conversation with no human/AI reply within the tenant's target (default 15 min) records one breach per message, alerts the owner and managers, and resolves with the response time when someone replies; AI-handled chats are not counted.
