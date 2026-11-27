/**
 * Monthly AI token allowance, as a pure calculation (no I/O) so every consumer agrees: the orchestrator's gate, the usage API, and the
 * owner notices. The cap is still a hard stop; two things make reaching it predictable instead of abrupt:
 *  - an early FORECAST of when the allowance runs out at the current pace, and
 *  - a small GRACE band above the cap that only conversations the AI is already handling may use, so a chat is not cut off mid-way.
 */
export type TokenCapLevel = 'OK' | 'WARN_80' | 'WARN_95' | 'EXCEEDED';
/** Which limit is binding: the owner's own cap (they can raise it) or the plan allowance (they must upgrade). */
export type TokenCapSource = 'own' | 'plan';

export interface TokenCapInput {
  used: number;
  ownCap: number;
  /** The plan's monthly allowance, or null when the plan has none. */
  planCap: number | null;
  now: Date;
  monthStart: Date;
  monthEnd: Date;
  /** Extra headroom (percent of the cap) for conversations already in progress. 0 disables the grace band. */
  gracePct: number;
}

export interface TokenCapState {
  cap: number;
  source: TokenCapSource;
  used: number;
  pct: number;
  level: TokenCapLevel;
  warning: boolean;
  exceeded: boolean;
  /** First token count at which even conversations already in progress are stopped. */
  graceLimit: number;
  /** Over the cap but inside the grace band: only chats the AI is already handling may continue. */
  inGrace: boolean;
  /** When the cap runs out at this month's pace, or null if it will last until the month resets (or there is too little data to say). */
  projectedExhaustionAt: string | null;
}

/** Below this much of the month elapsed (or this many tokens used) a linear projection is noise, so none is given. */
const MIN_ELAPSED_FRACTION = 0.05;
const MIN_USED_FOR_FORECAST = 1_000;

export function evaluateTokenCap(i: TokenCapInput): TokenCapState {
  const source: TokenCapSource = i.planCap !== null && i.planCap < i.ownCap ? 'plan' : 'own';
  const cap = i.planCap === null ? i.ownCap : Math.min(i.ownCap, i.planCap);
  const pctRaw = cap > 0 ? (i.used / cap) * 100 : 100;
  const exceeded = i.used >= cap;
  const level: TokenCapLevel = exceeded ? 'EXCEEDED' : pctRaw >= 95 ? 'WARN_95' : pctRaw >= 80 ? 'WARN_80' : 'OK';
  const graceLimit = Math.floor(cap * (1 + Math.max(0, i.gracePct) / 100));

  let projectedExhaustionAt: string | null = null;
  const total = i.monthEnd.getTime() - i.monthStart.getTime();
  const elapsed = i.now.getTime() - i.monthStart.getTime();
  if (!exceeded && total > 0 && elapsed > 0 && elapsed / total >= MIN_ELAPSED_FRACTION && i.used >= MIN_USED_FOR_FORECAST) {
    const perMs = i.used / elapsed;
    const at = i.now.getTime() + (cap - i.used) / perMs;
    if (at < i.monthEnd.getTime()) projectedExhaustionAt = new Date(at).toISOString();
  }

  return {
    cap, source, used: i.used, pct: Math.min(100, Math.round(pctRaw * 10) / 10), level, warning: pctRaw >= 80, exceeded,
    graceLimit, inGrace: exceeded && i.used < graceLimit, projectedExhaustionAt,
  };
}
