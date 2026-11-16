# API specification (through Phase 4)

Base URL `http://localhost:4000`. JSON everywhere. Errors: `{ "error": { "code", "message", "details?", "requestId" } }`.
Auth: httpOnly cookies (browser) or `Authorization: Bearer <access token>` (API clients; send `x-token-delivery: body` on login to receive tokens in the body). Tenant context always comes from the validated membership, never from request input. The OpenAPI/Swagger UI is **not yet generated** (planned for Phase 7); this file is the interim reference and is maintained by hand.

Permission column: the permission key required. "own/all" = row scope, enforced in the service (`lead:read:all` sees every lead, `lead:read:own` only assigned ones; others' leads return 404).

## Auth (Phase 1)
`POST /auth/register` · `login` · `refresh` · `logout` · `verify-email` · `resend-verification` · `forgot-password` · `reset-password` · `switch-workspace` · `GET /auth/me` · `GET|DELETE /auth/sessions[/:id]` · `POST /auth/invitations/preview|accept`

## Workspace & team (Phase 1/2)
| Endpoint | Permission |
|---|---|
| `GET|PATCH /tenant` | member / `settings:manage` |
| `GET|PUT /tenant/onboarding` | member / `settings:manage` |
| `GET|PUT /tenant/assignment` (`manual`\|`round_robin`) | member / `settings:manage` |
| `GET /team/members`, `GET /roles` | `team:read` |
| `POST|DELETE /team/invitations`, `GET /team/invitations` | `team:invite` |
| `PATCH /team/members/:id/role|status` | `team:manage` |
| `GET /team/workload` | `analytics:read:team` |
| `GET /audit-logs?action&cursor&limit` | `audit:read` |

## Leads (Phase 2)
| Endpoint | Notes |
|---|---|
| `GET /leads` | `q, stageId, kind, temperature, assigned (me/unassigned/id), sourceId, tagId, createdFrom/To, overdue, sort, dir, page, pageSize<=100` → `{items,total,page,pageSize}` |
| `POST /leads` | 409 `duplicate_lead` (with `details`) unless `allowDuplicate:true`. Agents' leads are auto-assigned to themselves; otherwise the workspace assignment rule applies |
| `GET|PATCH|DELETE /leads/:id` | delete needs `lead:delete` (soft) |
| `POST /leads/:id/stage` | `{stageId, lostReasonId?, lostNote?}`; 422 `stage_transition_not_allowed`, 400 `lost_reason_required`, 403 `reopen_not_allowed` |
| `PUT /leads/:id/tags` · `GET|POST /leads/:id/notes` · `GET /leads/:id/activity` | |
| `POST /leads/:id/merge` | `lead:write:all`; `{sourceIds}` |
| `POST /leads/bulk` | `assign` (`lead:assign`) · `stage` · `tag` · `delete` (`lead:delete`); returns `{updated, skipped[]}` |
| `POST /leads/import` | `lead:import`; `{csv, dryRun, duplicateStrategy}` → report |
| `GET /leads/export` | `lead:export`; CSV, same filters as list |
| `POST /leads/check-duplicates`, `GET /leads/meta`, `GET /leads/tags` | |

## Pipeline (Phase 2)
`GET /pipeline/stages`, `GET /pipeline/board` (any member, scoped) · `POST /pipeline/stages`, `PATCH|DELETE /pipeline/stages/:id`, `POST /pipeline/stages/reorder`, `POST|PATCH /pipeline/lost-reasons[/:id]` (`pipeline:manage`)

## Properties (Phase 2)
`GET /properties` (`property:read`) · `POST /properties`, `PATCH|DELETE /properties/:id`, `POST /properties/import` (`property:manage`)

## Lead capture (Phase 2)
`POST /public/leads` with header `x-api-key: lp_live_…` (server-to-server; 60 req/min/IP). Body `{name, phone|email, message?, source?, location?, budgetMin?, budgetMax?, propertyType?}` → `201 {id, duplicate}`. Keys: `GET|POST /api-keys`, `DELETE /api-keys/:id` (`integration:manage`); the full key is returned once.

## Analytics (Phase 2)
`GET /analytics/overview?range=today|yesterday|7d|30d|month|custom&from&to` (`analytics:read:all` or `:own`). Metric definitions are in `apps/api/src/analytics/analytics.module.ts`.

## Conversations (Phase 3)
Scope: `conversation:read:all` sees every conversation, `conversation:read:own` only those assigned to the caller (404 otherwise). `conversation:reply` is needed for every action except reading; `conversation:assign` for assignment.
| Endpoint | Notes |
|---|---|
| `GET /conversations` | `status, mode, assigned (me/unassigned/id), channelType, unread, q, page, pageSize` → `{items,total,unreadTotal}` |
| `GET /conversations/:id` · `GET …/messages?before=` · `GET|POST …/notes` · `PUT …/tags` | |
| `POST …/messages` | `{text}` or `{template:{name,language,params}}`, optional `idempotencyKey`. 422 `outside_window`, `opted_out`, `consent_required`, `unknown_template`, `template_params`, `channel_unavailable`; 409 `join_required` |
| `POST …/messages/:mid/retry` | failed outbound messages only |
| `POST …/read`, `assign`, `close`, `reopen`, `takeover`, `handback` | handback returns 409 `ai_not_configured` until phase 4 |
| `GET …/messages/:mid/media` | proxied from the provider; images inline, other types download |
| `GET /realtime/stream` | server-sent events: `message.created`, `message.status`, `conversation.updated` (ids only; refetch the data) |

## Channels and widget admin (Phase 3, `integration:manage`)
`GET /channels` · `POST /channels/whatsapp` (verifies with WhatsApp first) · `POST /channels/:id/test` · `PUT /channels/:id/credentials` · `DELETE /channels/:id` (disable) · `GET|POST|DELETE /whatsapp/templates` (read needs `conversation:reply`) · `GET|PUT /widget-config` · `POST /widget-config/rotate-key`

## Public endpoints (no cookies)
`GET|POST /webhooks/whatsapp/:key` (HMAC-authenticated, see ADR-0013) · `GET /widget.js` · `GET /widget/config?key` · `POST /widget/sessions` · `GET|POST /widget/messages` (bearer session token). All widget calls require an allow-listed `Origin`.

## AI assistant (Phase 4, `ai:configure`)
`GET|PUT /ai/assistant` (settings; `PUT` validates tools, hours, limits) · `GET /ai/usage` (tokens vs cap, `warning` at 80%, `exceeded`) · `GET /ai/runs` (last 50 replies: status, tools, tokens, latency, guard decisions; no customer text) · `GET /scoring/rules` (any member) · `PUT /scoring/rules` (versioned, re-scores all leads)

## Lead scoring
`GET /leads/:id/score` (breakdown by signal as met / not_met / unknown, history) · `POST /leads/:id/score/override` `{score, reason}` (`lead:score:override`) · `DELETE /leads/:id/score/override`

## Knowledge base (Phase 4, `knowledge:manage`)
`POST /knowledge/documents` (multipart `file`, optional `title`, `category`; PDF/DOCX/TXT/CSV ≤ 10 MB; 422 `unsupported_file` / `malware_detected`, 503 `scanner_unavailable`) · `GET /knowledge/documents[/:id]` (status PENDING→PROCESSING→READY|FAILED, preview) · `PATCH|DELETE /knowledge/documents/:id` · `POST …/:id/reprocess` · `GET …/:id/download` (attachment) · `POST /knowledge/search` `{q, limit}`

Conversation `mode: AI` is set automatically for new conversations while the assistant is on; `takeover` / `handback` switch it. `handback` returns 409 `ai_not_configured` when the assistant is off.

## Appointments (Phase 5: `appointment:read:own|all`, `appointment:write`)
`GET /appointments?from&to&status&membershipId&leadId` (agents see only their own; response includes `timezone`) · `GET /appointments/slots?from=YYYY-MM-DD&days&durationMinutes&membershipId` · `POST /appointments` `{leadId, membershipId?, startsAt, durationMinutes, location?, notes?, outsideHours?}` (409 `slot_taken` / `lead_busy`, 422 `outside_hours` / `in_the_past`) · `GET|PATCH /appointments/:id` · `POST /appointments/:id/{confirm|complete|no-show|cancel|reschedule}` (409 `invalid_transition`) · `GET|PUT /appointments/availability?membershipId=<id|default>` · `POST|DELETE /appointments/availability/exceptions[/:id]`

## Automations (`automation:manage`)
`GET /automations` · `GET /automations/templates` · `POST /automations` · `POST /automations/from-template` `{templateKey}` · `GET|PUT|DELETE /automations/:id` · `POST /automations/:id/enable` `{enabled}` · `POST /automations/:id/dry-run` `{leadId, appointmentId?}` · `GET /automations/runs?automationId&status&cursor` · `POST /automations/runs/:id/retry`

## Notifications, tasks, SLA, usage
`GET /notifications?unread&before` · `GET /notifications/unread-count` · `POST /notifications/:id/read` · `POST /notifications/read-all` · `GET|PUT /notifications/preferences` · SSE event `notification.created` on `/realtime/stream` · `GET|POST /tasks`, `PATCH|DELETE /tasks/:id` · `GET|PUT /sla` (write needs `settings:manage`) · `GET /usage` (`usage:read`)

## Billing (Phase 6)
All `/billing/*` routes keep working when a workspace is read-only. `GET /billing/summary` is open to every member (banners); the rest need `billing:manage`.
`GET /billing/summary` (plan, effective status, `restricted`, dates, limits, features, `usage`, provider mode) · `GET /billing/plans` · `GET|PUT /billing/profile` `{legalName, gstin?, stateCode, addressLine, city?, pincode?}` · `POST /billing/subscribe` `{planKey}` → `{subscriptionId, keyId, mode, amountMinor (incl. GST), …}` (409 `billing_profile_required` / `already_subscribed`) · `POST /billing/change-plan` `{planKey}` → `{effective: now|cycle_end}` (409 `over_quota` with `details: [{key,label,used,allowed}]`, `payment_due`, `same_plan`, `no_active_subscription`) · `POST /billing/cancel` · `GET /billing/invoices[/:id]` · `POST /billing/mock/simulate` `{kind}` (mock provider outside production only; 404 otherwise)
`POST /webhooks/razorpay` (public; header `X-Razorpay-Signature`, optional `X-Razorpay-Event-Id`): 200 `{status: processed|ignored|duplicate}`, 401 bad signature, 5xx = please retry.
**Plan errors (HTTP 402):** `subscription_required` (workspace read-only), `feature_not_in_plan` (`details.feature`), `quota_exceeded` (`details.limit`, `details.allowed`).

## Platform console (`/platform/*`, separate auth; disabled unless `PLATFORM_JWT_SECRET` is set)
`POST /platform/auth/login|logout` · `GET /platform/me` · `GET /platform/metrics` (MRR in paise ex-GST, tenants, subscriptions, by plan, AI tokens) · `GET /platform/tenants?search&status&plan&limit&offset` · `GET /platform/tenants/:id` · `POST /platform/tenants/:id/{suspend|reactivate}` `{reason}` · `POST /platform/tenants/:id/plan` `{planKey, mode: complimentary|trial, days?, reason}` (409 `has_paid_subscription`) · `GET|POST /platform/plans` · `PATCH /platform/plans/:key` · `GET /platform/audit`. Reasons are mandatory and recorded in both the platform log and the tenant's audit log.

## Privacy (Phase 7, data-principal rights)
`GET /privacy/leads/:id/export` (`lead:export` + `lead:read:all`: managers and owners) returns everything held about the lead (profile, notes, activity, consents, scores, appointments, tasks, conversations and messages, merged duplicates). `POST /privacy/leads/:id/erase` `{reason, confirm: "ERASE"}` (`lead:delete`: owners) irreversibly deletes it all, including raw webhook payloads mentioning the phone number; returns row counts; 404 for unknown or other-tenant ids. Both are audited (`privacy.lead_exported`, `privacy.lead_erased`; counts and reason only).
`GET /health` liveness · `GET /health/ready` → `{status, db, redis}` (503 only when the database is down).
