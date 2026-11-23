/**
 * Industry Packs (ADR-0009, v2 in ADR-0011): versioned config that seeds a tenant's pipeline, lost reasons, sources and custom
 * fields, and describes how the app should talk about the business (form labels, appointment wording, AI guidance).
 * Core code never branches on industry; everything industry-specific lives here.
 *
 * Two kinds of pack data:
 *  - SEEDED (stages, lost reasons, sources, custom fields): COPIED into tenant-editable tables at onboarding, so tenant edits survive
 *    pack updates.
 *  - DERIVED AT READ TIME (leadFields, terminology, modules, ai): looked up from the workspace's `industryPackId`, never copied.
 *    They are presentation and guidance only; the leads table has the same columns for every industry.
 *
 * Content note: stage names, fields and wording are a best-effort first version and should be reviewed by someone who knows each trade.
 */
export interface PackStage { key: string; name: string; kind: 'OPEN' | 'WON' | 'LOST'; qualifies?: boolean; canCloseWon?: boolean }
export interface PackCustomField { key: string; label: string; type: 'text' | 'number' | 'select' | 'date' | 'boolean'; options?: string[] }

/**
 * Which core lead columns the form shows and what they are called. The columns are fixed (`budgetMin/Max`, `propertyType`,
 * `buyingTimeline`, `location`, `requirements`); a pack only decides visibility and wording. `interest` is stored in `propertyType`.
 */
export interface LeadFieldsConfig {
  budget: { label: string } | null;
  interest: { label: string; placeholder: string } | null;
  /** `soon` names the scoring criterion for "within 30 days" in this industry's words. */
  timeline: { label: string; soon: string } | null;
  location: { label: string; placeholder: string };
  requirements: { label: string };
}

/** How the AI assistant refers to what is still unknown/known about the person (kept identical to the original wording for real estate). */
export interface AiFieldPhrases {
  budget: { ask: string; known: string } | null;
  location: { ask: string; known: string };
  timeline: { ask: string; known: string } | null;
  interest: { ask: string; known: string } | null;
}

export interface PackAiGuidance {
  /** What the business offers, for "You help people who message the business ... about {offering}". */
  offering: string;
  /** Requirement list for rule 6 of the prompt ("save it with update_lead ..."). */
  captureList: string;
  phrases: AiFieldPhrases;
  /** Extra industry guidance appended to the prompt. Never overrides the non-negotiable rules. */
  guidance: string[];
}

export interface AppointmentConfig {
  practitionerLabel: string;
  customerLabel: string;
  services: string[];
  durations: number[];
  locationPlaceholder: string;
  notesPlaceholder: string;
  safetyNotice?: string;
}

export interface IndustryPack {
  id: string;
  version: number;
  label: string;
  stages: PackStage[];
  lostReasons: string[];
  sources: { key: string; name: string }[];
  customFields: PackCustomField[];
  /**
   * `lead` is what the business calls a person in its pipeline ("Lead", "Enquiry", "Customer"); `visit` is the noun used for appointments
   * ("Site visit", "Demo class", "Consultation", "Inspection", "Meeting"). `visitShort` is the shorter everyday word used inside automation
   * and notification sentences where the original real-estate copy says plain "visit" (defaults to the lower-cased `visit`).
   */
  terminology: { lead: string; leadPlural?: string; visit: string; visitShort?: string };
  /** Optional modules shown in the app. Only what an industry actually uses appears in the menu. */
  modules: { properties: boolean };
  leadFields: LeadFieldsConfig;
  appointmentConfig: AppointmentConfig;
  ai: PackAiGuidance;
}

