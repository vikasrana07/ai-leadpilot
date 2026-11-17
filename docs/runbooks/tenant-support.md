# Tenant support and the platform console

Console: `/platform` on the web app (separate login `/platform/login`; disabled unless `PLATFORM_JWT_SECRET` is set). Admins are created only by the schema owner:
```
PLATFORM_ADMIN_PASSWORD='<long passphrase>' pnpm --filter @leadpilot/database platform:create-admin <email> "<name>"
```
(In a container: `node dist/create-platform-admin.js <email> "<name>"` from `/app/node_modules/@leadpilot/database` with `DATABASE_OWNER_URL` set.) Disable an admin: `UPDATE platform_admins SET status='DISABLED' WHERE email='<email>'` (effective on their next request). 5 failed logins lock an account for 15 minutes. Platform admins can enrol TOTP MFA from the console's Security page.

## Lost phone: resetting someone's two-step verification
- **Single-workspace user:** a workspace owner or manager opens Team, the member's menu, "Reset two-step verification", and gives a reason. The person is signed out, emailed, and re-enrols at next sign-in. Verify identity out of band first (for example a call to a known number). Audited as `team.mfa_reset`.
- **User in several workspaces** (the UI refuses, because MFA is account-wide): verify identity, then as the owner role run `DELETE FROM mfa_recovery_codes WHERE subject_type='user' AND subject_id='<user uuid>'; DELETE FROM mfa_credentials WHERE subject_type='user' AND subject_id='<user uuid>'; UPDATE sessions SET revoked_at=now() WHERE user_id='<user uuid>' AND revoked_at IS NULL;` and record who asked and why in your ticket.
- **Platform admin:** same SQL with `subject_type='platform_admin'`.

**There is no impersonation.** Support cannot "log in as" a customer by design. Diagnose with the console's tenant detail (owners, subscription, entitlements, usage, invoices, recent activity), the tenant's audit log, and the tables above; ask the customer to share a screen or screenshots for UI issues.

## Actions (each requires a written reason; recorded in `platform_audit_logs` AND the tenant's own audit log)
| Need | Console action | Effect |
|---|---|---|
| Stop an abusive/compromised workspace | Tenant > Suspend | Members get `workspace_access_denied` on every request; data kept; AI/automations stop acting on new events |
| Resume | Tenant > Reactivate | Immediate |
| Goodwill / pilot / extension | Tenant > Assign plan: complimentary (optional days) or trial (days) | Sets manual subscription; refused while a live paid subscription exists |
| Change what a plan includes | Plans > Edit | Applies to all subscribers immediately; price changes affect only new subscribers |

## Read-only (lapsed) workspaces
Trial ended, grace over, or cancelled period over: writes return HTTP 402 `subscription_required`; the customer can still view/export and use Billing. Not a bug. Fix by payment, or a complimentary plan with a reason.

## Common requests
- "I can't invite teammates": seat limit (402 `quota_exceeded`) counts members + pending invitations; or email unverified.
- "AI stopped replying": plan lacks the AI assistant, plan token cap reached, lapse, or kill switch ([ai-incident.md](ai-incident.md)).
- "No reminders": worker not running ([worker-and-queues.md](worker-and-queues.md)), or WhatsApp templates not registered (runs are skipped with a reason in run history).
- Audit trail for a tenant: `SELECT created_at, action, actor_user_id, metadata FROM audit_logs WHERE tenant_id='<tenant-id>' ORDER BY created_at DESC LIMIT 100;`
- Data export for a tenant: leads CSV export exists (plan-gated). **A full export/erasure workflow is not built** (see [data-breach-dpdp.md](data-breach-dpdp.md) and the launch checklist).
