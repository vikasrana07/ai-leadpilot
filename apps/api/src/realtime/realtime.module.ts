import { Controller, Get, Global, Inject, Injectable, Logger, Module, type OnModuleDestroy, type OnModuleInit, Req, Res } from '@nestjs/common';
import { Redis } from 'ioredis';
import type { Response } from 'express';
import { CurrentTenant } from '../common/decorators.js';
import type { AppRequest, TenantRequestContext } from '../common/request-context.js';
import { ENV } from '../common/tokens.js';
import type { Env } from '../config/env.js';

export interface RealtimeEvent {
  type: 'message.created' | 'message.status' | 'conversation.updated' | 'notification.created';
  conversationId: string;
  /** notification.created: delivered only to this membership. */
  membershipId?: string;
  /** Used to scope delivery: agents without `conversation:read:all` only receive events for their own conversations. */
  assignedMembershipId: string | null;
  data?: Record<string, string | number | boolean | null>;
}

type Listener = (e: RealtimeEvent) => void;

/**
 * Tenant-scoped event fan-out. Events go through Redis pub/sub so every API instance can serve every connected browser
 * (ADR-0006). If Redis is unreachable the event is delivered to this instance's listeners directly and the failure is logged.
 */
@Injectable()
export class RealtimeService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('Realtime');
  private readonly pub: Redis;
  private readonly sub: Redis;
  private readonly listeners = new Map<string, Set<Listener>>();

  constructor(@Inject(ENV) env: Env) {
    this.pub = new Redis(env.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 1, enableOfflineQueue: false });
    this.sub = new Redis(env.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: null });
    this.pub.on('error', () => undefined);
    this.sub.on('error', () => undefined);
  }

  async onModuleInit(): Promise<void> {
    try {
      await Promise.all([this.pub.connect(), this.sub.connect()]);
      await this.sub.psubscribe('rt:*');
      this.sub.on('pmessage', (_pattern: string, channel: string, message: string) => {
        try { this.dispatch(channel.slice(3), JSON.parse(message) as RealtimeEvent); } catch { /* ignore malformed */ }
      });
    } catch (e) { this.log.error(`Redis unavailable, realtime is local-only: ${e instanceof Error ? e.message : String(e)}`); }
  }

  async onModuleDestroy(): Promise<void> { this.pub.disconnect(); this.sub.disconnect(); }

  private dispatch(tenantId: string, e: RealtimeEvent): void {
    for (const l of this.listeners.get(tenantId) ?? []) l(e);
  }

  publish(tenantId: string, event: RealtimeEvent): void {
    if (this.pub.status === 'ready') void this.pub.publish(`rt:${tenantId}`, JSON.stringify(event)).catch(() => this.dispatch(tenantId, event));
    else this.dispatch(tenantId, event);
  }

  subscribe(tenantId: string, l: Listener): () => void {
    const set = this.listeners.get(tenantId) ?? new Set<Listener>();
    set.add(l); this.listeners.set(tenantId, set);
    return () => { set.delete(l); if (set.size === 0) this.listeners.delete(tenantId); };
  }
}

@Controller('realtime')
class RealtimeController {
  constructor(@Inject(RealtimeService) private readonly rt: RealtimeService) {}

  /** Server-sent events. Browsers send the auth cookie; the tenant is the validated membership's, never a parameter. */
  @Get('stream')
  stream(@CurrentTenant() ctx: TenantRequestContext, @Req() req: AppRequest, @Res() res: Response): void {
    res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.flushHeaders();
    res.write('retry: 5000\n\n');
    const seeAll = ctx.permissions.has('conversation:read:all');
    const canSee = seeAll || ctx.permissions.has('conversation:read:own');
    const unsub = this.rt.subscribe(ctx.tenantId, (e) => {
      if (e.type === 'notification.created') {
        if (e.membershipId === ctx.membershipId) res.write(`event: notification.created\ndata: ${JSON.stringify(e.data ?? {})}\n\n`);
        return;
      }
      if (!canSee || (!seeAll && e.assignedMembershipId !== ctx.membershipId)) return;
      res.write(`event: ${e.type}\ndata: ${JSON.stringify({ conversationId: e.conversationId, ...e.data })}\n\n`);
    });
    const beat = setInterval(() => res.write(': ping\n\n'), 25_000);
    req.on('close', () => { clearInterval(beat); unsub(); });
  }
}

@Global()
@Module({ controllers: [RealtimeController], providers: [RealtimeService], exports: [RealtimeService] })
export class RealtimeModule {}
