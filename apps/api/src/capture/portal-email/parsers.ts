export interface ParsedPortalLead {
  portal: '99acres' | 'magicbricks' | 'housing' | 'nobroker' | 'generic';
  name: string;
  phone?: string;
  email?: string;
  location?: string;
  propertyType?: string;
  requirements?: string;
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

function detectPortal(sender: string, subject: string, body: string): ParsedPortalLead['portal'] {
  const hay = `${sender} ${subject} ${body}`.toLowerCase();
  if (hay.includes('99acres')) return '99acres';
  if (hay.includes('magicbricks')) return 'magicbricks';
  if (hay.includes('housing.com')) return 'housing';
  if (hay.includes('nobroker')) return 'nobroker';
  return 'generic';
}

function pickField(text: string, labels: string[]): string | undefined {
  for (const label of labels) {
    const re = new RegExp(`^\\s*${label}\\s*[:\\-]\\s*(.+)$`, 'im');
    const m = text.match(re);
    if (m?.[1]) {
      const val = m[1].trim();
      if (val && val.length <= 160) return val;
    }
  }
  return undefined;
}

function extractPhone(text: string): string | undefined {
  const labeled = pickField(text, ['phone', 'mobile', 'contact(?: number| no)?', 'ph', 'tel']);
  const source = labeled ?? text;
  const m = source.match(/(?:\+?91[\s-]?)?[6-9]\d{4}[\s-]?\d{5}|\+\d{8,15}/);
  return m?.[0]?.replace(/[\s-]/g, '');
}

function extractEmail(text: string, sender: string): string | undefined {
  const labeled = pickField(text, ['email(?: id| address)?', 'e-mail']);
  const source = labeled ?? text;
  const matches = source.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) ?? [];
  const senderLower = sender.toLowerCase();
  return matches.find((e) => e.toLowerCase() !== senderLower && !/no-?reply|support@|alerts@|notifications@/i.test(e));
}

export function parsePortalEmail(input: { sender: string; subject: string; text?: string; html?: string }): ParsedPortalLead | null {
  const body = (input.text?.trim() || (input.html ? stripHtml(input.html) : '')).trim();
  if (!body && !input.subject) return null;

  const portal = detectPortal(input.sender, input.subject, body);
  const phone = extractPhone(body);
  const email = extractEmail(body, input.sender);
  if (!phone && !email) return null;

  const name =
    pickField(body, ['name', 'lead name', 'customer name', 'buyer name', 'enquirer', 'from']) ??
    'Portal Enquiry';
  const location = pickField(body, ['location', 'locality', 'city', 'area', 'project']);
  const propertyType = pickField(body, ['property type', 'configuration', 'bhk', 'type', 'looking for']);
  const budget = pickField(body, ['budget', 'price']);
  const message = pickField(body, ['message', 'comments', 'query', 'remarks']);

  const reqParts = [
    `Portal: ${portal}`,
    budget ? `Budget: ${budget}` : null,
    message ?? null,
  ].filter(Boolean);

  return {
    portal,
    name: name.slice(0, 120),
    ...(phone ? { phone } : {}),
    ...(email ? { email } : {}),
    ...(location ? { location: location.slice(0, 120) } : {}),
    ...(propertyType ? { propertyType: propertyType.slice(0, 80) } : {}),
    requirements: reqParts.join(' · ').slice(0, 1000),
  };
}
