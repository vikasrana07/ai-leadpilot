# ADR 0011: Industry packs v2 (coaching, clinics, home services; pack-driven forms and wording)

Status: accepted (2026-11-17). Extends ADR-0009 (industry packs, in `0001-initial-decisions.md`).

## Context
Until now only real estate had a pack. Every other industry ("Coaching & education", "Healthcare clinic", "Home services", "Something else") fell back to a generic pack, and the app still showed real-estate things to everyone: the Properties menu, "Budget / Property type / Buying timeline" on the lead form, "Property portal" as a lead source, "site visit" wording for appointments, and an AI prompt that only knew "properties".

Two defects made this worse:
- `tenants.industry_pack_id` was never set from the chosen industry (it kept its default `real_estate`), so every workspace looked like a real-estate one. Fixed in commit `a8ca72a` plus migration `20261117090000_industry_pack_id_fix`.
- Registration seeds the signup default (real estate) before the owner picks an industry, so picking another industry in onboarding changed only a text label.

## Decision
1. **Four dedicated packs** in `packages/shared-types/src/industry-packs.ts`: `real_estate` (unchanged), `coaching`, `healthcare`, `home_services`, plus `general` for "Something else". `packForIndustry()` accepts an industry id or a pack id.
2. **Two kinds of pack data.**
   - *Seeded* (stages, lost reasons, sources, custom fields) is still COPIED into tenant-editable tables, so tenant edits survive pack updates (ADR-0009 unchanged).
   - *Derived at read time* (`leadFields`, `terminology`, `modules`, `ai`) is looked up from the workspace's `industryPackId` and never copied. It is presentation and guidance only, so improving a label needs no migration. The web app gets the pack id from the existing auth context (`workspaces[].industryPackId`) and reads the config from the shared package; no new endpoint.
3. **`leadFields` keeps the leads table unchanged.** The columns stay `budgetMin/Max`, `propertyType`, `buyingTimeline`, `location`, `requirements`. A pack decides visibility and wording; `propertyType` doubles as the generic "what are they interested in" field (Course or exam / Service interested in / Service needed), which keeps AI qualification, scoring and CSV import working without a schema change. Industry-specific extras are ordinary custom fields.
4. **Switching industry.** In onboarding, choosing another industry while the workspace has no leads replaces stages, lost reasons, custom fields and pack-seeded lead sources (`switchIndustryPack`). Once leads exist the pack is kept and only the label changes (nothing is orphaned). This needed `DELETE` on `lead_sources` for the app role (migration `20261117100000_lead_sources_delete_grant`; row-level security still limits it to the workspace).
5. **Industry-specific menu items** (Properties) stay hidden until the owner has completed the onboarding industry step (`industryChosen`), then follow `pack.modules`.
6. **Scoring defaults follow the pack** (`defaultScoringRulesFor`): packs without a budget field turn the budget criterion off and move its 15 points to location (+5) and requirements (+10) so a lead can still score 100; criterion labels use the pack's words ("Starting within 30 days", "Demo class requested"). Real estate keeps the original rules. Workspaces that saved their own rules are untouched.
7. **AI prompt** uses the pack: what the business offers, the list of details to capture, appointment noun, and an "Industry guidance" section placed BELOW the non-negotiable rules (it can never weaken them). `search_properties` is removed from the model's tools for workspaces whose pack has no Properties module. Prompt version bumped to `v1.1`.
8. **Automation templates** can be tagged `industries: [...]`. `GET /automations/templates` returns untagged templates plus those for the workspace's pack, and installing a template of another industry is refused (404). The eight base templates are unchanged and untagged; six industry ones were added (two each).
9. **Appointment wording.** The web app uses the pack's noun on the appointments page and dialogs; the default title of a new appointment is `<Noun>: <lead name>`. Fixed menu/report/tool text that said "site visit" was made neutral ("Appointments"). Automation trigger labels in `apps/web/lib/ops.ts` still say "visit" (that file was being changed by the automation-builder work; follow-up).

## The packs (first version)
| | Stages (first = where new leads start) | Appointment noun | Lead noun |
|---|---|---|---|
| Coaching & education | Enquiry, Contacted, Demo class booked, Demo class attended, **Enrolled** (won), **Dropped** (lost) | Demo class | Enquiry |
| Healthcare clinic | Enquiry, Contacted, Appointment booked, Visited, **Treatment started** (won), **Lost** | Consultation | Enquiry |
| Home services | Enquiry, Contacted, Quote sent, Site inspection, **Booked** (won), **Lost** | Inspection | Customer |
| General ("Something else") | New, Contacted, Qualified, Proposal, Won, Lost | Meeting | Lead |

Lead form: coaching and clinics hide Budget; home services and general keep it. Real estate shows everything as before. Custom fields: coaching (who is enquiring, current level, preferred batch, classroom/online), clinic (first visit, preferred doctor, preferred time, how they heard of us), home services (property type, urgency, area in sq ft, site access notes).

## Healthcare: privacy and safety rules
Medical information is sensitive personal data and the product is not built or reviewed for clinical records.
- The clinic pack is deliberately **non-clinical**: fields are about logistics (service, doctor, time, first visit), never symptoms, conditions, medicines or reports. A test asserts that no field label or option asks for health details.
- The AI prompt for clinics forbids medical advice, symptom questions and recording health details, tells the assistant to hand over clinical questions and to point to emergency services for emergencies, and says never to put health details in `requirements`. The notes label says "no medical details".
- This is guidance to the model, not a guarantee: a customer can still volunteer health information in chat. The existing handover rules, audit log and DPDP erasure apply. A clinic customer should get legal review before relying on WhatsApp for patient communication.

## Consequences and honest limits
- **Content needs review by people who know each trade.** Stage names, lost reasons, custom fields, sources (Justdial, Google Business Profile, Instagram) and AI guidance are a best-effort first version, not validated with real coaching institutes, clinics or service businesses.
- Existing workspaces are unaffected except that their stored pack id was corrected; their stages and fields stay as they were.
- Only English wording; no Hindi pack labels.
- The WhatsApp message templates the new automation templates need (`demo_class_reminder`, `consultation_reminder`, `inspection_reminder`) must be registered with Meta by the tenant; none has been sent to the real provider.
- The offline mock model and the evaluation set (`apps/api/test/eval`) are real-estate flavoured; the new prompts are tested for content, not for model behaviour. Real-model quality for each industry, in English or Hinglish, is unmeasured until the live evaluation runs.
- Reports and dashboard copy still use generic "Leads" wording; the per-pack lead noun (Enquiry / Customer) is stored but not used anywhere yet.
- Scoring notes and criteria labels are generic or pack-worded, but score thresholds (Hot 70+, Warm 40-69) are unchanged and unvalidated for these industries.
