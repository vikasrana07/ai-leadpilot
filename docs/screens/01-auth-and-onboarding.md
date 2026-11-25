# 01 — Auth, Public & Onboarding Screens

This document covers all unauthenticated entry screens, account recovery/invitation flows, initial workspace setup, and standalone public/printable pages.

---

## `/` — Root Redirect

- **Route & Access**: `/` (Public)
- **What It Does**: Entry point that immediately redirects visitors into the workspace app.
- **User Flow**:
  1. Visiting `/` triggers a server-side redirect to `/dashboard`.
  2. If the user is not signed in, the `(app)` layout catches the `401` and redirects to `/login?next=%2Fdashboard`.
- **Navigation & Direction**:
  - **Incoming**: Direct URL / bookmark.
  - **Outgoing**: Redirects to `/dashboard` (which bounces to `/login` if unauthenticated).
- **Technical Reference**: `apps/web/app/page.tsx`

---

## `/login` — Sign In

- **Route & Access**: `/login` (Public; supports `?next=<path>` redirect parameter)
- **What It Does**: Authenticates workspace users via email & password (with Cloudflare Turnstile bot protection), two-step verification (MFA), or corporate Single Sign-On (OIDC / SAML 2.0).
- **User Flow**:
  1. **Standard Login**: Enter email and password, complete bot check if active, and click **Sign in**.
  2. **MFA Step** *(if enabled on account)*: Switches to the verification view. Enter a 6-digit authenticator code (or click **Use a recovery code** for a one-time backup code) and click **Verify**.
  3. **Company SSO**: Click **Sign in with company SSO**, enter the workspace slug (e.g. `skyline-realty`), and click **Continue with SSO** to redirect to the corporate Identity Provider.
- **Navigation & Direction**:
  - **Incoming**: Redirect from any protected `(app)` route or `/invoice/[id]`, or links from `/register`, `/verify-email`, `/forgot-password`, `/reset-password`, `/accept-invite`.
  - **Outgoing**:
    - Success -> `?next` path (if safe relative path) or `/dashboard`.
    - **Forgot password?** -> `/forgot-password`.
    - **Create an account** -> `/register`.
    - **Continue with SSO** -> External IdP -> returns to `/auth/sso/callback`.
- **Technical Reference**: `apps/web/app/(auth)/login/page.tsx` · `POST /auth/login`, `POST /auth/mfa/verify`, `GET /auth/sso/initiate`

---

## `/register` — Create Workspace

- **Route & Access**: `/register` (Public)
- **What It Does**: Registers a new user and provisions a new LeadPilot workspace (tenant).
- **User Flow**:
  1. Enter **Your name**, **Work email**, **Business name**, and **Password** (10+ chars with upper, lower, and number).
  2. Click **Create workspace**.
  3. If immediate session is returned, the user is signed in and sent to onboarding; otherwise, a "Check your email" confirmation screen is shown.
- **Navigation & Direction**:
  - **Incoming**: Link from `/login` ("Create an account").
  - **Outgoing**:
    - Immediate sign-in -> `/onboarding`.
    - **Sign in** link -> `/login`.
- **Technical Reference**: `apps/web/app/(auth)/register/page.tsx` · `POST /auth/register`

---

## `/auth/sso/callback` — SSO Callback Handler

- **Route & Access**: `/auth/sso/callback` (Public; expects `?code=...&state=...` or `?error=...`)
- **What It Does**: Completes OIDC Single Sign-On after the corporate Identity Provider redirects back to LeadPilot.
- **User Flow**:
  1. Reads `code` and `state` from URL query parameters and exchanges them with the backend.
  2. Displays a loading spinner ("Completing Single Sign-On…") while verifying, or an error alert if the IdP returned an error or missing params.
- **Navigation & Direction**:
  - **Incoming**: Redirect from corporate Identity Provider after `/login` SSO initiation.
  - **Outgoing**:
    - Success -> `/dashboard`.
    - Error -> **Back to sign in** button -> `/login`.
