export type DayKey = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';
export interface WorkingHours { enabled: boolean; days: Record<DayKey, { start: string; end: string } | null> }
const KEYS: DayKey[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

function localParts(now: Date, tz: string): { day: DayKey; minutes: number } {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', hourCycle: 'h23', hour: '2-digit', minute: '2-digit' }).formatToParts(now).map((x) => [x.type, x.value])) as Record<string, string>;
  const day = ({ Sun: 'sun', Mon: 'mon', Tue: 'tue', Wed: 'wed', Thu: 'thu', Fri: 'fri', Sat: 'sat' } as Record<string, DayKey>)[p.weekday as string] ?? 'mon';
  return { day, minutes: Number(p.hour) * 60 + Number(p.minute) };
}
const toMin = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** When working hours are not configured the team is treated as always available (the assistant never invents a schedule). */
export function isOpenNow(h: WorkingHours | null | undefined, tz: string, now = new Date()): boolean {
  if (!h?.enabled) return true;
  const { day, minutes } = localParts(now, tz);
  const d = h.days[day];
  return d !== null && d !== undefined && minutes >= toMin(d.start) && minutes < toMin(d.end);
}

/** "Mon–Fri 10:00–19:00, Sat 10:00–14:00" style summary for the assistant to quote. */
export function describeHours(h: WorkingHours | null | undefined): string | null {
  if (!h?.enabled) return null;
  const names: Record<DayKey, string> = { mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun' };
  const parts: string[] = [];
  for (const k of ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as DayKey[]) { const d = h.days[k]; if (d) parts.push(`${names[k]} ${d.start}–${d.end}`); }
  return parts.length ? parts.join(', ') : 'closed';
}
export { KEYS as DAY_KEYS };
