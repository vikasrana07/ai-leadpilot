# App Review recording scripts

**Why recordings.** Meta's Tech Provider and App Review pages say reviewers want video evidence of the capabilities the permissions are for (sending and receiving messages, managing templates, onboarding). **Check Meta's current "submission requirements" page for the exact format, length and language rules before recording.** These scripts show only what LeadPilot really does; every scene maps to a sentence in `app-review-submission.md`. A permission that is requested but never shown on screen is a common cause of rejection.

## Before you record (checklist)
- [ ] The app is in **development mode** with a **test WhatsApp Business Account and test number**, and the real Embedded Signup flow already works on staging (README step 5). **Do not record before the real flow works.** If the pop-up behaves differently from `lib/embedded-signup.ts` assumptions, fix the code first.
- [ ] A **public HTTPS staging address** (not `localhost`), with `EMBEDDED_SIGNUP_MODE=live` and `WHATSAPP_MODE=live`, and the webhook set up in the Meta app.
- [ ] A **demo workspace with fake customers only** (see the demo data note below). No real customer names, numbers, messages or documents anywhere on screen.
- [ ] A **second phone (or WhatsApp Web session) acting as the customer**, with a number that is allowed to message the test business number.
- [ ] At least two **templates** on the test account: one `APPROVED`, one `PENDING` (create them in Meta's WhatsApp Manager; LeadPilot does not create templates).
- [ ] Screen recorder at 1080p or better, microphone or on-screen captions in English, browser zoom 100%, the **address bar visible** throughout, notifications switched off, bookmarks and other tabs hidden.
- [ ] Nothing secret on screen: LeadPilot never displays tokens or the app secret, but also keep the Meta developer console's **App Secret** and `.env` files out of frame.
- [ ] A short title card at the start of each video: app name, company name, the permission(s) shown, and "Test account, fake data".

## Video 1: `whatsapp_business_management` (about 3 to 4 minutes)
| # | Scene | What to show and say | Maps to |
|---|---|---|---|
| 1 | Title card | "LeadPilot, a lead-management app for small businesses. This video shows how a business connects its own WhatsApp Business Account and how we use `whatsapp_business_management`." | intro |
| 2 | Sign in | Sign in to the demo workspace as the business owner. Open **Integrations**. Show WhatsApp "not connected". | §3.1 |
| 3 | Connect | Click **Connect WhatsApp**. The Meta pop-up opens. **Pause on the permission screen** so the permission names are readable: say "the business grants LeadPilot access to manage its WhatsApp Business Account and send messages". Choose the test business account and the test number. Finish. | §3.1 (permission consent shown) |
| 4 | Result | Pop-up closes; LeadPilot shows **Connected** with the display phone number and verified name. Say: "Our server exchanged the one-time code for a token, checked the number belongs to this WhatsApp Business Account, and subscribed our app to the account so messages reach us." | §3.1, §3.2 |
| 5 | Templates | Click **Sync from WhatsApp**. The templates appear with **Approved** and **Pending** badges. Say: "We read the templates and their approval status. LeadPilot does not create or edit templates." | §3.3 |
| 6 | Only approved can be sent | In the Inbox, try to send the **Pending** template: the message "WhatsApp has not approved this template" appears. Send the **Approved** one successfully. Say: "We only send templates Meta approved." | §3.3, §4.3 |
| 7 | Disconnect | Back in Integrations click **Disable**. Say: "This stops delivery for the account: our app is unsubscribed." Show **Disabled**, then reconnect with **Reconnect with Facebook** and show **Connected** again. | §3.2 |
| 8 | (Optional) Account notice | If you can do it safely on the test account: remove LeadPilot from the business's integrations in Meta, wait for the status to change to **Reconnect needed**, show the owner notification. Skip this scene if it cannot be shown reliably. | §3.4 |
| 9 | Close | "This is everything we do with `whatsapp_business_management`: onboard through Embedded Signup, read the account's phone numbers and templates, and subscribe or unsubscribe our app." | summary |

## Video 2: `whatsapp_business_messaging` (about 4 to 5 minutes)
| # | Scene | What to show and say | Maps to |
|---|---|---|---|
| 1 | Title card | App, company, "Shows `whatsapp_business_messaging`", "Test account, fake data". | intro |
| 2 | Customer writes | On the **customer phone**, send "Hi, I am interested in a demo" to the business test number. Show the phone screen **and** LeadPilot's Inbox, where the conversation appears within seconds. Say: "Received through our webhook, verified with Meta's signature." | §4.1 |
| 3 | Lead created | Open the conversation: show the **lead** created from the customer's number and name. | §4.1, §5 |
| 4 | Reply within 24 hours | Type a text reply in the Inbox and send. Show it arriving on the customer phone, and the **delivered/read** status ticks updating in LeadPilot. Say: "Free text is allowed because the customer wrote within the last 24 hours." | §4.1, §4.2 |
| 5 | Media | From the customer phone send an **image**. Show it displayed in the Inbox. | §4.1 |
| 6 | Window closed | Use a conversation older than 24 hours (prepare one in the demo data, or show the "window closed" indicator): the text box is disabled with the message to send an approved template. Say: "After 24 hours WhatsApp allows only approved templates." | §4.2 |
| 7 | Template with opt-in | Send the **approved template** to a customer who has an opt-in on record. Show it arriving on the phone. Show **"WhatsApp consent"** in the conversation's details panel. | §4.3 |
| 8 | No consent, no send | Try to send a template to a customer with **no opt-in**: LeadPilot refuses with "no record of this customer opting in". | §4.3 |
| 9 | Opt-out | From the customer phone send **STOP**. Show LeadPilot recording the opt-out, then try to send: refused. | §4.3 |
| 10 | Connection check | On the Integrations card click **Test connection**: "Connection works". Say: "We read the number's display name and verified name from the account, and check the connection daily." (LeadPilot does not display the quality rating: do not mention it.) | §4.4 |
| 11 | AI assistant (only if you will use it in production) | Show the AI assistant answering one question from the business's own information and the **handover to a person** button. Say it is business-specific and optional. Skip this scene if the AI assistant will not be enabled for WhatsApp customers at launch. | §5 |
| 12 | Close | "This is everything we do with `whatsapp_business_messaging`: receive messages and statuses, send text within the window, send approved templates to opted-in customers, and respect opt-outs." | summary |

## Demo data (fake)
Use invented names and numbers that belong to **your own test phones**. Example workspace: "Sunrise Realty (demo)", two leads, one older conversation (older than 24 hours) for scene 6. Create it with a throw-away account on staging; delete the workspace after the review (Settings, Data, Delete workspace).

## Common reasons for rejection (and how these scripts avoid them)
- **The permission is never shown being used:** each scene above says which permission it demonstrates.
- **The recording is of a mock or localhost:** use the real staging address and the real Meta pop-up; keep the address bar visible.
- **The consent screen is skipped:** pause on the permission screen in Video 1, scene 3.
- **Screen shows real people's data:** fake data only; check every frame before uploading.
- **The text claims more than the video shows:** remove any claim from `app-review-submission.md` that no scene demonstrates.
- **The test account cannot be used by reviewers:** give Meta test access instructions through the form (never in files or chat).

## After recording
- [ ] Watch each video once at full screen for secrets and real data.
- [ ] Keep the originals somewhere private (not in this repo): they may show your staging address.
- [ ] Attach each video to the matching permission in the App Review form.
- [ ] Note the submission date and Meta's request id in `PROGRESS.md` so the review history is traceable.
