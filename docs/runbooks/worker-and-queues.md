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

### Worker heartbeat (fast check)
Every background process writes `<QUEUE_PREFIX>:worker:heartbeat:<instanceId>` to Redis every 30 s with a 90 s lifetime, and the once-a-minute tick publishes the count as the `WorkersAlive` gauge and stores the latest snapshot at `<QUEUE_PREFIX>:ops:snapshot`.
```
redis-cli -p 6380 --scan --pattern 'leadpilot:worker:heartbeat:*'      # one key per live worker (use your QUEUE_PREFIX)
redis-cli -p 6380 GET leadpilot:ops:snapshot | jq '.workers, .db.outbox, .db.automation_runs'
```
No heartbeat keys for over 90 s means no worker is running (or Redis is down). A missing or older-than-5-minute snapshot means the maintenance job is not running: check that a worker with `WORKERS_ENABLED=true` is up and the `maintenance` queue has its repeatable `tick` job.

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

## Runs stuck WAITING (automation waits)
A wait node parks a run as `WAITING` with `resume_at`; the minute scanner puts it back in the queue once `resume_at` has passed (a customer reply or an opt-out/disable can end it earlier). It is **not** swept like a stuck `RUNNING` run, because waiting is normal. Check for overdue ones (alert if any is more than 15 minutes late, which means the scanner/worker is not running):
```
SELECT id, automation_id, lead_id, waiting_node, resume_at, now() - resume_at AS overdue
FROM automation_runs WHERE status = 'WAITING' AND resume_at < now() - interval '15 minutes' ORDER BY resume_at LIMIT 50;
SELECT count(*), min(resume_at) FROM automation_runs WHERE status = 'WAITING';   -- parked in total, next deadline
```
Overdue rows mean the worker or scanner is down (see the next sections); they resume by themselves on the next tick after recovery, in `resume_at` order, 200 per workspace per minute. To release one by hand: `UPDATE automation_runs SET resume_at = now() WHERE id = '<run id>' AND status = 'WAITING';` (the scanner resumes it on the next tick). To end one for good, set it SKIPPED: `UPDATE automation_runs SET status='SKIPPED', finished_at=now(), resume_at=NULL, waiting_node=NULL WHERE id='<run id>' AND status='WAITING';`. Runs pin an immutable version (`automation_versions`), so editing the automation does not change a waiting run.

## Redis down
- Queue processing pauses; the outbox keeps accumulating in Postgres (nothing lost) and drains after Redis returns. Queued runs are re-enqueued by the scanner.
- Rate limiting degrades to per-instance memory counters (limits weaker across replicas).
- Restore Redis, then confirm: outbox backlog falls, `automation_runs` QUEUED count falls.

## Worker restarts / deploys
Shutdown hooks close workers cleanly. A worker killed mid-run leaves the run `RUNNING`; it is requeued after 10 minutes. AI turns run in the API process (not the worker): a crash mid-turn leaves a stale `RUNNING` ai_run that expires after 3 minutes, and the scanner re-triggers an unanswered customer message once (90 seconds to 6 hours old).

## Running tests next to a worker
Any API or worker with `WORKERS_ENABLED=true` on the same database (an e2e server on port 4100, `apps/worker`, a background API left running) claims outbox events of **every** workspace, including those of a running test suite, and executes automations with its own providers. Tests that inject failures in their own process (the "real BullMQ workers" test) then see runs end differently. Before running `pnpm test`: stop e2e servers and stray background APIs (`pgrep -fl dist/main.js`; the dev API from `pnpm dev` is fine, it has workers off). The BullMQ test skips itself with a warning when it detects another consumer. The same goes for the webhook delivery tests (`webhooks-outbound.test.ts`): `JobsService` also drains webhook deliveries of every workspace, with the e2e API's own settings (private targets blocked, different retry limits), so a foreign worker marks the test's localhost deliveries "Blocked" or changes their attempt counts and a wait times out (reproduced: 5 of 8 runs failed with an e2e-style API running, 0 of 25 quiet or CPU-loaded runs). Both tests share `foreignOutboxConsumerPresent()` in `apps/api/test/helpers.ts`, which probes with three `test.noop` outbox events for up to 3 seconds and treats any claim as foreign; a consumer that starts later than that can still cause a failure, and the timeout message then names it.
