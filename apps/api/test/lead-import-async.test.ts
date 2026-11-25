import { describe, expect, it, vi } from 'vitest';
import { LeadImportService } from '../src/leads/lead-import.service.js';
import type { Actor } from '../src/common/actor.js';

describe('LeadImportService (Async & Batching)', () => {
  const actor: Actor = {
    tenantId: 't-123',
    userId: 'u-123',
    membershipId: 'm-123',
    permissions: new Set(['lead:import', 'lead:write:all', 'lead:assign']),
    requestId: 'req-1',
    ip: '127.0.0.1',
  };

  it('queues async import when async: true is provided', async () => {
    const mockDb = {
      tenantTx: vi.fn(),
    };
    const mockAudit = { record: vi.fn() };
    const mockLeads = { buildWhere: vi.fn() };

    const svc = new LeadImportService(mockDb as any, mockAudit as any, mockLeads as any);

    const csv = 'name,phone\nAlice,9876543210\nBob,9876543211';
    const result = await svc.importCsv(actor, { csv, dryRun: false, duplicateStrategy: 'skip', async: true });

    expect(result).toMatchObject({
      status: 'QUEUED',
      totalRows: 2,
    });
    expect('jobId' in result).toBe(true);

    if ('jobId' in result) {
      const job = await svc.getImportJob(actor, result.jobId);
      expect(job).not.toBeNull();
      expect(job?.totalRows).toBe(2);
    }
  });

  it('rejects unpermitted actors from checking import jobs', async () => {
    const unpermittedActor: Actor = {
      ...actor,
      permissions: new Set([]),
    };
    const svc = new LeadImportService({} as any, {} as any, {} as any);

    await expect(svc.getImportJob(unpermittedActor, 'job-1')).rejects.toThrow('You cannot view import jobs');
    await expect(svc.getImportErrorsCsv(unpermittedActor, 'job-1')).rejects.toThrow('You cannot view import jobs');
  });
});