const COMMON_SOURCES = [
  { key: 'manual', name: 'Added manually' }, { key: 'csv_import', name: 'CSV import' }, { key: 'api', name: 'API / form' },
  { key: 'website_widget', name: 'Website chat' }, { key: 'whatsapp', name: 'WhatsApp' }, { key: 'meta_ads', name: 'Meta Ads' },
  { key: 'google_ads', name: 'Google Ads' }, { key: 'referral', name: 'Referral' }, { key: 'walk_in', name: 'Walk-in' },
];
const PORTAL = { key: 'portal', name: 'Property portal' };
const LOCAL_SEARCH = [{ key: 'justdial', name: 'Justdial' }, { key: 'google_business', name: 'Google Business Profile' }];

export const REAL_ESTATE_PACK: IndustryPack = {
  id: 'real_estate',
  version: 1,
  label: 'Real estate',
  stages: [
    { key: 'new', name: 'New', kind: 'OPEN' },
    { key: 'contacted', name: 'Contacted', kind: 'OPEN' },
    { key: 'qualified', name: 'Qualified', kind: 'OPEN', qualifies: true },
    { key: 'site_visit_scheduled', name: 'Site Visit Scheduled', kind: 'OPEN', qualifies: true },
    { key: 'site_visit_completed', name: 'Site Visit Completed', kind: 'OPEN', qualifies: true, canCloseWon: true },
    { key: 'negotiation', name: 'Negotiation', kind: 'OPEN', qualifies: true, canCloseWon: true },
    { key: 'won', name: 'Won', kind: 'WON' },
    { key: 'lost', name: 'Lost', kind: 'LOST' },
  ],
  lostReasons: ['Budget mismatch', 'Bought elsewhere', 'Not interested', 'Not reachable', 'Timeline too long', 'Duplicate or invalid'],
  sources: [...COMMON_SOURCES.slice(0, 7), PORTAL, ...COMMON_SOURCES.slice(7)],
  customFields: [
    { key: 'loan_required', label: 'Home loan needed', type: 'boolean' },
    { key: 'facing', label: 'Preferred facing', type: 'select', options: ['East', 'West', 'North', 'South', 'No preference'] },
    { key: 'possession', label: 'Possession preference', type: 'select', options: ['Ready to move', 'Under construction', 'Either'] },
  ],
  terminology: { lead: 'Lead', visit: 'Site visit', visitShort: 'visit' },
  modules: { properties: true },
  leadFields: {
    budget: { label: 'Budget' },
    interest: { label: 'Property type', placeholder: '3 BHK apartment' },
    timeline: { label: 'Buying timeline', soon: 'Buying within 30 days' },
    location: { label: 'Preferred location', placeholder: 'Baner, Pune' },
    requirements: { label: 'Requirements' },
  },
  appointmentConfig: {
    practitionerLabel: 'Agent',
    customerLabel: 'Lead',
    services: ['Project Site Visit', 'Sample Flat Tour', 'Price Negotiation', 'Agreement Signing', 'Possession Walkthrough'],
    durations: [30, 45, 60, 90, 120],
    locationPlaceholder: 'Project site address or sales gallery',
    notesPlaceholder: 'Unit preference, attendees, or visit notes',
  },
  ai: {
    offering: 'properties',
    captureList: 'budget, area, property type, timeline, wanting to visit',
    phrases: {
      budget: { ask: 'budget', known: 'budget' },
      location: { ask: 'preferred area', known: 'area' },
      timeline: { ask: 'buying timeline', known: 'timeline' },
      interest: { ask: 'property type', known: 'looking for' },
    },
    guidance: [],
  },
};

