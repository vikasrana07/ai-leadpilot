/**
 * Timezone arithmetic using only Intl (no dependency). All appointment math is done on UTC instants; "local" wall-clock
 * values are converted with the workspace timezone so DST transitions are handled by the platform's tz database.
 */
const fmtCache = new Map<string, Intl.DateTimeFormat>();
function fmt(tz: string): Intl.DateTimeFormat {
  let f = fmtCache.get(tz);
  if (!f) { f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }); fmtCache.set(tz, f); }
  return f;
}

export function isValidTimezone(tz: string): boolean {
  try { fmt(tz); return true; } catch { return false; }
}

/** Offset (ms) of `tz` from UTC at the given instant: local = utc + offset. */
export function tzOffsetMs(tz: string, at: Date): number {
  const p = Object.fromEntries(fmt(tz).formatToParts(at).map((x) => [x.type, x.value]));
  const asUtc = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second));
  return asUtc - Math.floor(at.getTime() / 1000) * 1000;
}

/** Local calendar parts of an instant in `tz`. dow: 0 = Sunday. */
export function localParts(tz: string, at: Date): { date: string; minute: number; dow: number } {
  const p = Object.fromEntries(fmt(tz).formatToParts(at).map((x) => [x.type, x.value]));
  const date = `${p.year}-${p.month}-${p.day}`;
  const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
  return { date, minute: Number(p.hour) * 60 + Number(p.minute), dow };
}

/**
 * Converts a local wall-clock time (date + minutes after midnight) to the UTC instant. For a time that does not exist (spring-forward gap)
 * the result is shifted forward by the gap; for an ambiguous time (fall-back) the earlier instant is used.
 */
export function zonedToUtc(date: string, minute: number, tz: string): Date {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const naive = Date.UTC(y, m - 1, d, 0, minute, 0);
  let guess = naive - tzOffsetMs(tz, new Date(naive));
  const off2 = tzOffsetMs(tz, new Date(guess));
  guess = naive - off2;
  // If the corrected guess lands in a different offset (we straddled a transition), prefer the earlier valid instant.
  const check = tzOffsetMs(tz, new Date(guess));
  if (check !== off2) guess = naive - check;
  return new Date(guess);
}

export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10);
}

export function dowOf(date: string): number { return new Date(`${date}T00:00:00Z`).getUTCDay(); }
