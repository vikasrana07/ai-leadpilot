import { pluralise, withArticle, type PackTerms } from './industry-packs.js';

const cap = (w: string): string => w.charAt(0).toUpperCase() + w.slice(1);

type Words = Pick<PackTerms, 'lead' | 'leads' | 'Lead' | 'Leads'> & Partial<Pick<PackTerms, 'event'>>;

/**
 * Re-words OUR OWN static labels for the workspace's industry: whole words Lead/Leads/lead/leads become the pack's nouns
 * (Enquiry/Enquiries, Customer/Customers...), and, when `event` is given, "visit(s)" becomes the pack's appointment word with the right
 * article ("a visit" -> "an inspection"). Real estate and general ("Lead", "visit") pass through unchanged. Never run it over customer
 * data or text that came from live data; it is only for our own fixed copy: UI strings, the template catalogue, and report titles and
 * column labels (the API words those per workspace, so CSV headers match the screen).
 */
export function applyTerms(text: string, terms: Words): string {
  let out = text;
  if (terms.event && terms.event !== 'visit') {
    out = out
      .replace(/\b(a|an) visit\b/g, withArticle(terms.event))
      .replace(/\b(A|An) visit\b/g, () => { const w = withArticle(terms.event as string); return w.charAt(0).toUpperCase() + w.slice(1); })
      .replace(/\bvisits\b/g, pluralise(terms.event))
      .replace(/\bvisit\b/g, terms.event)
      .replace(/\bVisits\b/g, () => cap(pluralise(terms.event as string)))
      .replace(/\bVisit\b/g, () => cap(terms.event as string));
  }
  return out
    .replace(/\bLeads\b/g, terms.Leads)
    .replace(/\bleads\b/g, terms.leads)
    .replace(/\bLead\b/g, terms.Lead)
    .replace(/\blead\b/g, terms.lead);
}
