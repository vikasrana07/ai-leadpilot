# Worker and queues

Background work (outbox relay, BullMQ `automation-runs` queue, 60-second `maintenance` scanner) runs only where `WORKERS_ENABLED=true`: the `node dist/worker.js` process (or an API with the flag on). **If no worker runs, nothing time-based or event-driven happens**: no reminders, automations, notifications from events, SLA breaches, trial/dunning notices, quota alerts. Inbound messages and HTTP actions still work.

Safe to run several workers: outbox rows are claimed with `FOR UPDATE SKIP LOCKED` (2-minute lease), automation runs with a compare-and-set, scanners with `event_marks` (exactly once).

## Is the worker alive and keeping up?
```sql
-- Outbox backlog and oldest pending event (expect ~0 rows older than a minute)
SELECT status, count(*), min(created_at) AS oldest FROM outbox_events WHERE status IN ('pending','processing') GROUP BY status;
-- Failed outbox rows (gave up after 10 attempts)
SELECT id, tenant_id, type, attempts, created_at FROM outbox_events WHERE status='failed' ORDER BY created_at DESC LIMIT 50;
-- Automation runs by state
SELECT status, count(*) FROM automation_runs WHERE created_at > now() - interval '1 day' GROUP BY status;
-- Runs stuck RUNNING (the sweeper requeues those older than 10 minutes)
SELECT id, tenant_id, automation_id, started_at, attempts FROM automation_runs WHERE status='RUNNING' AND started_at < now() - interval '10 minutes';
```
If the outbox grows and nothing is claimed: worker not running, cannot reach the database, or crash-looping. Check worker logs for `Worker running (relay, automation queue, scheduler)` and for `relay:` / `Scan failed` errors.

## Stuck or failed outbox rows
- `processing` rows older than the 2-minute lease are re-claimed automatically by any running worker; no action needed once a worker is up.
- `failed` rows (attempts >= 10): fix the cause, then re-queue (WRITE, as owner):
  ```sql
  UPDATE outbox_events SET status='pending', attempts=0, available_at=now() WHERE id = '<id>' AND status='failed';
  ```
  Handlers are idempotent (unique run per automation+event, `event_marks`), so re-queuing is safe.

## Automation runs
- Per run history with step results: the Automations page (Run history), or `automation_runs.steps`.
- A failed run can be retried from the UI (`POST /automations/runs/:id/retry`, 409 `not_retryable` unless FAILED). Provider delivery failures are **not** auto-resent (a retry could duplicate a customer message); resend manually from the inbox.
- Loops: runs deeper than depth 3 or self-triggered are recorded as skipped (`loop_protection`).

## BullMQ failed set (dead letters)
Queues: `automation-runs` (5 attempts, exponential backoff; failed jobs kept, last 5000) and `maintenance`. Keys are prefixed with `QUEUE_PREFIX` (default `leadpilot`). Inspect with redis-cli:
```
redis-cli --scan --pattern 'leadpilot:automation-runs:*' | head
redis-cli ZCARD leadpilot:automation-runs:failed          # number of failed jobs
redis-cli ZRANGE leadpilot:automation-runs:failed 0 20
redis-cli HGETALL leadpilot:automation-runs:<jobId>       # failedReason, stacktrace, data
redis-cli ZCARD leadpilot:automation-runs:wait            # backlog
```
The database is the source of truth: a run whose job was lost stays `QUEUED` and the minute scanner re-enqueues it, so you rarely need to touch Redis. To retry a failed one, retry the **run** (UI/API above), not the job.

## Redis down
- Queue processing pauses; the outbox keeps accumulating in Postgres (nothing lost) and drains after Redis returns. Queued runs are re-enqueued by the scanner.
- Rate limiting degrades to per-instance memory counters (limits weaker across replicas).
- Restore Redis, then confirm: outbox backlog falls, `automation_runs` QUEUED count falls.

## Worker restarts / deploys
Shutdown hooks close workers cleanly. A worker killed mid-run leaves the run `RUNNING`; it is requeued after 10 minutes. AI turns run in the API process (not the worker): a crash mid-turn leaves a stale `RUNNING` ai_run that expires after 3 minutes, and the scanner re-triggers an unanswered customer message once (90 seconds to 6 hours old).
