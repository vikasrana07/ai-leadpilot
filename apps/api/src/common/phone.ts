/**
 * Normalises a phone number to digits-with-country-code for duplicate detection, plus a display form.
 * India-first: 10 digits => +91, a leading 0 is dropped, "91XXXXXXXXXX" is accepted. Other numbers must carry a
 * country code (8 to 15 digits). Returns null when it cannot be a phone number.
 */
export function normalizePhone(raw: string | null | undefined): { norm: string; display: string } | null {
  if (!raw) return null;
  const hadPlus = raw.trim().startsWith('+');
  let d = raw.replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (!hadPlus) {
    if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
    if (d.length === 10) d = `91${d}`;
  }
  if (d.length < 8 || d.length > 15) return null;
  return { norm: d, display: `+${d}` };
}

export function normalizeEmail(raw: string | null | undefined): string | null {
  const e = raw?.trim().toLowerCase();
  return e ? e : null;
}
