import { describe, expect, it, vi } from 'vitest';
import { SOFT_DELETE_MODELS, softDeleteQueryExtension } from '../src/soft-delete.js';

describe('Soft Delete Extension', () => {
  it('identifies soft delete models correctly', () => {
    expect(SOFT_DELETE_MODELS.has('Lead')).toBe(true);
    expect(SOFT_DELETE_MODELS.has('Property')).toBe(true);
    expect(SOFT_DELETE_MODELS.has('KnowledgeDocument')).toBe(true);
    expect(SOFT_DELETE_MODELS.has('User')).toBe(false);
    expect(SOFT_DELETE_MODELS.has('Tenant')).toBe(false);
    expect(SOFT_DELETE_MODELS.has('AuditLog')).toBe(false);
  });

  it('injects deletedAt: null into findMany by default', async () => {
    const mockQuery = vi.fn().mockResolvedValue([{ id: '1', name: 'Active Lead' }]);
    const findMany = softDeleteQueryExtension.$allModels.findMany;

    await findMany({
      model: 'Lead',
      args: { where: { tenantId: 'tenant-1' } },
      query: mockQuery,
    });

    expect(mockQuery).toHaveBeenCalledWith({
      where: { tenantId: 'tenant-1', deletedAt: null },
    });
  });

  it('preserves findMany when withDeleted: true is passed at root', async () => {
    const mockQuery = vi.fn().mockResolvedValue([{ id: '1' }, { id: '2', deletedAt: new Date() }]);
    const findMany = softDeleteQueryExtension.$allModels.findMany;

    await findMany({
      model: 'Lead',
      args: { where: { tenantId: 'tenant-1' }, withDeleted: true },
      query: mockQuery,
    });

    expect(mockQuery).toHaveBeenCalledWith({
      where: { tenantId: 'tenant-1' },
    });
  });

  it('preserves findMany when withDeleted: true is passed in where', async () => {
    const mockQuery = vi.fn().mockResolvedValue([{ id: '1' }]);
    const findMany = softDeleteQueryExtension.$allModels.findMany;

    await findMany({
      model: 'Property',
      args: { where: { tenantId: 'tenant-1', withDeleted: true } },
      query: mockQuery,
    });

    expect(mockQuery).toHaveBeenCalledWith({
      where: { tenantId: 'tenant-1' },
    });
  });

  it('does not overwrite explicit deletedAt filter in findMany', async () => {
    const mockQuery = vi.fn().mockResolvedValue([]);
    const findMany = softDeleteQueryExtension.$allModels.findMany;

    await findMany({
      model: 'KnowledgeDocument',
      args: { where: { tenantId: 'tenant-1', deletedAt: { not: null } } },
      query: mockQuery,
    });

    expect(mockQuery).toHaveBeenCalledWith({
      where: { tenantId: 'tenant-1', deletedAt: { not: null } },
    });
  });

  it('does not alter queries on non-soft-delete models', async () => {
    const mockQuery = vi.fn().mockResolvedValue([{ id: 'u1' }]);
    const findMany = softDeleteQueryExtension.$allModels.findMany;

    await findMany({
      model: 'User',
      args: { where: { email: 'a@example.com' } },
      query: mockQuery,
    });

    expect(mockQuery).toHaveBeenCalledWith({
      where: { email: 'a@example.com' },
    });
  });

  it('injects deletedAt: null into findFirst and count', async () => {
    const mockQueryFirst = vi.fn().mockResolvedValue({ id: '1' });
    const mockQueryCount = vi.fn().mockResolvedValue(10);

    await softDeleteQueryExtension.$allModels.findFirst({
      model: 'Lead',
      args: { where: { id: 'lead-1' } },
      query: mockQueryFirst,
    });
    expect(mockQueryFirst).toHaveBeenCalledWith({
      where: { id: 'lead-1', deletedAt: null },
    });

    await softDeleteQueryExtension.$allModels.count({
      model: 'Property',
      args: { where: { status: 'AVAILABLE' } },
      query: mockQueryCount,
    });
    expect(mockQueryCount).toHaveBeenCalledWith({
      where: { status: 'AVAILABLE', deletedAt: null },
    });
  });

  it('filters out soft-deleted records in findUnique unless withDeleted is true', async () => {
    const activeLead = { id: 'l1', name: 'Active', deletedAt: null };
    const deletedLead = { id: 'l2', name: 'Deleted', deletedAt: new Date() };
    const findUnique = softDeleteQueryExtension.$allModels.findUnique;

    // Active lead returns record
    const r1 = await findUnique({
      model: 'Lead',
      args: { where: { id: 'l1' } },
      query: vi.fn().mockResolvedValue(activeLead),
    });
    expect(r1).toEqual(activeLead);

    // Deleted lead returns null
    const r2 = await findUnique({
      model: 'Lead',
      args: { where: { id: 'l2' } },
      query: vi.fn().mockResolvedValue(deletedLead),
    });
    expect(r2).toBeNull();

    // Deleted lead with withDeleted: true returns record
    const r3 = await findUnique({
      model: 'Lead',
      args: { where: { id: 'l2' }, withDeleted: true },
      query: vi.fn().mockResolvedValue(deletedLead),
    });
    expect(r3).toEqual(deletedLead);
  });

  it('throws P2025 on findUniqueOrThrow for soft-deleted record unless withDeleted is true', async () => {
    const deletedProperty = { id: 'p1', deletedAt: new Date() };
    const findUniqueOrThrow = softDeleteQueryExtension.$allModels.findUniqueOrThrow;

    await expect(
      findUniqueOrThrow({
        model: 'Property',
        args: { where: { id: 'p1' } },
        query: vi.fn().mockResolvedValue(deletedProperty),
      }),
    ).rejects.toThrowError();

    const allowed = await findUniqueOrThrow({
      model: 'Property',
      args: { where: { id: 'p1' }, withDeleted: true },
      query: vi.fn().mockResolvedValue(deletedProperty),
    });
    expect(allowed).toEqual(deletedProperty);
  });
});
