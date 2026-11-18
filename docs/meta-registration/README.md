# Meta registration: becoming a WhatsApp Tech Provider

**What this is.** LeadPilot's "Connect WhatsApp" button (Embedded Signup, ADR 0012) works only when LeadPilot is registered with Meta as a **Tech Provider**: a verified business with a Meta app that has been approved to act for other businesses' WhatsApp accounts. This folder is the checklist and the ready-to-adapt texts for that registration.

**Read this first.** Meta changes its process, screens and rules often. The steps below follow Meta's developer documentation as read on 2026-11-18 (links at the end). **Meta's current pages win over this document.** Nothing here has been tried with a real Meta app. Dates, review durations and limits are Meta's to state: this document does not guess them.

| File | Use |
|---|---|
| `README.md` (this file) | The order of work, who does what, what to prepare, how it maps to LeadPilot settings |
| `app-review-submission.md` | Text to paste into the App Review form (data use, why Advanced access) |
| `review-video-scripts.md` | Scripts for the screen recordings Meta asks for |
| `legal-wording.md` | Draft wording for the privacy policy, terms, DPA and sub-processor list (for your lawyer) |

## The order of work
Each step says **who** (you = the company, me = LeadPilot's builder/this repo, lawyer) and **what must exist first**.

### 0. Decide and gather (you, about a day)
- [ ] Decide the **legal entity** that will own the Meta app and be verified. Meta verifies a business, not a person.
- [ ] Gather what Business Verification typically asks for: legal business name, registered address, business phone number and email on the company's domain, website, and documents proving the business (commonly a certificate of incorporation or registration, GST registration, PAN, and a recent utility bill or bank statement showing the address). **Check Meta's current list of accepted documents** before you upload.
- [ ] Have these **public web pages** live on your own domain (Meta asks for them in the app settings and at review): a **privacy policy**, **terms of service**, a **contact/support page**, and the company website. LeadPilot already serves the data-deletion status page at `<WEB_ORIGIN>/data-deletion`. Use `docs/meta-registration/legal-wording.md` and `docs/legal/` as the starting point; **a lawyer must review** them first.
- [ ] Pick the **public addresses** (they must be HTTPS and reachable from the internet): the API (`<PUBLIC_API_URL>`) and the web app (`<WEB_ORIGIN>`). Until AWS is deployed, a staging deployment or a tunnel works for testing, but the **review recordings should show the real, stable address**.

### 1. Meta Business portfolio (you)
- [ ] Create a Meta Business portfolio (Business Manager) in the company's name.
- [ ] Add company administrators, each with two-step login on their Facebook account. Keep at least two admins so one person leaving cannot lock you out.

### 2. Business Verification (you; Meta decides)
- [ ] In the portfolio's Business settings, open the Security Center and complete **Business Verification** with the documents from step 0.
- [ ] Meta's Tech Provider guide says verification must be complete before App Review can start. If you link the verified business to the app when you create it, this step shows as done.

### 3. Create the app (you, with me on the settings)
- [ ] In Meta for Developers, create an app of the **Business** type, link it to the verified portfolio, and add the **WhatsApp** product.
- [ ] Note the **App ID** and **App Secret** (App settings, Basic). The secret goes only into your secret manager, never into the repo or chat.
- [ ] Fill in the **basic settings**: app name, icon, category, privacy policy URL, terms URL, contact email.
- [ ] Set the **Data deletion request URL** to `<PUBLIC_API_URL>/webhooks/meta/data-deletion` and the **Deauthorize callback URL** to `<PUBLIC_API_URL>/webhooks/meta/deauthorize` (LeadPilot answers both; see ADR 0012).
- [ ] Create the **Embedded Signup configuration** (in the app's Facebook Login for Business / WhatsApp Embedded Signup settings). It gives a **configuration ID**.
- [ ] Configure the **webhook**: callback URL `<PUBLIC_API_URL>/webhooks/whatsapp`, a verify token you invent (long and random), and subscribe the WhatsApp Business Account fields **`messages`** and **`account_update`**.
- [ ] Allow your web address in the Embedded Signup / Facebook Login domain settings if Meta asks (the pop-up only opens from allow-listed domains).

### 4. Put the values into LeadPilot (you, then me)
| Meta value | LeadPilot setting | Where it lives |
|---|---|---|
| App ID | `META_APP_ID` | environment / secret manager |
| App Secret | `META_APP_SECRET` | **secret manager only** |
| Embedded Signup configuration ID | `META_ES_CONFIG_ID` | environment |
| Webhook verify token | `META_WEBHOOK_VERIFY_TOKEN` | environment / secret manager |
| (switch) | `EMBEDDED_SIGNUP_MODE=live` and `WHATSAPP_MODE=live` | environment |

LeadPilot refuses to start in `live` mode unless all four values are set.

### 5. Test with the real Meta flow in development mode (me, with you present). This is "Milestone 4".
- [ ] While the app is in **development mode**, app admins/developers can usually run the Embedded Signup flow with a **test WhatsApp account and test number**. Use a staging environment with `EMBEDDED_SIGNUP_MODE=live`.
- [ ] I run the real pop-up and check each item in `docs/live-verification.md` (message shape, code exchange, token lifetime, webhook delivery, template listing, callbacks, security-policy hosts). Anything that differs from the mock gets fixed in the code.
- [ ] **Why before review:** the review recordings must show the real flow working. Also, Meta's pages say the older Embedded Signup versions 2 and 3 are being deprecated (dates in October 2026, already past). LeadPilot's code sends the version 3 setting: **check the current Embedded Signup version and Graph API version and update before recording.**

### 6. App Review (you submit; I supply texts and recordings)
- [ ] Request **Advanced access** for **`whatsapp_business_management`** and **`whatsapp_business_messaging`**. Meta's overview says that without Advanced access these permissions do not appear in the signup flow, so customers cannot grant them.
- [ ] Paste the texts from `app-review-submission.md` (how customer data is used, why access is needed).
- [ ] Upload the recordings made from `review-video-scripts.md`.
- [ ] Provide whatever Meta asks for access to test the app (usually a test user or instructions). **Create a dedicated demo workspace with fake data. Never share real customer data or reuse real passwords.**

### 7. Access Verification (you; if Meta asks)
- [ ] Third-party guides describe a separate step after approval that confirms the business is a Tech Provider. Check whether it applies in Meta's current flow.

### 8. Go live (you)
- [ ] Switch the app to **Live** mode, set the production values (step 4), and register the production webhook.
- [ ] Meta's pages say the number of new business customers you may onboard in a rolling 7 days is limited until verification, review and access verification are complete. **Read the current limits before launching a campaign.**
- [ ] Each customer adds a **payment method to their own WhatsApp Business account** and pays Meta directly. This matches LeadPilot's rule that tenants pay Meta directly; the onboarding copy must say so (see `docs/launch-checklist.md`).
- [ ] Update the legal pages with `legal-wording.md` (reviewed by your lawyer) **before** go-live.

## Who owns what after launch
- **Meta app admin access:** at least two people. Store the app secret in the secret manager; rotate it if anyone with access leaves (rotating means updating `META_APP_SECRET` everywhere at once: every Facebook-connected number is affected until you do).
- **Webhook health:** the `whatsapp_unprocessed` alert and `docs/runbooks/webhooks.md` (platform endpoint section).
- **Data-deletion requests from Meta:** `docs/runbooks/data-subject-requests.md` (Meta section).
- **API versions:** Meta retires Graph API and Embedded Signup versions on a schedule: put a quarterly reminder in your calendar to check `WHATSAPP_GRAPH_VERSION` and the pop-up version.

## What can go wrong (and what this repo already does about it)
| Risk | Mitigation |
|---|---|
| Review rejected because the recording does not show a permission being used | `review-video-scripts.md` maps every permission to a scene; record against the real staging flow |
| A customer removes LeadPilot in Facebook | Daily health check and Meta's account notices flag the channel "Reconnect needed" and tell the owner (ADR 0012, milestone 3) |
| App secret leaks | Platform secret only in the secret manager; logs redact `*secret*`, `*token*` and Meta `EAA…` tokens; rotate and re-test |
| Two customers claim the same number | Database-level unique index; the second gets a clear 409 |

## Sources (Meta, read 2026-11-18)
- Become a Tech Provider: https://developers.facebook.com/documentation/business-messaging/whatsapp/solution-providers/get-started-for-tech-providers
- Embedded Signup overview: https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/overview
- WhatsApp app review: https://developers.facebook.com/documentation/business-messaging/whatsapp/solution-providers/app-review
- Embedded Signup implementation: https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/implementation/
