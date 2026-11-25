# Roles and access

Who can sign in to LeadPilot, what each kind of user can see and do, and what the operator of the platform can and cannot see of a customer's data.

## The kinds of user

| Who | How they sign in | What they are for |
|---|---|---|
| **Platform admin** | `/platform/login` (separate login, cookie, 30-minute sessions, optional MFA) | Runs the whole system: plans, tenants, billing metrics, support. Not part of any workspace. |
| **Workspace user** | `/login` | A business's team: Business Owner, Sales Manager, Sales Agent, or a custom role. |
| **Lead / customer** | A one-time login code for the customer portal; or no login at all (website chat widget) | Not staff. A lead is a record in the CRM. A customer can only reach their own portal. |
| **Machine caller** | API key (public lead capture and `/v1`), or a signed webhook (WhatsApp, SES, Razorpay) | Integrations, not people. |

Every workspace's data is isolated from every other workspace by database row-level security, in addition to the checks in the API.

## Workspace roles

Three roles are built in. They are copied into each workspace when it is created, and `pnpm db:migrate` re-syncs them with the code (it prints "System roles synced"), so a permission added in a release reaches existing workspaces. Owners can also create **custom roles** from the same permission list under *Roles & Permissions*.

| Role | Permissions | In short |
|---|---|---|
| **Business Owner** | 39 of 39 | Everything, including billing, roles, integrations, the audit log, workspace settings, erasing a lead and removing members. |
| **Sales Manager** | 30 | All leads, conversations, appointments, analytics and emails; assigning work; pipeline, automations, campaigns, properties; inviting teammates. Not billing, roles, integrations, the audit log, settings, AI configuration, knowledge base, deleting leads or removing members. |
| **Sales Agent** | 10 | Their **own** leads, conversations, appointments, emails and performance only. Reply, book appointments, view properties and the team list. |

"Own" means records assigned to that person. The API enforces this: the screens only mirror it.

## Full permission matrix

**Leads**

| Permission | What it allows | Owner | Manager | Agent |
|---|---|:-:|:-:|:-:|
| `lead:read:own` | View leads assigned to me | ✓ | ✓ | ✓ |
| `lead:read:all` | View all leads in the workspace | ✓ | ✓ | – |
| `lead:write:own` | Edit leads assigned to me | ✓ | ✓ | ✓ |
| `lead:write:all` | Create and edit any lead | ✓ | ✓ | – |
| `lead:delete` | Delete leads | ✓ | – | – |
| `lead:assign` | Assign leads to team members | ✓ | ✓ | – |
| `lead:import` | Import leads from CSV | ✓ | ✓ | – |
| `lead:export` | Export leads to CSV | ✓ | ✓ | – |
| `lead:score:override` | Override lead scores | ✓ | ✓ | – |

**Pipeline and properties**

| Permission | What it allows | Owner | Manager | Agent |
|---|---|:-:|:-:|:-:|
| `pipeline:manage` | Configure pipeline stages | ✓ | ✓ | – |
| `property:read` | View property inventory | ✓ | ✓ | ✓ |
| `property:manage` | Manage property inventory | ✓ | ✓ | – |

**Conversations**

| Permission | What it allows | Owner | Manager | Agent |
|---|---|:-:|:-:|:-:|
| `conversation:read:own` | View my conversations | ✓ | ✓ | ✓ |
| `conversation:read:all` | View all conversations | ✓ | ✓ | – |
| `conversation:reply` | Reply in conversations | ✓ | ✓ | ✓ |
| `conversation:assign` | Assign conversations | ✓ | ✓ | – |

**Appointments**

| Permission | What it allows | Owner | Manager | Agent |
|---|---|:-:|:-:|:-:|
| `appointment:read:own` | View my appointments | ✓ | ✓ | ✓ |
| `appointment:read:all` | View all appointments | ✓ | ✓ | – |
| `appointment:write` | Create and change appointments | ✓ | ✓ | ✓ |

**AI and knowledge**

| Permission | What it allows | Owner | Manager | Agent |
|---|---|:-:|:-:|:-:|
| `ai:configure` | Configure the AI assistant | ✓ | – | – |
| `knowledge:manage` | Manage knowledge base documents | ✓ | – | – |

**Automations and campaigns**

| Permission | What it allows | Owner | Manager | Agent |
|---|---|:-:|:-:|:-:|
| `automation:manage` | Manage automations | ✓ | ✓ | – |
| `campaign:read` | View broadcast campaigns | ✓ | ✓ | – |
| `campaign:manage` | Create, edit, schedule, and cancel broadcast campaigns | ✓ | ✓ | – |

