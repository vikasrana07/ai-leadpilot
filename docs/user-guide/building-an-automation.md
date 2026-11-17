# Building an automation

An automation does something for you when something happens: it greets a new lead, reminds a customer, alerts the owner of a hot lead, or follows up when nobody replies. You can start from a template or build your own.

You need the **Automations** feature on your plan and permission to manage automations (owners and managers).

## The four parts

1. **Trigger**: what starts it. For example "a lead is created", "an appointment is coming up (24 hours before)", "a lead goes quiet (7 days)", "a customer messages".
2. **Conditions (branches)**: optional questions that send the automation down one path or another. "If the lead is hot, or came by referral... otherwise...".
3. **Actions**: what it does. Send a WhatsApp template, send a message, assign a lead, create a task, notify someone, change the stage, add a tag.
4. **Waits**: pause, then carry on. "Wait one day. If the customer replied, do this. If not, do that."

## Start from a template

Open **Automations → Templates**, pick one and choose **Install** (or **Customize** to open it in the editor). Templates are always installed **switched off**. Check three things before you turn one on:

- **WhatsApp templates.** Messages that start a conversation must use a template that Meta has approved. The card lists the template names it needs. If they are not registered under Integrations → WhatsApp templates, those steps are skipped and the run history says so.
- **Test it** on a real lead (see "Test before you turn it on").
- **Who it will message.** Automations only message people who have opted in to WhatsApp, and they stop for anyone who sends STOP.

Templates are offered according to your industry. Real estate, coaching, clinics and home services each get a few that fit; everyone gets the general ones.

## Build your own

Open **Automations → New automation**. You can work in two views of the same automation: the **Outline** (a list you edit with the keyboard or a screen reader) and the **Canvas** (boxes and arrows). On a phone the canvas is view-only; edit in the Outline.

1. Choose the trigger.
2. Add steps one after another. Choose **Add branch** to split into "If" and "Otherwise", **Add wait** to pause.
3. Fix anything marked with a red badge. The plain-English summary at the top always shows what the automation will do.
4. **Save**, then **Test**, then turn it on.

### Branching
A branch asks one or more questions about the lead (stage, temperature, score, source, owner, budget, location). Choose **all** (every question must be yes) or **any** (one yes is enough). The **If** side runs when the answer is yes; the **Otherwise** side runs when it is no. If you leave a side empty, the automation simply ends there.

### Waits
A wait pauses the automation without using any resources, from 1 minute up to 30 days. It has two ways out:

- **If they reply**: the moment the customer messages, the automation continues down the "replied" path.
- **If they do not reply**: when the time is up, it continues down the "no reply" path.

If you only connect the "no reply" path, a reply does not change anything and the automation waits until the end. **If a customer opts out (STOP), every waiting run for them ends**, whatever you built. Turning an automation off also ends its waiting runs.

When a wait finishes, the automation checks again that it is still switched on, your plan still includes automations, and the customer has not opted out.

## Test before you turn it on
Use **Test** and pick a real lead. LeadPilot shows the path it would take: which branch answered yes or no (with each question and its answer), what each action would do, and any wait ("would wait 1 day"). **Nothing is sent or changed.** You can test unsaved edits too.

## Saving, versions and running automations
- Every time you change what an automation does, a new **version** is saved. Renaming does not create one.
- Changes apply to **new** events straight away. Runs that already started, including runs paused on a wait, finish with the version they started with.
- If a teammate saved a newer version while you were editing, you are asked to reload before saving, so nobody overwrites anyone else's work.
- Run history shows every run with each step and branch taken. A failed run can be retried; steps that already worked are not repeated.

## Limits
| | Limit |
|---|---|
| Steps in one automation | 25 |
| Actions | 12 |
| Longest path | 12 steps |
| Waits on one path | 3 |
| One wait | 30 days |
| Conditions in one branch | 8 |
| Turned-on automations | set by your plan |

## Common mistakes
- **Nothing happened.** Check that it is switched on, the trigger matches, and look in Run history: a skipped run explains why (conditions not met, cooldown, no consent, template not registered).
- **"Cooldown".** After a lead goes through an automation, it will not run again for that lead until the cooldown passes (and not at all while one run is paused on a wait).
- **A message was skipped.** The customer has not opted in, wrote more than 24 hours ago (for free-text messages), or the WhatsApp template is not registered.
- **A loop.** An automation that changes something that triggers itself is stopped automatically; an automation triggered by another automation more than 3 levels deep is stopped too.
- **Unconnected steps.** Every step must connect back to the trigger. Steps cannot loop back; the flow only goes forward.
- **A wait with only a "replied" path.** Add the "no reply" path too, or nothing happens when time runs out.
- **Names in text.** Use placeholders like `{{lead.firstName}}`, `{{business.name}}`, `{{appointment.date}}`, `{{appointment.time}}`, `{{appointment.location}}`, `{{agent.name}}`. Unknown placeholders become empty text.
- **Health details.** For clinics: keep messages to times, places and friendly check-ins. Never ask for or include symptoms or treatment details in an automation.
