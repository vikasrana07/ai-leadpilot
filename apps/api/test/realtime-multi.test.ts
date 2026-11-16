import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RealtimeService } from '../src/realtime/realtime.module.js';
import { cleanup, createTestApp, type TestCtx } from './helpers.js';

/** Two API instances behind a load balancer: an event raised on one must reach a browser connected to the other (and only that tenant's). */
let a: TestCtx; let b: TestCtx;
beforeAll(async () => { a = await createTestApp(); b = await createTestApp(); });
afterAll(async () => { await a.close(); await b.close(); await cleanup(); });

describe('realtime across instances', () => {
  it('delivers a tenant event published on instance A to a listener on instance B, not to another tenant', async () => {
    const A = a.app.get(RealtimeService); const B = b.app.get(RealtimeService);
    const tenant = '00000000-0000-4000-8000-00000000aaaa'; const other = '00000000-0000-4000-8000-00000000bbbb';
    const got: unknown[] = []; const leaked: unknown[] = [];
    const off = B.subscribe(tenant, (e) => got.push(e)); const off2 = B.subscribe(other, (e) => leaked.push(e));
    await new Promise((r) => setTimeout(r, 300)); // pattern subscription settles
    A.publish(tenant, { type: 'message.created', conversationId: 'c1', assignedMembershipId: null, data: { x: 1 } } as never);
    for (let i = 0; i < 40 && got.length === 0; i++) await new Promise((r) => setTimeout(r, 50));
    expect(got).toHaveLength(1); expect(leaked).toHaveLength(0);
    off(); off2();
  });
});
