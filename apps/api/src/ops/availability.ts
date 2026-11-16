import type { TxClient } from '@leadpilot/database';
import { addDays, dowOf, zonedToUtc } from '../common/tz.js';

export interface Window { start: number; end: number }
/** Used only until a workspace configures its own hours: Monday to Saturday, 10:00 to 19:00. */
export const DEFAULT_WINDOWS: Record<number, Window[]> = { 0: [], 1: [{ start: 600, end: 1140 }], 2: [{ start: 600, end: 1140 }], 3: [{ start: 600, end: 1140 }], 4: [{ start: 600, end: 1140 }], 5: [{ start: 600, end: 1140 }], 6: [{ start: 600, end: 1140 }] };
export const SLOT_STEP_MINUTES = 30;
/** Nobody can be booked into the next few minutes: an agent needs time to see the booking. */
export const MIN_NOTICE_MINUTES = 30;

export interface AvailabilityData {
  /** rules by membership id ('' = workspace default) */
  rules: Map<string, { dayOfWeek: number; startMinute: number; endMinute: number }[]>;
  exceptions: { membershipId: string | null; date: string; startMinute: number | null; endMinute: number | null }[];
}

export async function loadAvailability(tx: TxClient, tenantId: string): Promise<AvailabilityData> {
  // Sequential on purpose: one transaction = one connection, which cannot run queries concurrently.
  const rules = await tx.availabilityRule.findMany({ where: { tenantId } });
  const exceptions = await tx.availabilityException.findMany({ where: { tenantId }, select: { membershipId: true, date: true, startMinute: true, endMinute: true } });
  const map: AvailabilityData['rules'] = new Map();
  for (const r of rules) map.set(r.membershipId ?? '', [...(map.get(r.membershipId ?? '') ?? []), { dayOfWeek: r.dayOfWeek, startMinute: r.startMinute, endMinute: r.endMinute }]);
  return { rules: map, exceptions };
}

/** A person's own rules fully replace the workspace default for them; the workspace default replaces the built-in one. */
export function windowsFor(data: AvailabilityData, membershipId: string, date: string): Window[] {
  const dow = dowOf(date);
  const own = data.rules.get(membershipId);
  const ws = data.rules.get('');
  let windows: Window[];
  if (own && own.length > 0) windows = own.filter((r) => r.dayOfWeek === dow).map((r) => ({ start: r.startMinute, end: r.endMinute }));
  else if (ws && ws.length > 0) windows = ws.filter((r) => r.dayOfWeek === dow).map((r) => ({ start: r.startMinute, end: r.endMinute }));
  else windows = [...(DEFAULT_WINDOWS[dow] ?? [])];
  for (const ex of data.exceptions) {
    if (ex.date !== date || (ex.membershipId !== null && ex.membershipId !== membershipId)) continue;
    if (ex.startMinute === null || ex.endMinute === null) return [];
    windows = windows.flatMap((w) => {
      if (ex.endMinute! <= w.start || ex.startMinute! >= w.end) return [w];
      const out: Window[] = [];
      if (ex.startMinute! > w.start) out.push({ start: w.start, end: ex.startMinute! });
      if (ex.endMinute! < w.end) out.push({ start: ex.endMinute!, end: w.end });
      return out;
    });
  }
  return windows.sort((a, b) => a.start - b.start);
}

export interface Busy { membershipId: string; startsAt: Date; endsAt: Date }
export interface Slot { startsAt: Date; endsAt: Date; membershipIds: string[] }

/** All bookable slots for the given people on one local date. Pure: callers supply availability, busy intervals and the clock. */
export function slotsForDate(opts: { data: AvailabilityData; date: string; tz: string; durationMinutes: number; membershipIds: string[]; busy: Busy[]; now: Date }): Slot[] {
  const earliest = opts.now.getTime() + MIN_NOTICE_MINUTES * 60_000;
  const byStart = new Map<number, Slot>();
  for (const m of opts.membershipIds) {
    for (const w of windowsFor(opts.data, m, opts.date)) {
      const windowEnd = zonedToUtc(opts.date, w.end, opts.tz).getTime();
      for (let minute = w.start; minute < w.end; minute += SLOT_STEP_MINUTES) {
        const startsAt = zonedToUtc(opts.date, minute, opts.tz);
        const endsAt = new Date(startsAt.getTime() + opts.durationMinutes * 60_000);
        if (endsAt.getTime() > windowEnd || startsAt.getTime() < earliest) continue;
        if (opts.busy.some((b) => b.membershipId === m && b.startsAt < endsAt && b.endsAt > startsAt)) continue;
        const k = startsAt.getTime();
        const slot = byStart.get(k) ?? { startsAt, endsAt, membershipIds: [] };
        slot.membershipIds.push(m);
        byStart.set(k, slot);
      }
    }
  }
  return [...byStart.values()].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
}

/** True when [startsAt, endsAt) lies fully inside one of the person's working windows on that local date. */
export function withinWorkingHours(data: AvailabilityData, membershipId: string, tz: string, startsAt: Date, endsAt: Date, localDate: string): boolean {
  return windowsFor(data, membershipId, localDate).some((w) => startsAt.getTime() >= zonedToUtc(localDate, w.start, tz).getTime() && endsAt.getTime() <= zonedToUtc(localDate, w.end, tz).getTime());
}

export { addDays };