export const COACHING_PACK: IndustryPack = {
  id: 'coaching',
  version: 1,
  label: 'Coaching & education',
  stages: [
    { key: 'enquiry', name: 'Enquiry', kind: 'OPEN' },
    { key: 'contacted', name: 'Contacted', kind: 'OPEN' },
    { key: 'demo_booked', name: 'Demo class booked', kind: 'OPEN', qualifies: true },
    { key: 'demo_attended', name: 'Demo class attended', kind: 'OPEN', qualifies: true, canCloseWon: true },
    { key: 'enrolled', name: 'Enrolled', kind: 'WON' },
    { key: 'dropped', name: 'Dropped', kind: 'LOST' },
  ],
  lostReasons: ['Fees too high', 'Timing or batch does not suit', 'Joined another institute', 'Not interested now', 'Not reachable', 'Duplicate or invalid'],
  sources: [...COMMON_SOURCES, { key: 'instagram', name: 'Instagram' }, ...LOCAL_SEARCH],
  customFields: [
    { key: 'enquirer', label: 'Who is enquiring', type: 'select', options: ['Student', 'Parent', 'Working professional'] },
    { key: 'current_level', label: 'Current class or qualification', type: 'text' },
    { key: 'preferred_batch', label: 'Preferred batch timing', type: 'select', options: ['Morning', 'Afternoon', 'Evening', 'Weekend', 'Flexible'] },
    { key: 'mode', label: 'Classroom or online', type: 'select', options: ['Classroom', 'Online', 'Either'] },
  ],
  terminology: { lead: 'Enquiry', leadPlural: 'Enquiries', visit: 'Demo class' },
  modules: { properties: false },
  leadFields: {
    budget: null,
    interest: { label: 'Course or exam', placeholder: 'JEE Main, IELTS, Class 10 maths' },
    timeline: { label: 'When do they want to start', soon: 'Starting within 30 days' },
    location: { label: 'City or area', placeholder: 'Kota' },
    requirements: { label: 'Notes' },
  },
  appointmentConfig: {
    practitionerLabel: 'Instructor / Counselor',
    customerLabel: 'Student / Parent',
    services: ['Trial Demo Class', 'Course Counseling', 'Assessment Test', 'Batch Induction'],
    durations: [30, 45, 60, 90],
    locationPlaceholder: 'Classroom / Branch or Online meeting link',
    notesPlaceholder: 'Student goals, current class, or batch timing',
  },
  ai: {
    offering: 'its courses and classes',
    captureList: 'course or exam, who the enquiry is for, current class, preferred batch timing, when they want to start, wanting a demo class',
    phrases: {
      budget: null,
      location: { ask: 'city or area', known: 'city or area' },
      timeline: { ask: 'when they want to start', known: 'start timeline' },
      interest: { ask: 'course or exam', known: 'interested in' },
    },
    guidance: [
      'Fees, batch schedules, results, faculty and discounts: only quote what the tool results or <knowledge> state. Never promise admission, ranks, marks or placement outcomes.',
      'Usually the person writing is a parent: ask who the course is for, their current class or level, and what they want to achieve, one question at a time.',
      'The natural next step is a demo class: offer to arrange one.',
      'When saving with update_lead, put the course or exam in `propertyType`, when they want to start in `buyingTimeline`, the city or area in `location`; there is no budget field, so leave the budget fields null.',
    ],
  },
};