**Email tracking**

| Permission | What it allows | Owner | Manager | Agent |
|---|---|:-:|:-:|:-:|
| `email:read:own` | View tracked emails sent to my leads | ✓ | ✓ | ✓ |
| `email:read:all` | View all tracked emails in the workspace | ✓ | ✓ | – |
| `email:suppress:manage` | View and change the email suppression list | ✓ | ✓ | – |

**Analytics**

| Permission | What it allows | Owner | Manager | Agent |
|---|---|:-:|:-:|:-:|
| `analytics:read:own` | View my performance | ✓ | ✓ | ✓ |
| `analytics:read:team` | View team analytics | ✓ | ✓ | – |
| `analytics:read:all` | View all analytics and reports | ✓ | ✓ | – |

**Administration**

| Permission | What it allows | Owner | Manager | Agent |
|---|---|:-:|:-:|:-:|
| `team:read` | View team members | ✓ | ✓ | ✓ |
| `team:invite` | Invite team members | ✓ | ✓ | – |
| `team:manage` | Change roles, deactivate and remove members | ✓ | – | – |
| `role:manage` | Manage roles and permissions | ✓ | – | – |
| `integration:manage` | Manage integrations | ✓ | – | – |
| `billing:manage` | Manage subscription and billing | ✓ | – | – |
| `usage:read` | View usage | ✓ | ✓ | – |
| `audit:read` | View audit logs | ✓ | – | – |
| `settings:manage` | Manage workspace settings | ✓ | – | – |
Source of truth: `packages/shared-types/src/permissions.ts` (`PERMISSIONS` and `SYSTEM_ROLES`). If this page and the code disagree, the code wins; regenerate the tables from it.

## Two-step verification

Every user can turn on TOTP under *Security*. An owner can require it for the whole workspace: members without it are held at that page. Platform admins enrol at `/platform/security`; `PLATFORM_REQUIRE_MFA` makes it mandatory (on by default in production, off in development).

## Can a platform admin see a customer's data?

**By default, no: only account-level information. Customer content is behind a separate, time-boxed, read-only, audited, owner-controlled "support access" session.**

### What the platform console shows (always)
For each workspace: name, contact email, industry, plan and status, creation date; the owners' names and emails; plan entitlements; usage counters; subscription and billing state; invoices; and the **names and times** of recent audit events. Plus system-wide metrics (for example MRR) and the platform's own audit log.

It does **not** show leads, conversations, messages, notes, appointments, contacts or files. There is no "log in as the customer": **there is no impersonation**.

### What a platform admin can *do* to a workspace
Suspend or reactivate it, assign a complimentary or trial plan, and edit plans. Each action needs a written reason and is recorded in the platform audit log **and** in the workspace's own audit log.

### Support access (the only route to customer content)
When a customer needs help that the console cannot answer, an admin can open a support session:

- It needs the admin's **password again** and a **written reason**.
- It lasts at most **30 minutes** and then expires.
- It is **read-only**: only reads are allowed, never changes.
- Secrets, people, money, settings and bulk data are blocked outright: `/auth`, `/api-keys`, `/webhooks`, `/integrations`, `/channels`, `/billing`, `/privacy`, `/team`, `/roles`, `/audit-logs`, `/knowledge`, the AI assistant configuration and runs, MFA and security, notifications, `/v1`, and anything that exports, downloads or serves media.
- It is **recorded in both audit logs** (`support.session_started` in the workspace's log, `platform.support_session_started` in the platform's), with the admin's name, the reason and the IP.
- **The workspace owner controls it.** Under *Settings → Support access* an owner can switch it off; a session request is then refused (and the refusal is logged).

### What the platform admin role does not protect against
Platform admins use the application's database role, which row-level security confines to one workspace at a time. **Anyone holding the schema-owner database credential (`DATABASE_OWNER_URL`) bypasses row-level security** and can read everything. That is an operations-level privilege (the same people who run migrations and backups), not part of the product's roles. Keep it out of application containers and limit who holds it; see `docs/security-review.md` and `docs/threat-model.md`.

## Creating and administering platform admins

There is no default admin and none can be created from the app. See *Billing and the platform console* in [setup-guide.md](setup-guide.md) for the command, and [runbooks/tenant-support.md](runbooks/tenant-support.md) for lockouts, MFA resets and support actions.
