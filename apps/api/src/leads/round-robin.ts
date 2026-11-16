import type { Prisma, TxClient } from '@leadpilot/database';

export interface AssignmentSettings { strategy: 'manual' | 'round_robin'; cursor?: string | null }

export function readAssignmentSettings(settings: Prisma.JsonValue): AssignmentSettings {
  const a = (settings as { assignment?: AssignmentSettings } | null)?.assignment;
  return { strategy: a?.strategy === 'round_robin' ? 'round_robin' : 'manual', cursor: a?.cursor ?? null };
}

/** In-memory round-robin over active sales agents (managers only when there are no agents). */
export class RoundRobin {
  private constructor(private readonly ids: string[], private cursor: string | null, readonly enabled: boolean, private readonly tenantId: string) {}

  /** Locks the tenant row so concurrent creations cannot hand the same lead slot to the same agent twice. */
  static async load(tx: TxClient, tenantId: string): Promise<RoundRobin> {
    await tx.$queryRaw`SELECT id FROM tenants WHERE id = ${tenantId}::uuid FOR UPDATE`;
    const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { settings: true } });
    const cfg = readAssignmentSettings(tenant.settings);
    if (cfg.strategy !== 'round_robin') return new RoundRobin([], null, false, tenantId);
    const load = (key: string) => tx.membership.findMany({ where: { tenantId, status: 'ACTIVE', role: { key } }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], select: { id: true } });
    let pool = await load('agent');
    if (pool.length === 0) pool = await load('manager');
    return new RoundRobin(pool.map((m) => m.id), cfg.cursor ?? null, true, tenantId);
  }

  next(): string | null {
    if (!this.enabled || this.ids.length === 0) return null;
    const i = this.cursor ? this.ids.indexOf(this.cursor) : -1;
    const pick = this.ids[(i + 1) % this.ids.length] as string;
    this.cursor = pick;
    return pick;
  }

  async save(tx: TxClient): Promise<void> {
    if (!this.enabled) return;
    const t = await tx.tenant.findUniqueOrThrow({ where: { id: this.tenantId }, select: { settings: true } });
    const settings = (t.settings ?? {}) as Record<string, unknown>;
    await tx.tenant.update({ where: { id: this.tenantId }, data: { settings: { ...settings, assignment: { strategy: 'round_robin', cursor: this.cursor } } } });
  }
}
