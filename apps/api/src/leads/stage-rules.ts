import type { StageKind } from '@leadpilot/database';

export interface StageLite { id: string; name: string; kind: StageKind; canCloseWon: boolean; position: number }

export type TransitionCheck = { ok: true } | { ok: false; status: 400 | 403 | 422; code: string; message: string };

/**
 * Pure transition rules (unit-tested). Reopening a closed lead needs `lead:write:all`; a lead can only be won from
 * stages flagged `canCloseWon`; losing a lead requires an (active) lost reason.
 */
export function checkTransition(
  from: StageLite,
  to: StageLite,
  opts: { canReopen: boolean; hasLostReason: boolean; nextWinnableName?: string | undefined },
): TransitionCheck {
  if (from.id === to.id) return { ok: false, status: 400, code: 'same_stage', message: 'The lead is already in this stage' };
  if (from.kind !== 'OPEN' && to.kind === 'OPEN' && !opts.canReopen) {
    return { ok: false, status: 403, code: 'reopen_not_allowed', message: 'Only managers can reopen a closed lead' };
  }
  if (from.kind !== 'OPEN' && to.kind !== 'OPEN' && from.kind !== to.kind) {
    return { ok: false, status: 422, code: 'stage_transition_not_allowed', message: 'Reopen the lead before changing its outcome' };
  }
  if (to.kind === 'WON' && from.kind === 'OPEN' && !from.canCloseWon) {
    const hint = opts.nextWinnableName ? ` Move it to ${opts.nextWinnableName} first.` : '';
    return { ok: false, status: 422, code: 'stage_transition_not_allowed', message: `A lead cannot be marked Won from ${from.name}.${hint}` };
  }
  if (to.kind === 'LOST' && !opts.hasLostReason) {
    return { ok: false, status: 400, code: 'lost_reason_required', message: 'Choose a reason for losing this lead' };
  }
  return { ok: true };
}