- **Technical Reference**: `apps/web/app/(auth)/auth/sso/callback/page.tsx` · `POST /auth/sso/callback/oidc`

---

## `/verify-email` — Email Verification

- **Route & Access**: `/verify-email?token=<token>` (Public)
- **What It Does**: Consumes a single-use email verification token to confirm the user's email address.
- **User Flow**:
  1. Automatically submits the `token` query parameter on load (no retry on single-use token).
  2. Shows either a success state ("Your email is verified") or an invalid/expired error state.
- **Navigation & Direction**:
  - **Incoming**: Verification link sent to user's email.
  - **Outgoing**:
    - Success -> **Continue** -> `/dashboard`.
    - Error -> **Go to sign in** -> `/login`.
- **Technical Reference**: `apps/web/app/(auth)/verify-email/page.tsx` · `POST /auth/verify-email`

---

## `/forgot-password` — Request Password Reset

- **Route & Access**: `/forgot-password` (Public)
- **What It Does**: Sends a password reset link (valid for 1 hour) to the user's email address.
- **User Flow**:
  1. Enter **Email**, pass bot check, and click **Send reset link**.
  2. Displays a generic confirmation banner regardless of whether the email exists.
- **Navigation & Direction**:
  - **Incoming**: **Forgot password?** link on `/login`, or invalid-token prompt on `/reset-password`.
  - **Outgoing**: **Back to sign in** -> `/login`.
- **Technical Reference**: `apps/web/app/(auth)/forgot-password/page.tsx` · `POST /auth/forgot-password`

---

## `/reset-password` — Choose New Password

- **Route & Access**: `/reset-password?token=<token>` (Public)
- **What It Does**: Resets the user's password using the emailed token and signs them out of all active devices.
- **User Flow**:
  1. Enter **New password** and **Confirm password**, then click **Update password**.
  2. On success, shows a toast notification and redirects to sign in.
- **Navigation & Direction**:
  - **Incoming**: Password reset link from email.
  - **Outgoing**:
    - Success -> `/login`.
    - Missing token -> **Request a new one** -> `/forgot-password`.
- **Technical Reference**: `apps/web/app/(auth)/reset-password/page.tsx` · `POST /auth/reset-password`

---

## `/accept-invite` — Accept Team Invitation

- **Route & Access**: `/accept-invite?token=<token>` (Public)
- **What It Does**: Lets an invited teammate preview their workspace & role and join the team.
- **User Flow**:
  1. Loads invitation details (workspace name, assigned role, invited email).
  2. **If user already has an account**: Prompts them to sign in if needed, then click **Accept invitation**.
  3. **If new user**: Prompts for **Your name** and **Password**, then click **Join workspace**.
- **Navigation & Direction**:
  - **Incoming**: Invitation email link sent from `/team` or `/onboarding`.
  - **Outgoing**:
    - Success -> `/dashboard`.
    - **Sign in** (existing user) -> `/login?next=/accept-invite?token=...`.
- **Technical Reference**: `apps/web/app/(auth)/accept-invite/page.tsx` · `POST /auth/invitations/preview`, `POST /auth/invitations/accept`

---

## `/onboarding` — Workspace Setup Checklist

- **Route & Access**: `/onboarding` (Authenticated workspace member, typically Owner)
- **What It Does**: Guided 7-step setup wizard that saves progress as you configure the workspace.
- **User Flow**:
  1. **Business details**: Name, phone, website, timezone.
  2. **Industry**: Choose Real estate, Coaching & education, Healthcare clinic, Home services, or Something else (tailors pipeline stages, lead fields, and wording).
  3. **Invite your team**: Send email invites (requires verified email & `team:invite`) or skip.
  4. **Connect WhatsApp**: Link via Facebook Embedded Signup (`Connect with Facebook`), enter Cloud API credentials manually, or skip.
  5. **Configure the AI assistant**: Enable the assistant, set its name, tone, languages, and business description (or skip / open `/ai-assistant`).
  6. **Upload knowledge**: Upload PDF/DOCX/TXT/CSV brochures and FAQs with live processing status (or skip / open `/knowledge`).
  7. **Qualification rules**: Toggle scoring criteria, adjust point weights and Hot/Warm thresholds (or skip).
  8. Completion screen shows **You are all set**.
