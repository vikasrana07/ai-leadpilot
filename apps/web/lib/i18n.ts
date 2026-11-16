/**
 * i18n scaffold (phase 2). All new user-facing strings that are shared across screens live in the catalogue below and are
 * read through `t()`, so a second locale can be added by providing another catalogue. Not every screen has been moved onto
 * it yet: see PROGRESS.md. Number formatting for ₹ lakh/crore is in lib/format.ts.
 */
const en = {
  'leads.title': 'Leads', 'leads.add': 'Add lead', 'leads.import': 'Import', 'leads.export': 'Export',
  'leads.empty.title': 'No leads yet', 'leads.empty.body': 'Add your first lead, import a CSV, or connect a lead source.',
  'pipeline.title': 'Sales pipeline', 'properties.title': 'Properties', 'dashboard.title': 'Dashboard',
  'common.save': 'Save', 'common.cancel': 'Cancel', 'common.delete': 'Delete', 'common.search': 'Search',
} as const;

export type MessageKey = keyof typeof en;
const catalogues: Record<string, Record<string, string>> = { en };

export function t(key: MessageKey, locale = 'en'): string {
  return catalogues[locale]?.[key] ?? en[key];
}
