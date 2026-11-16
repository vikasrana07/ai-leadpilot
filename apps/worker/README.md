# apps/worker

Runs the background process: outbox relay, BullMQ automation queue and the minute scheduler (reminders, inactivity, tasks due, SLA, AI-turn recovery).

The code is `apps/api/src/worker.ts` plus `apps/api/src/ops/`, so business logic exists once (see `docs/architecture.md` §2).

```
pnpm --filter @leadpilot/api build
pnpm --filter @leadpilot/worker start     # needs the same .env as the API
```
Run any number of workers: events are claimed with `FOR UPDATE SKIP LOCKED`, runs with a compare-and-set, scanners with `event_marks`.
For single-process development set `WORKERS_ENABLED=true` for the API instead.