export const HEALTHCARE_PACK: IndustryPack = {
  id: 'healthcare',
  version: 1,
  label: 'Healthcare clinic',
  stages: [
    { key: 'enquiry', name: 'Enquiry', kind: 'OPEN' },
    { key: 'contacted', name: 'Contacted', kind: 'OPEN' },
    { key: 'appointment_booked', name: 'Appointment booked', kind: 'OPEN', qualifies: true },
    { key: 'visited', name: 'Visited', kind: 'OPEN', qualifies: true, canCloseWon: true },
    { key: 'treatment_started', name: 'Treatment started', kind: 'WON' },
    { key: 'lost', name: 'Lost', kind: 'LOST' },
  ],
  lostReasons: ['Cost', 'Too far or inconvenient', 'Went to another clinic', 'Not ready yet', 'Not reachable', 'Duplicate or invalid'],
  sources: [...COMMON_SOURCES, ...LOCAL_SEARCH],
  // Deliberately non-clinical: the product must not collect diagnoses or health details (see docs/decisions/0011-industry-packs-v2.md).
  customFields: [
    { key: 'first_visit', label: 'First visit to this clinic', type: 'boolean' },
    { key: 'preferred_doctor', label: 'Preferred doctor', type: 'text' },
    { key: 'preferred_time', label: 'Preferred time of day', type: 'select', options: ['Morning', 'Afternoon', 'Evening', 'Any'] },
    { key: 'heard_about', label: 'How they heard about us', type: 'select', options: ['Doctor referral', 'Friend or family', 'Online search', 'Social media', 'Other'] },
  ],
  terminology: { lead: 'Enquiry', leadPlural: 'Enquiries', visit: 'Consultation' },
  modules: { properties: false },
  leadFields: {
    budget: null,
    interest: { label: 'Service interested in', placeholder: 'General consultation, dental check-up' },
    timeline: { label: 'When do they want to visit', soon: 'Wants to visit within 30 days' },
    location: { label: 'City or area', placeholder: 'Andheri, Mumbai' },
    requirements: { label: 'Notes (no medical details)' },
  },
  appointmentConfig: {
    practitionerLabel: 'Doctor / Practitioner',
    customerLabel: 'Patient / Enquiry',
    services: ['General Consultation', 'Specialist Follow-up', 'Routine Check-up', 'Dental Examination', 'Diagnostic Review', 'Tele-consultation'],
    durations: [15, 30, 45, 60],
    locationPlaceholder: 'Clinic room / OPD or Online video link',
    notesPlaceholder: 'Logistics, special assistance, or appointment notes',
    safetyNotice: 'Medical privacy: Do not enter clinical diagnoses, medical history, or symptom details in notes.',
  },
  ai: {
    offering: 'its clinic services and appointments',
    captureList: 'which service they are interested in, preferred doctor, preferred time of day, whether it is their first visit, wanting a consultation',
    phrases: {
      budget: null,
      location: { ask: 'city or area', known: 'city or area' },
      timeline: { ask: 'when they want to visit', known: 'visit timeline' },
      interest: { ask: 'service interested in', known: 'interested in' },
    },
    guidance: [
      'MEDICAL SAFETY: You are not a doctor. Never give medical advice, diagnoses, treatment suggestions, medicine or dosage information, or interpret symptoms, reports or prescriptions. Do not ask about symptoms, conditions, medicines or test results, and do not record any health details.',
      'If the person describes symptoms or asks anything clinical, say a member of the clinic team will help and call handover_to_human. For an emergency, tell them to contact local emergency services or go to the nearest hospital right away.',
      'When saving with update_lead, put the service they are interested in in `propertyType`, when they want to visit in `buyingTimeline`, and the city or area in `location`; leave the budget fields null and never put health details in `requirements`.',
      'Stay with logistics: which service they are interested in, preferred doctor and time, first visit or not, clinic timings, location and booking. Quote fees only from the tool results or <knowledge>.',
    ],
  },
};

