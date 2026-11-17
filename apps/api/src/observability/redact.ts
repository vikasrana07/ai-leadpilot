/**
 * Removes personal data and secrets from text before it reaches a log line (DPDP: logs are retained and shipped to a collector).
 * Conservative on purpose: it prefers hiding a harmless number to leaking a phone number. UUIDs, request ids, ISO dates and
 * route patterns are left readable (the number rules never match inside a token joined by `-`, `_`, `.` or letters).
 */
const RULES: [RegExp, string | ((m: string, ...g: string[]) => string)][] = [
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, '[jwt]'],
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, '$1 [redacted]'],
  [/\b(?:lp_[A-Za-z0-9_-]{8,}|sk-[A-Za-z0-9_-]{16,}|rzp_(?:live|test)_[A-Za-z0-9]{6,}|whsec_[A-Za-z0-9]{8,}|AKIA[A-Z0-9]{12,}|xox[abprs]-[A-Za-z0-9-]{10,})/g, '[secret]'],
  [/\b(password|passwd|pwd|secret|token|api[_-]?key|authorization|cookie|signature)(["']?\s*[:=]\s*["']?)([^\s"',}&;]+)/gi, '$1$2[redacted]'],
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g, '[email]'],
  [/\b[A-Z]{5}\d{4}[A-Z]\b/g, '[pan]'],
  [/(?<![\w-])\d{4}[ -]\d{4}[ -]\d{4}(?![\w-])/g, '[id-number]'],
  [/(?<![\w.-])\+\d[\d ()-]{8,15}\d(?![\w-])/g, '[phone]'],
  [/(?<![\w.-])[6-9]\d{4}[ -]\d{5}(?![\w-])/g, '[phone]'],
  [/(?<![\w.-])\d{10,}(?![\w-])/g, '[number]'],
  [/(?<![\w./-])[A-Fa-f0-9]{32,}(?![\w./-])/g, '[hex]'],
  [/(?<![\w./-])(?=[A-Za-z0-9_-]*\d)(?=[A-Za-z0-9_-]*[A-Za-z])[A-Za-z0-9_-]{40,}(?![\w./-])/g, '[token]'],
];

export function redact(text: string): string {
  let out = text;
  for (const [re, to] of RULES) out = out.replace(re, to as string);
  return out;
}

/** Redacts every string inside a value (two levels deep is enough for log fields); non-strings pass through. */
export function redactValue(v: unknown, depth = 0): unknown {
  if (typeof v === 'string') return redact(v);
  if (depth >= 3 || v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map((x) => redactValue(x, depth + 1));
  return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, redactValue(x, depth + 1)]));
}
