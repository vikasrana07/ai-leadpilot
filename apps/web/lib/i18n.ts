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

export interface CurrencyOption {
  code: string;
  name: string;
  symbol: string;
  label: string;
}

export const CURRENCIES: CurrencyOption[] = [
  { code: 'INR', name: 'Indian Rupee', symbol: '₹', label: 'INR (₹) · Indian Rupee' },
  { code: 'USD', name: 'US Dollar', symbol: '$', label: 'USD ($) · US Dollar' },
  { code: 'EUR', name: 'Euro', symbol: '€', label: 'EUR (€) · Euro' },
  { code: 'GBP', name: 'British Pound', symbol: '£', label: 'GBP (£) · British Pound' },
  { code: 'AED', name: 'UAE Dirham', symbol: 'AED', label: 'AED (د.إ) · UAE Dirham' },
  { code: 'SAR', name: 'Saudi Riyal', symbol: 'SAR', label: 'SAR (﷼) · Saudi Riyal' },
  { code: 'SGD', name: 'Singapore Dollar', symbol: 'S$', label: 'SGD ($) · Singapore Dollar' },
  { code: 'AUD', name: 'Australian Dollar', symbol: 'A$', label: 'AUD ($) · Australian Dollar' },
  { code: 'CAD', name: 'Canadian Dollar', symbol: 'C$', label: 'CAD ($) · Canadian Dollar' },
  { code: 'JPY', name: 'Japanese Yen', symbol: '¥', label: 'JPY (¥) · Japanese Yen' },
  { code: 'QAR', name: 'Qatari Riyal', symbol: 'QAR', label: 'QAR (﷼) · Qatari Riyal' },
  { code: 'MYR', name: 'Malaysian Ringgit', symbol: 'RM', label: 'MYR (RM) · Malaysian Ringgit' },
  { code: 'THB', name: 'Thai Baht', symbol: '฿', label: 'THB (฿) · Thai Baht' },
  { code: 'IDR', name: 'Indonesian Rupiah', symbol: 'Rp', label: 'IDR (Rp) · Indonesian Rupiah' },
  { code: 'PHP', name: 'Philippine Peso', symbol: '₱', label: 'PHP (₱) · Philippine Peso' },
  { code: 'ZAR', name: 'South African Rand', symbol: 'R', label: 'ZAR (R) · South African Rand' },
  { code: 'NZD', name: 'New Zealand Dollar', symbol: 'NZ$', label: 'NZD ($) · New Zealand Dollar' },
  { code: 'CHF', name: 'Swiss Franc', symbol: 'CHF', label: 'CHF · Swiss Franc' },
  { code: 'BRL', name: 'Brazilian Real', symbol: 'R$', label: 'BRL (R$) · Brazilian Real' },
  { code: 'MXN', name: 'Mexican Peso', symbol: 'Mex$', label: 'MXN ($) · Mexican Peso' },
];

export interface TimezoneOption {
  value: string;
  label: string;
}

export const COMMON_TIMEZONES: TimezoneOption[] = [
  { value: 'Asia/Kolkata', label: 'Asia/Kolkata (IST, GMT+5:30)' },
  { value: 'Asia/Dubai', label: 'Asia/Dubai (GST, GMT+4:00)' },
  { value: 'Asia/Riyadh', label: 'Asia/Riyadh (AST, GMT+3:00)' },
  { value: 'Asia/Singapore', label: 'Asia/Singapore (SGT, GMT+8:00)' },
  { value: 'Europe/London', label: 'Europe/London (GMT/BST, GMT+0:00)' },
  { value: 'Europe/Paris', label: 'Europe/Paris (CET/CEST, GMT+1:00)' },
  { value: 'Europe/Berlin', label: 'Europe/Berlin (CET/CEST, GMT+1:00)' },
  { value: 'America/New_York', label: 'America/New_York (EST/EDT, GMT-5:00)' },
  { value: 'America/Chicago', label: 'America/Chicago (CST/CDT, GMT-6:00)' },
  { value: 'America/Denver', label: 'America/Denver (MST/MDT, GMT-7:00)' },
  { value: 'America/Los_Angeles', label: 'America/Los_Angeles (PST/PDT, GMT-8:00)' },
  { value: 'America/Toronto', label: 'America/Toronto (EST/EDT, GMT-5:00)' },
  { value: 'Australia/Sydney', label: 'Australia/Sydney (AEST/AEDT, GMT+10:00)' },
  { value: 'Asia/Tokyo', label: 'Asia/Tokyo (JST, GMT+9:00)' },
  { value: 'Asia/Hong_Kong', label: 'Asia/Hong_Kong (HKT, GMT+8:00)' },
  { value: 'Asia/Bangkok', label: 'Asia/Bangkok (ICT, GMT+7:00)' },
  { value: 'Asia/Jakarta', label: 'Asia/Jakarta (WIB, GMT+7:00)' },
  { value: 'Africa/Johannesburg', label: 'Africa/Johannesburg (SAST, GMT+2:00)' },
  { value: 'UTC', label: 'UTC (Coordinated Universal Time)' },
];

export function getAllTimezones(): TimezoneOption[] {
  try {
    const list = Intl.supportedValuesOf('timeZone');
    const commonSet = new Set(COMMON_TIMEZONES.map((t) => t.value));
    const rest = list.filter((tz) => !commonSet.has(tz)).map((tz) => ({ value: tz, label: tz.replace(/_/g, ' ') }));
    return [...COMMON_TIMEZONES, ...rest];
  } catch {
    return COMMON_TIMEZONES;
  }
}
