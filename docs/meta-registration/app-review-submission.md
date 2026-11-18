# App Review submission texts

**How to use.** Paste and adapt these into Meta's App Review form (permission request, data use, why Advanced access). Replace every `{{PLACEHOLDER}}`. **Every statement below describes what LeadPilot actually does today** (checked against the code on 2026-11-18). Do not add claims the product does not support: reviewers compare the text with the recording, and a mismatch is a common reason for rejection. Meta's form fields and wording change: keep the meaning, adapt the format.

## 1. The app in one paragraph
{{COMPANY_NAME}} operates **LeadPilot**, software for small businesses in India (real estate, coaching and education, clinics and home services). A business connects its own WhatsApp Business number to LeadPilot. Customers write to that number; LeadPilot shows the conversation to the business's team in a shared inbox, creates or updates a lead record for the customer, and lets the team (and, if the business turns it on, an AI assistant that answers only from the business's own information, with handover to a person) reply, book appointments and send follow-ups. Each business uses its own WhatsApp account and **pays Meta directly** for WhatsApp conversations. {{COMPANY_NAME}} does not resell WhatsApp messaging.

## 2. Why Advanced access (both permissions)
LeadPilot is used by **businesses other than {{COMPANY_NAME}}**. Each business must be able to connect its own WhatsApp Business Account through Embedded Signup and grant LeadPilot the permissions to read that account and send and receive messages on its behalf. Standard access works only for accounts that {{COMPANY_NAME}} itself owns, so Advanced access is required for the permissions to appear in the signup flow for our customers.

## 3. `whatsapp_business_management`
**What LeadPilot does with it** (each item is shown in the recording; see `review-video-scripts.md`):
1. **Onboarding with Embedded Signup.** After the business finishes the pop-up, LeadPilot exchanges the one-time code for a business token on its server, then **reads the business's WhatsApp Business Account's phone numbers** to confirm the chosen number belongs to that account.
2. **Subscribes LeadPilot's app to the business's WhatsApp Business Account** so message and account notifications reach LeadPilot's webhook, and **unsubscribes** when the business disconnects the number.
3. **Reads the account's message templates and their approval status** (read only) so the business can see which templates are approved and LeadPilot only sends templates that Meta has approved.
4. **Receives account notices** (for example, the business removed LeadPilot) and marks the connection as "Reconnect needed", telling the business owner.

**What LeadPilot does not do with it:** it does not create or edit templates, change the business profile, change phone number settings, or manage other accounts. *(Remove any item from the list above that the recording does not show.)*

## 4. `whatsapp_business_messaging`
**What LeadPilot does with it:**
1. **Receives** customers' messages and delivery statuses on the webhook and shows them in the business's inbox (text, and images, documents, audio and video the customer sends, so the team can see them).
2. **Sends text messages** to a customer **only within 24 hours of the customer's last message** (WhatsApp's customer-service window).
3. **Sends approved template messages** (appointment reminders, follow-ups) **only to customers with a recorded opt-in** (a customer who wrote to the business, or a consent the business recorded), and never to a customer who has opted out. If a customer sends a stop word, LeadPilot records the opt-out and stops sending.
4. **Reads the number's display phone number and verified name** to show on the connection card, and **tests the connection daily** so the business is told if it breaks. *(LeadPilot also receives the number's quality rating when it tests the connection, but does not show it today: do not claim that it does.)*

**Controls the product enforces on every send** (human, automation or AI): an active, connected channel; the 24-hour window for free text; an approved, registered template outside it; opt-in recorded, opt-out respected; one retry-safe send per message (idempotency keys, so a retry never sends twice).

## 5. What customer data is accessed, why, and how it is protected
| Data | Why LeadPilot needs it | Handling |
|---|---|---|
| Customer's WhatsApp phone number and profile name | To identify the conversation and create the business's lead record | Stored in the business's workspace only |
| Message text and media | To show the conversation to the business's team and, if enabled by the business, to let the AI assistant draft a reply | Stored in the business's workspace; AI processing is described below |
| Delivery and read statuses | To show whether a message was delivered | Stored with the message |
| Business token, phone number ID, WhatsApp Business Account ID | To act for the business on its connected account | Token **encrypted at rest** with envelope encryption (per-record key, wrapped by a key kept in a key-management service in production); never shown after saving; never written to logs |
| Template names, language, approval status | To send only approved templates | Stored in the business's workspace |

- **Tenant isolation:** every business's data is separated in the application **and** by database row-level security; the app's database role cannot read across businesses.
- **Webhook authenticity:** every incoming webhook is verified with Meta's signature (`X-Hub-Signature-256`) before it is read.
- **Logs:** application logs contain ids only; phone numbers, emails, tokens and secrets are redacted.
- **AI assistant (optional, per business):** if the business turns it on, message text is sent to an AI model provider ({{AI_PROVIDER_NAME}}, {{AI_PROVIDER_REGION}}) to draft replies from the business's own knowledge base, with strict rules (no invented prices or links, handover to a person for anything it cannot answer). The assistant is **business-specific, not a general-purpose chatbot**. {{COMPANY_NAME}} does not use WhatsApp message content to train AI models. *(Confirm this last sentence with your AI provider's terms before submitting. Also read Meta's current WhatsApp Business policy on AI and automated assistants and make sure this use fits it.)*
- **No sale of data.** Customer data is used only to provide the service to the business it belongs to.
- **Retention and deletion:** the business can disconnect a number at any time (LeadPilot unsubscribes its app), erase a single customer's data, export all its data, or delete its whole workspace (14-day cooling-off, then permanent deletion). Meta's **deauthorize** and **data-deletion** callbacks are implemented; LeadPilot stores no Facebook profile data and nothing keyed to a Facebook user. Details: {{PRIVACY_POLICY_URL}}.

## 6. Policy compliance statement (adapt)
{{COMPANY_NAME}} requires every business using LeadPilot to accept {{TERMS_URL}}, which obliges it to comply with Meta's WhatsApp Business Terms and Messaging Policy, to message only customers who have contacted it or opted in, and to honour opt-outs. The product enforces the 24-hour window, template approval and opt-out technically (section 4). {{GRIEVANCE_CONTACT_EMAIL}} handles complaints and data requests.

## 7. Test access for reviewers
- Demo workspace URL: {{STAGING_URL}}. Create a **dedicated demo workspace with fake customers only**.
- Give reviewers the credentials Meta's form asks for **through the form only**. Never paste real passwords into this repo, an email thread or a document, and never use an account that holds real customer data.
- Use a Meta **test WhatsApp number** for the demo, and say so in the submission.

## 8. Likely reviewer questions (prepare answers)
| Question | Honest answer |
|---|---|
| Do you send marketing messages? | Only approved templates to opted-in customers, sent by the business's own automations or team; the business decides the content. LeadPilot sends nothing on its own behalf. |
| Who is the customer's data controller? | The business (our customer). {{COMPANY_NAME}} processes it for them under a data processing agreement ({{DPA_URL}}). |
| Do you store tokens safely? | Encrypted at rest, never logged, never shown after saving. |
| What happens if a business leaves? | It disconnects the number (we unsubscribe) or deletes its workspace; Meta's deauthorize and data-deletion callbacks are answered. |
| Do you use the data for anything else? | No. No advertising, no sale, no model training on message content. *(confirm)* |

## 9. Do not claim
Features that are not built: editing business profiles, creating templates from LeadPilot, WhatsApp Calling, payments in chat, catalogues or commerce messaging, broadcasting to lists of people who have not contacted the business.
