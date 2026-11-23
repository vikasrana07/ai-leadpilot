import { describe, expect, it } from 'vitest';
import { isTxConflict, overlapKind } from '../src/ops/appointments.service.js';

describe('PostgreSQL exclusion constraint (btree_gist) error handlers', () => {
  it('detects agent appointment exclusion violation from constraint name', () => {
    const error = new Error('conflicting key value violates exclusion constraint "appointments_agent_no_overlap"');
    expect(overlapKind(error)).toBe('agent');
  });

  it('detects lead appointment exclusion violation from constraint name', () => {
    const error = new Error('conflicting key value violates exclusion constraint "appointments_lead_no_overlap"');
    expect(overlapKind(error)).toBe('lead');
  });

  it('unwraps nested error cause chains from Prisma or driver', () => {
    const root = new Error('Query failed');
    const nested = {
      message: 'Database error occurred',
      cause: {
        originalCode: '23P01',
        message: 'ERROR: conflicting key value violates exclusion constraint "appointments_agent_no_overlap"',
      },
    };
    (root as any).cause = nested;

    expect(overlapKind(root)).toBe('agent');
  });

  it('unwraps Prisma meta error payload', () => {
    const prismaError = {
      message: 'Raw query failed',
      meta: {
        code: '23P01',
        constraint: 'appointments_lead_no_overlap',
      },
    };

    expect(overlapKind(prismaError)).toBe('lead');
  });

  it('returns null for unrelated database errors', () => {
    const syntaxError = new Error('syntax error at or near "SELECT"');
    expect(overlapKind(syntaxError)).toBeNull();
  });

  it('identifies retryable transaction serialization and deadlock conflicts', () => {
    expect(isTxConflict({ code: 'P2034' })).toBe(true);
    expect(isTxConflict(new Error('deadlock detected'))).toBe(true);
    expect(isTxConflict(new Error('could not serialize access due to concurrent update'))).toBe(true);
    expect(isTxConflict(new Error('normal unique constraint error'))).toBe(false);
  });
});
