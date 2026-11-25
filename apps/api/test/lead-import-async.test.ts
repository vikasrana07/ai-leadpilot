import { describe, expect, it, vi } from 'vitest';
import { LeadImportService } from '../src/leads/lead-import.service.js';
import type { Actor } from '../src/common/actor.js';

describe('LeadImportService (Async, BullMQ & Batching)', () => {
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

  it('offloads to BullMQ JobsService when available and builds full-row error CSV in worker', async () => {
    const txMock = {
      pipelineStage: { findMany: vi.fn().mockResolvedValue([{ id: 'st-1', key: 'new', name: 'New', kind: 'OPEN', position: 0 }]) },
      leadSource: { findMany: vi.fn().mockResolvedValue([{ id: 'src-1', key: 'csv_import', name: 'CSV Import' }]) },
      membership: { findMany: vi.fn().mockResolvedValue([{ id: 'm-123', userId: 'u-123' }]) },
      customFieldDefinition: { findMany: vi.fn().mockResolvedValue([]) },
      user: { findMany: vi.fn().mockResolvedValue([{ id: 'u-123', email: 'a@b.test' }]) },
      lead: { findMany: vi.fn().mockResolvedValue([]), createMany: vi.fn().mockResolvedValue({ count: 0 }) },
    };
    const mockDb = {
      tenantTx: vi.fn().mockImplementation((_ctx, fn) => fn(txMock)),
    };
    const mockJobs: any = {
      enqueueLeadImport: vi.fn().mockResolvedValue(true),
    };
    const mockModuleRef = {
      get: vi.fn().mockReturnValue(mockJobs),
    };

    const svc = new LeadImportService(mockDb as any, { record: vi.fn() } as any, { buildWhere: vi.fn() } as any, undefined, mockModuleRef as any);
    await svc.onApplicationBootstrap();
    expect(typeof mockJobs.processLeadImport).toBe('function');

    const csv = 'name,phone\nBadLead,not-a-phone';
    const queued = await svc.importCsv(actor, { csv, dryRun: true, duplicateStrategy: 'skip', async: true });
    expect(queued).toMatchObject({ status: 'QUEUED', totalRows: 1 });
    expect(mockJobs.enqueueLeadImport).toHaveBeenCalledTimes(1);

    const payload = mockJobs.enqueueLeadImport.mock.calls[0][0];
    expect(Array.isArray(payload.actor.permissions)).toBe(true);

    await mockJobs.processLeadImport(payload);
    const done = await svc.getImportJob(actor, payload.jobId);
    expect(done?.status).toBe('COMPLETED');
    expect(done?.invalid).toHaveLength(1);

    const errCsv = await svc.getImportErrorsCsv(actor, payload.jobId);
    expect(errCsv).toContain('name,phone,row,errors');
    expect(errCsv).toContain('BadLead,not-a-phone,2,');
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
