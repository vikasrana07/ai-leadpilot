# External uptime probe

> **Alert that points here:** none of the in-app alert rules (see `docs/monitoring.md`). This is the one check that must live **outside** the application. SLO 1 (availability, `docs/slos-and-alerts.md`) is measured only by this probe, and the Sev 1 alert "API down" is wired from it.

## Why it is required
The application evaluates its own alert rules and emails platform admins. **An app that is down cannot email.** If every API and worker process is dead, if the database or Redis is unreachable, if DNS or the certificate is broken, or if the load balancer has no healthy target, nothing inside the product notices. Only a check that runs somewhere else can. The CloudWatch alarm on the load balancer's healthy-host count (`infrastructure/monitoring/cloudwatch-alarms.example.yml`) covers part of this, but not DNS, certificates or the load balancer itself, so keep the external probe as well.

Send the probe's alert to a **different channel from the in-app email** (a different mailbox, or a phone notification), so one broken mail path cannot hide both.

## What to probe
| Target | Expect | Why |
|---|---|---|
| `GET https://<api-host>/health/ready` | HTTP 200 and the JSON body `{"status":"ready","db":"up","redis":"up"}` | The API is serving and can reach the database (a 503 `db_unavailable` means the database is down). Redis down is reported in the body but still returns 200: treat `"redis":"down"` as a warning. |
| `GET https://<web-host>/` | HTTP 200 | The web app is serving. |

Cadence: every 1 minute, from at least one location outside your AWS region. **Fire the Sev 1 alert after 3 consecutive failures** (about 3 minutes), as in `docs/slos-and-alerts.md`. Do not alert on a single failure: deploys and one-off network blips cause those.

`/health` (liveness only, no dependency check) exists for the container health check; do not use it for the uptime probe, because it still answers when the database is gone.

## The probe script
`scripts/probe-health.mjs` is a dependency-free Node script (Node 22) that checks one URL and exits non-zero on failure. It sends no credentials and reads no files.

```
node scripts/probe-health.mjs https://api.example.com/health/ready --expect-ready
OK 200 (84 ms) https://api.example.com/health/ready

node scripts/probe-health.mjs https://api.example.com/health/ready --expect-ready
FAIL status 503 (31 ms) https://api.example.com/health/ready      # exit code 1
```
| Option | Meaning |
|---|---|
| `--expect-ready` | The body must be JSON with `status` `ready` and `db` `up`. Redis `down` only prints `WARNING redis=down` (exit 0). |
| `--strict-redis` | With `--expect-ready`: also fail when Redis is not `up`. |
| `--timeout <ms>` | Give up after this long (default 5000). |
| `--quiet` | Print nothing on success (a warning is still printed). |

Exit codes: `0` healthy, `1` unhealthy (non-2xx, timeout, network error, wrong body), `2` bad usage. It is covered by `apps/api/test/probe-health.test.ts` (against a local test server).

## Options for running it (pick one; none needs a paid tool)
1. **A free-tier uptime monitor** from any provider that offers HTTP checks every minute with alerts on N consecutive failures. Point it at the two URLs above and keyword-match `"status":"ready"` on the API check. Check the provider's free limits and where it runs (it receives only the health response, which holds no personal data).
2. **An AWS-native check** (CloudWatch Synthetics canary, or a Route 53 health check with a CloudWatch alarm). Both work, but each has a monthly cost per check and canaries run inside AWS, so a regional problem can take the check down with the app. Verify current pricing before choosing this as the only probe.
3. **A cron job on a different machine** (a small VPS, an office server, a Raspberry Pi) that runs the script every minute and alerts after 3 failures in a row, for example by email through a different SMTP account or by an HTTPS webhook to a chat tool. Sketch (untested):
   ```
   * * * * * node /opt/leadpilot/scripts/probe-health.mjs https://api.example.com/health/ready --expect-ready --quiet >> /var/log/lp-probe.log 2>&1 || echo "$(date -u +%FT%TZ) FAIL" >> /var/lib/lp-probe/failures
   ```
   and a second small job that raises the alert when the last 3 lines of `failures` are consecutive minutes. Keep the logic simple; a monitoring SaaS does this for you.

## Test it (locally, no AWS)
1. Start the API on your machine, then run `node scripts/probe-health.mjs http://localhost:4000/health/ready --expect-ready`. Expect `OK 200`.
2. Stop the API process (Ctrl+C on the terminal running it) and run the probe again. Expect `FAIL network error: ...` and exit code 1 (`echo $?`).
3. Stop only the database container: the API stays up but `/health/ready` returns 503, so the probe prints `FAIL status 503`. This is the case that distinguishes `/health/ready` from `/health`.
4. Start everything again and confirm the probe returns to `OK`.
5. To rehearse the alert path end to end, wire the probe into the option you chose, stop the API for 4 minutes, confirm the Sev 1 alert arrives on the separate channel, restart, confirm the recovery message.

## What this does not cover
Slow responses (the in-app `RequestDurationP95Ms` metric and CloudWatch alarms cover SLO 2 and 3), partial outages of one workspace, and background processing (the in-app alerts cover the worker, queues and webhooks). When the probe fires, follow `docs/runbooks/incident-response.md`.
