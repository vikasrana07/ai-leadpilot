# Draft legal wording for the Tech Provider model

> **DRAFT: not legal advice. A qualified Indian lawyer must review and adapt every word before publication.** Placeholders in {{DOUBLE_BRACES}} must be completed. The statements about what the product does were checked against the code on 2026-11-18 and must be re-checked before publishing. This file proposes insertions for the documents in `docs/legal/`; it does not replace them.

## Why the documents change
Today `docs/legal/sub-processors.md` says "each tenant connects its own WhatsApp Business account" through their own Meta app. With Embedded Signup, **{{COMPANY_NAME}} owns the Meta app** (it is registered with Meta as a Tech Provider) and customers connect their accounts through it. The privacy policy, the DPA, the terms and the sub-processor list must say so **before** the Facebook-connected flow goes live. Meta also reads the privacy policy during App Review.

## 1. Roles (add to the DPA, section on roles)
> For WhatsApp conversations, the **Customer** (the business) is the **Data Fiduciary** for the personal data of its own customers and contacts; **{{COMPANY_NAME}}** is a **Data Processor** acting on the Customer's instructions. **Meta Platforms** provides the WhatsApp Business Platform to the Customer under the Customer's own agreement with Meta ({{META_TERMS_REFERENCE}}); Meta processes WhatsApp messages under its own terms and privacy policy, and {{COMPANY_NAME}} is not responsible for Meta's processing. {{COMPANY_NAME}} acts as a **Tech Provider**: a technical intermediary that the Customer authorises, through Meta's Embedded Signup, to connect to and operate the Customer's WhatsApp Business Account on its behalf.

*Lawyer: confirm how the DPDP Act 2023 characterises each party for this flow, and what Meta's current terms say about the roles; do not copy Meta's characterisation without checking.*

## 2. What {{COMPANY_NAME}} receives from Meta (add to privacy policy, section 1)
> When a Customer connects WhatsApp with Facebook, we receive from Meta: a business access token for the Customer's WhatsApp Business Account, the WhatsApp Business Account ID and phone number ID, the number's display name, and later the messages the Customer's contacts send to that number, delivery statuses, and the Customer's message template names and approval status. **We do not receive or store your Facebook profile, friends, posts or any data about your Facebook account**, and we do not store your Facebook user ID. The business access token is encrypted at rest and is used only to operate the connected WhatsApp account for the Customer.

## 3. Sub-processors: replace the Meta row in `docs/legal/sub-processors.md`
| Sub-processor | Purpose | Data | Location | Status |
|---|---|---|---|---|
| Meta Platforms / WhatsApp Business Platform ({{META_ENTITY}}) | Delivery of WhatsApp messages between the Customer and its contacts; onboarding through Embedded Signup | Phone numbers, message content, templates, the Customer's WhatsApp Business Account identifiers | {{META_REGION}} (Meta states its own locations: confirm in Meta's current documentation) | **Not yet live** (the live flow has never been run against Meta); {{COMPANY_NAME}} is the app owner / Tech Provider and each Customer accepts Meta's WhatsApp terms during signup |

## 4. Customer obligations (add to the terms of service and the acceptable-use policy)
> You must (a) accept and comply with Meta's WhatsApp Business Terms of Service, WhatsApp Business Messaging Policy and Commerce/Business policies as published by Meta from time to time; (b) message only people who have contacted you or have given you a valid opt-in, and honour opt-outs promptly; (c) pay Meta directly for WhatsApp conversation charges on your own WhatsApp Business Account: {{COMPANY_NAME}} does not charge for, resell or guarantee WhatsApp messaging; (d) not use the service for content or purposes that Meta prohibits. Meta may suspend or restrict your WhatsApp account or {{COMPANY_NAME}}'s app at its discretion: {{COMPANY_NAME}} is not liable for Meta's decisions or for interruptions of Meta's service, but will help you reconnect where it can.

*Product behaviour that supports this (for your lawyer's reference):* free-text replies only within 24 hours of the customer's last message; templates need a recorded opt-in and an approved template; a stop word records an opt-out and sending stops; template approval status is read from Meta; all of it is enforced in the backend, not only the screen.

## 5. Facebook-related data requests (add to privacy policy, section on your rights)
> If you used Facebook to connect a WhatsApp number and want your connection removed, you can disconnect the number in Integrations (we then stop receiving its messages and remove our app's subscription) or delete your workspace in Settings (permanent deletion after a 14-day cooling-off period). You can also remove {{COMPANY_NAME}}'s app in your Facebook/Meta business settings, or send a data-deletion request through Meta: Meta notifies us, we record it, and you can see its status at {{WEB_ORIGIN}}/data-deletion using the confirmation code Meta gives you. We hold no Facebook profile data about you. Contact {{GRIEVANCE_OFFICER_EMAIL}} for anything else.

## 6. AI assistant disclosure (check against what you will launch)
> If a Customer turns on the AI assistant, the text of messages from the Customer's contacts is sent to {{AI_PROVIDER_NAME}} ({{AI_PROVIDER_REGION}}) to draft replies from the Customer's own business information. The assistant is limited to the Customer's business and hands conversations over to a person when it cannot answer. {{COMPANY_NAME}} does not use message content to train AI models {{CONFIRM_WITH_PROVIDER_TERMS}}.

## 7. Clinics (healthcare customers): extra care
LeadPilot's healthcare setup avoids clinical fields and instructs the AI assistant not to give medical advice or ask for health details, **but a patient can still type health information into a chat**. Before allowing clinics to use WhatsApp for patient communication, your lawyer should decide: whether health information in chats needs specific consent and notice, how long it is retained, whether the Customer's own obligations (for example under the DPDP Act and any health-sector rules) need extra contract terms, and whether Meta's own policies restrict the use. Consider a clinic-specific addendum.

## 8. Updates needed in existing files (apply after lawyer review)
- [ ] `docs/legal/sub-processors.md`: replace the Meta row (section 3 above).
- [ ] `docs/legal/privacy-policy.md`: add sections 2 and 5 above; mention Meta and the Tech Provider model in "Who we share with".
- [ ] `docs/legal/data-processing-agreement.md`: add the roles paragraph (section 1) and an instruction clause for connecting and operating the Customer's WhatsApp account.
- [ ] `docs/legal/terms-of-service.md` and `acceptable-use-policy.md`: add section 4.
- [ ] Publish the final versions at the **public URLs entered in the Meta app settings**, and make sure the URLs in the Meta app point to the published versions, not to repo files.
- [ ] Re-read the `{{META_REGION}}`, `{{CROSS_BORDER_STATEMENT}}` and `{{LOG_RETENTION}}` placeholders: Meta processes data outside India, which the transfer statement must cover. Make `LogRetentionDays` in `infrastructure/monitoring/cloudwatch-alarms.example.yml` equal the published log-retention statement.