- **Navigation & Direction**:
  - **Incoming**: Redirect after `/register`, or **Continue setup** button on `/dashboard`'s Setup Card.
  - **Outgoing**: **Go to dashboard** -> `/dashboard` (skipped steps can be completed later in `/settings`, `/integrations`, `/ai-assistant`, `/knowledge`).
- **Technical Reference**: `apps/web/app/(app)/onboarding/page.tsx` · `GET/PUT /tenant/onboarding`, `PATCH /tenant`, `POST /team/invitations`, `GET /channels`, `GET/PUT /ai/assistant`, `GET/POST /knowledge/documents`, `GET/PUT /scoring/rules`

---

## `/p/[key]` — Customer Portal

- **Route & Access**: `/p/[key]` (Public route; authenticated via OTP into an `lp_portal` httpOnly cookie; `noindex, nofollow`, `Cache-Control: no-store`)
- **What It Does**: Self-service customer portal for leads to view, confirm, reschedule, or cancel their appointments and submit DPDP data export/erasure requests.
- **User Flow**:
  1. **Sign in**: Enter phone number or email (`POST /portal/:key/code`), then enter the 6-digit OTP sent to the contact on file (`POST /portal/:key/verify`).
  2. **Appointments**: View upcoming and past appointments; click **Confirm**, **Reschedule** (picks from available 7-day slots), or **Cancel** (within workspace cutoff rules).
  3. **My Data & Privacy**: Submit a data export or data erasure request (`POST /portal/data-request`) which notifies workspace owners.
- **Navigation & Direction**:
  - **Incoming**: Shareable portal link configured in `/settings` (Customer Portal card).
  - **Outgoing**: **Sign out** clears the `lp_portal` session cookie and returns to the OTP sign-in view.
- **Technical Reference**: `apps/web/app/p/[key]/page.tsx` · `GET /portal/:key`, `POST /portal/:key/code`, `POST /portal/:key/verify`, `GET /portal/me`, `GET /portal/appointments`, `GET /portal/appointments/:id/slots`, `POST /portal/appointments/:id/confirm`, `POST /portal/appointments/:id/cancel`, `POST /portal/appointments/:id/reschedule`, `POST /portal/data-request`, `POST /portal/logout`

---

## `/data-deletion` — Meta Data Deletion Status

- **Route & Access**: `/data-deletion?code=<code>` (Public, no sign-in required)
- **What It Does**: Compliance status page linked by Meta/Facebook after a user initiates a WhatsApp Embedded Signup data-deletion callback.
- **User Flow**:
  1. Opens with `?code=<confirmation_code>`.
  2. Displays whether the request is `Received` or `Completed`, timestamp, explanation message, and confirmation code.
- **Navigation & Direction**:
  - **Incoming**: External link from Facebook/Meta settings.
  - **Outgoing**: Terminal informational page.
- **Technical Reference**: `apps/web/app/data-deletion/page.tsx` · `GET /webhooks/meta/data-deletion/:code`

---

## `/invoice/[id]` — Printable Tax Invoice

- **Route & Access**: `/invoice/[id]` (Authenticated; requires `billing:manage`)
- **What It Does**: Renders a clean, print-ready Indian GST Tax Invoice with Seller/Buyer legal details, GSTIN, Place of Supply, SAC, CGST/SGST or IGST breakdown, and total in INR.
- **User Flow**:
  1. Opens invoice by ID; redirects to `/login?next=/invoice/[id]` if unauthenticated.
  2. Click **Print / Save as PDF** to open the browser print dialog.
- **Navigation & Direction**:
  - **Incoming**: Invoice link from `/billing`.
  - **Outgoing**: Browser print/PDF export; redirects to `/login` on `401`.
- **Technical Reference**: `apps/web/app/invoice/[id]/page.tsx` · `GET /billing/invoices/:id`
