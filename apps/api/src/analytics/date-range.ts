import type { AnalyticsQuery } from '@leadpilot/validation';

/** Milliseconds the zone is ahead of UTC at instant `d`. */
function offsetMs(d: Date, tz: string): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
      .formatToParts(d).map((p) => [p.type, p.value]),
  ) as Record<string, string>;
  const asUtc = Date.UTC(+(parts.year as string), +(parts.month as string) - 1, +(parts.day as string), +(parts.hour as string), +(parts.minute as string), +(parts.second as string));
  return asUtc - Math.floor(d.getTime() / 1000) * 1000;
}

/** The UTC instant at which the calendar day containing `d` starts in `tz`. */
export function startOfDay(d: Date, tz: string): Date {
  const local = new Date(d.getTime() + offsetMs(d, tz));
  const guess = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
  const first = new Date(guess - offsetMs(new Date(guess), tz));
  // Re-evaluate the offset at the candidate to stay correct across DST changes.
  return new Date(guess - offsetMs(first, tz));
}

export function addDays(d: Date, days: number, tz: string): Date {
  const local = new Date(d.getTime() + offsetMs(d, tz));
  const guess = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + days);
  return startOfDay(new Date(guess - offsetMs(new Date(guess), tz) + 12 * 3600_000), tz);
}

export interface Range { from: Date; to: Date; label: string }

/** `to` is exclusive. All boundaries are midnights in the tenant's timezone. */
export function resolveRange(q: Pick<AnalyticsQuery, 'range' | 'from' | 'to'>, tz: string, now = new Date()): Range {
  const today = startOfDay(now, tz);
  switch (q.range) {
    case 'today': return { from: today, to: addDays(today, 1, tz), label: 'Today' };
    case 'yesterday': return { from: addDays(today, -1, tz), to: today, label: 'Yesterday' };
    case '7d': return { from: addDays(today, -6, tz), to: addDays(today, 1, tz), label: 'Last 7 days' };
    case 'month': {
      const local = new Date(now.getTime() + offsetMs(now, tz));
      const first = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), 1));
      const next = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth() + 1, 1));
      return { from: startOfDay(new Date(first.getTime() - offsetMs(first, tz) + 12 * 3600_000), tz), to: startOfDay(new Date(next.getTime() - offsetMs(next, tz) + 12 * 3600_000), tz), label: 'This month' };
    }
    case 'custom': {
      if (!q.from || !q.to) throw new Error('custom range needs from and to');
      const from = startOfDay(new Date(q.from), tz);
      return { from, to: addDays(startOfDay(new Date(q.to), tz), 1, tz), label: 'Custom range' };
    }
    default: return { from: addDays(today, -29, tz), to: addDays(today, 1, tz), label: 'Last 30 days' };
  }
}

export function previousRange(r: Range): Range {
  const len = r.to.getTime() - r.from.getTime();
  return { from: new Date(r.from.getTime() - len), to: r.from, label: 'Previous period' };
}