export const HOME_SERVICES_PACK: IndustryPack = {
  id: 'home_services',
  version: 1,
  label: 'Home services',
  stages: [
    { key: 'enquiry', name: 'Enquiry', kind: 'OPEN' },
    { key: 'contacted', name: 'Contacted', kind: 'OPEN' },
    { key: 'quote_sent', name: 'Quote sent', kind: 'OPEN', qualifies: true, canCloseWon: true },
    { key: 'site_inspection', name: 'Site inspection', kind: 'OPEN', qualifies: true, canCloseWon: true },
    { key: 'booked', name: 'Booked', kind: 'WON' },
    { key: 'lost', name: 'Lost', kind: 'LOST' },
  ],
  lostReasons: ['Price too high', 'Timing does not suit', 'Chose another provider', 'Not going ahead', 'Not reachable', 'Duplicate or invalid'],
  sources: [...COMMON_SOURCES, ...LOCAL_SEARCH, { key: 'instagram', name: 'Instagram' }],
  customFields: [
    { key: 'property_kind', label: 'Property type', type: 'select', options: ['Flat', 'Independent house or villa', 'Office or shop', 'Other'] },
    { key: 'urgency', label: 'How soon is it needed', type: 'select', options: ['Today or tomorrow', 'This week', 'This month', 'Just exploring'] },
    { key: 'area_sqft', label: 'Approximate area (sq ft)', type: 'number' },
    { key: 'site_access', label: 'Site access notes', type: 'text' },
  ],
  terminology: { lead: 'Customer', visit: 'Inspection' },
  modules: { properties: false },
  leadFields: {
    budget: { label: 'Budget' },
    interest: { label: 'Service needed', placeholder: 'Deep cleaning, AC repair, interior painting' },
    timeline: { label: 'When is it needed', soon: 'Needed within 30 days' },
    location: { label: 'Area or locality', placeholder: 'Whitefield, Bengaluru' },
    requirements: { label: 'Job details' },
  },
  appointmentConfig: {
    practitionerLabel: 'Technician / Estimator',
    customerLabel: 'Customer',
    services: ['On-site Inspection', 'Repair Service', 'Periodic Maintenance', 'Project Estimate'],
    durations: [30, 60, 90, 120, 180],
    locationPlaceholder: 'Customer premises / site address',
    notesPlaceholder: 'Job details, site access, or parking notes',
  },
  ai: {
    offering: 'its home services',
    captureList: 'service needed, property type, area or locality, approximate size, how soon it is needed, budget, wanting an inspection',
    phrases: {
      budget: { ask: 'budget', known: 'budget' },
      location: { ask: 'area or locality', known: 'area' },
      timeline: { ask: 'when the work is needed', known: 'needed' },
      interest: { ask: 'service needed', known: 'needs' },
    },
    guidance: [
      'Prices depend on the job: only quote what the tool results or <knowledge> state, otherwise say the team will confirm after an inspection or a quote.',
      'Good qualifying questions are the service needed, the type and size of the property, the area, and how soon it is needed, one at a time.',
      'The natural next step is an inspection or a quote: offer to arrange one.',
      'When saving with update_lead, put the service needed in `propertyType`, when it is needed in `buyingTimeline`, and the area or locality in `location`.',
    ],
  },
};

export const GENERAL_PACK: IndustryPack = {
  id: 'general',
  version: 2,
  label: 'General',
  stages: [
    { key: 'new', name: 'New', kind: 'OPEN' },
    { key: 'contacted', name: 'Contacted', kind: 'OPEN' },
    { key: 'qualified', name: 'Qualified', kind: 'OPEN', qualifies: true },
    { key: 'proposal', name: 'Proposal', kind: 'OPEN', qualifies: true, canCloseWon: true },
    { key: 'won', name: 'Won', kind: 'WON' },
    { key: 'lost', name: 'Lost', kind: 'LOST' },
  ],
  lostReasons: ['Budget mismatch', 'Chose a competitor', 'Not interested', 'Not reachable', 'Duplicate or invalid'],
  sources: COMMON_SOURCES,
  customFields: [],
  terminology: { lead: 'Lead', visit: 'Meeting' },
  modules: { properties: false },
  leadFields: {
    budget: { label: 'Budget' },
    interest: { label: 'Interested in', placeholder: 'Product or service' },
    timeline: { label: 'Timeline', soon: 'Planning within 30 days' },
    location: { label: 'Location', placeholder: 'City or area' },
    requirements: { label: 'Requirements' },
  },
  appointmentConfig: {
    practitionerLabel: 'Representative',
    customerLabel: 'Client / Lead',
    services: ['Discovery Call', 'Product Demo', 'Follow-up Meeting', 'Strategy Review'],
    durations: [15, 30, 45, 60],
    locationPlaceholder: 'Meeting room or Video call link',
    notesPlaceholder: 'Agenda, discussion points, or meeting notes',
  },
  ai: {
    offering: 'its products and services',
    captureList: 'budget, location, what they are interested in, timeline, wanting a meeting',
    phrases: {
      budget: { ask: 'budget', known: 'budget' },
      location: { ask: 'location', known: 'location' },
      timeline: { ask: 'timeline', known: 'timeline' },
      interest: { ask: 'what they are interested in', known: 'interested in' },
    },
    guidance: [],
  },
};

const PACKS: Record<string, IndustryPack> = {
  real_estate: REAL_ESTATE_PACK, coaching: COACHING_PACK, healthcare: HEALTHCARE_PACK, home_services: HOME_SERVICES_PACK, general: GENERAL_PACK,
};

/** Accepts an industry id (`coaching`) or a pack id (`general`). Industries without a dedicated pack ("other") use the general pack. */
export function packForIndustry(industry: string): IndustryPack {
  return PACKS[industry] ?? GENERAL_PACK;
}

/** Every pack, for tests and tooling. */
export const ALL_PACKS: IndustryPack[] = Object.values(PACKS);

/**
 * True once the owner has actually picked an industry in onboarding. Until then the workspace carries the signup default, so
 * industry-specific modules (Properties...) stay hidden rather than assuming real estate. Workspaces with no onboarding record count as chosen.
 */
export function industryChosen(onboardingState: unknown): boolean {
  const s = onboardingState as { completed?: unknown; skipped?: unknown } | null | undefined;
  if (!s || typeof s !== 'object') return true;
  const completed = Array.isArray(s.completed) ? s.completed : [];
  const skipped = Array.isArray(s.skipped) ? s.skipped : [];
  return completed.includes('industry') && !skipped.includes('industry');
}

// ----------------------------------------------------------------------------- wording
/** Plural of a simple English noun: enquiry -> enquiries, class -> classes, lead -> leads. */
export function pluralise(noun: string): string {
  if (/[^aeiou]y$/i.test(noun)) return `${noun.slice(0, -1)}ies`;
  if (/(s|x|z|ch|sh)$/i.test(noun)) return `${noun}es`;
  return `${noun}s`;
}
/** "a lead", "an enquiry". */
export const withArticle = (noun: string): string => `${/^[aeiou]/i.test(noun) ? 'an' : 'a'} ${noun}`;

export interface PackTerms {
  /** "lead" / "enquiry" / "customer" */
  lead: string; Lead: string; leads: string; Leads: string; aLead: string;
  /** The appointment noun in full: "site visit" / "demo class" / "consultation" / "inspection" / "meeting" */
  visit: string; Visit: string; visits: string; Visits: string; aVisit: string;
  /** Short appointment word used inside automation/notification sentences ("visit" for real estate, otherwise the same as `visit`). */
  event: string;
  /** Words for the plain-English automation summary. Real estate and general keep the original generic wording ("lead", "appointment"). */
  summary: { lead: string; appointment: string };
}

/** Every noun form the UI needs, derived from a pack's terminology. Pure, so it can be unit tested and used on the server. */
export function packTerms(pack: IndustryPack): PackTerms {
  const Lead = pack.terminology.lead;
  const lead = Lead.toLowerCase();
  const Leads = pack.terminology.leadPlural ?? pluralise(Lead);
  const Visit = pack.terminology.visit;
  const visit = Visit.toLowerCase();
  const generic = pack.id === 'real_estate' || pack.id === 'general';
  return {
    lead, Lead, leads: Leads.toLowerCase(), Leads, aLead: withArticle(lead),
    visit, Visit, visits: pluralise(visit), Visits: pluralise(Visit), aVisit: withArticle(visit),
    event: (pack.terminology.visitShort ?? visit).toLowerCase(),
    summary: { lead: generic ? 'lead' : lead, appointment: generic ? 'appointment' : visit },
  };
}

export function appointmentConfig(pack: IndustryPack): AppointmentConfig {
  return pack.appointmentConfig;
}
