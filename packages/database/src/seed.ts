import argon2 from 'argon2';
import { randomUUID } from 'node:crypto';
import { syncPermissions } from './sync-permissions.js';
import { bootstrapTenant, createPrismaClient, withTenant } from './index.js';

/**
 * DEV-ONLY sample data: two independent demo workspaces so tenant isolation can be seen in the UI.
 * Refuses to run when NODE_ENV=production. Idempotent: skips users that already exist.
 * All demo accounts share one password, printed at the end (it is not a secret: this is local sample data).
 */
if (process.env.NODE_ENV === 'production') throw new Error('Refusing to seed in production');
const ownerUrl = process.env.DATABASE_OWNER_URL;
const appUrl = process.env.DATABASE_URL;
if (!ownerUrl || !appUrl) throw new Error('DATABASE_OWNER_URL and DATABASE_URL are required');

const DEMO_PASSWORD = 'Demo-Passw0rd!';

const TENANTS = [
  { name: 'Skyline Realty (demo)', slug: 'skyline', industry: 'real_estate', members: [['Priya Nair', 'owner'], ['Rahul Mehta', 'manager'], ['Sneha Kulkarni', 'agent']] },
  { name: 'Brightpath Academy (demo)', slug: 'brightpath', industry: 'coaching', members: [['Arjun Rao', 'owner'], ['Meera Iyer', 'agent']] },
] as const;

await syncPermissions(ownerUrl);
const prisma = createPrismaClient(appUrl);
const passwordHash = await argon2.hash(DEMO_PASSWORD, { type: argon2.argon2id });

for (const t of TENANTS) {
  const first = t.members[0];
  const ownerEmail = `${first[0].split(' ')[0]?.toLowerCase()}@${t.slug}.demo.test`;
  const exists = await prisma.user.findUnique({ where: { email: ownerEmail } });
  if (exists) { console.log(`skip ${t.name} (already seeded)`); continue; }
  const tenantId = randomUUID();
  const ownerId = randomUUID();
  await withTenant(prisma, { tenantId, userId: ownerId }, async (tx) => {
    const { roleIds } = await bootstrapTenant(tx, tenantId, { name: t.name, email: ownerEmail, industry: t.industry });
    for (const [name, roleKey] of t.members) {
      const userId = roleKey === 'owner' ? ownerId : randomUUID();
      const email = `${name.split(' ')[0]?.toLowerCase()}@${t.slug}.demo.test`;
      await tx.user.create({ data: { id: userId, email, name, passwordHash, emailVerifiedAt: new Date() } });
      await tx.membership.create({ data: { tenantId, userId, roleId: roleIds[roleKey] } });
      console.log(`  ${email.padEnd(34)} ${roleKey}`);
    }
    await tx.tenant.update({ where: { id: tenantId }, data: { onboardingState: { step: 'complete', completed: ['business', 'industry', 'team'], skipped: ['whatsapp', 'assistant', 'knowledge', 'qualification'] } } });
  });
  console.log(`seeded ${t.name}`);
}
console.log(`\nDemo password for every account above: ${DEMO_PASSWORD}`);


// ---------------------------------------------------------------- demo CRM data (DEV ONLY, deterministic)
const FIRST = ['Vikram', 'Anita', 'Rohit', 'Neha', 'Karan', 'Pooja', 'Amit', 'Sunita', 'Rajesh', 'Divya', 'Manoj', 'Kavita', 'Sanjay', 'Ritu', 'Ashok', 'Meena', 'Nikhil', 'Swati', 'Deepak', 'Preeti'];
const LAST = ['Desai', 'Kapoor', 'Sharma', 'Joshi', 'Malhotra', 'Singh', 'Patil', 'Gupta', 'Kulkarni', 'Reddy', 'Nair', 'Iyer'];
const AREAS = ['Wakad', 'Baner', 'Hinjewadi', 'Kothrud', 'Viman Nagar', 'Kharadi', 'Aundh'];
const STAGE_PLAN = ['new', 'new', 'new', 'contacted', 'contacted', 'qualified', 'qualified', 'site_visit_scheduled', 'site_visit_completed', 'negotiation', 'won', 'lost'] as const;
const SOURCE_PLAN = ['meta_ads', 'meta_ads', 'portal', 'website_widget', 'whatsapp', 'referral', 'google_ads', 'walk_in'] as const;

async function seedDemoCrm(tenantName: string): Promise<void> {
  const tenant = await prisma.tenant.findFirst({ where: { name: tenantName } }).catch(() => null);
  const tenantId = tenant?.id ?? (await (async () => { const { default: pg } = await import('pg'); const pool = new pg.Pool({ connectionString: ownerUrl }); const r = await pool.query('SELECT id FROM tenants WHERE name = $1', [tenantName]); await pool.end(); return r.rows[0]?.id as string | undefined; })());
  if (!tenantId) return;
  await withTenant(prisma, { tenantId }, async (tx) => {
    if ((await tx.lead.count({ where: { tenantId } })) > 0) { console.log(`  CRM demo data already present for ${tenantName}`); return; }
    const stages = new Map((await tx.pipelineStage.findMany({ where: { tenantId } })).map((x) => [x.key, x]));
    const sources = new Map((await tx.leadSource.findMany({ where: { tenantId } })).map((x) => [x.key, x.id]));
    const reasons = await tx.lostReason.findMany({ where: { tenantId } });
    const agents = await tx.membership.findMany({ where: { tenantId, status: 'ACTIVE', role: { key: { in: ['agent', 'manager'] } } }, select: { id: true } });
    const owner = await tx.membership.findFirstOrThrow({ where: { tenantId, role: { key: 'owner' } }, select: { userId: true } });
    const now = Date.now();
    let n = 0;
    for (let i = 0; i < 60; i++) {
      const stageKey = STAGE_PLAN[(i * 7) % STAGE_PLAN.length] as (typeof STAGE_PLAN)[number];
      const stage = stages.get(stageKey)!;
      const createdAt = new Date(now - ((i * 13) % 28) * 86_400_000 - (i % 9) * 3_600_000);
      const name = `${FIRST[i % FIRST.length]} ${LAST[(i * 5) % LAST.length]}`;
      const hot = ['negotiation', 'site_visit_completed', 'site_visit_scheduled'].includes(stageKey) && i % 2 === 0;
      const lead = await tx.lead.create({ data: {
        id: randomUUID(), tenantId, name, phone: `+91${9800000000 + i * 137}`, phoneNorm: `91${9800000000 + i * 137}`, email: i % 3 === 0 ? `${name.toLowerCase().replace(/ /g, '.')}@example.test` : null,
        sourceId: sources.get(SOURCE_PLAN[i % SOURCE_PLAN.length] as string) ?? null, stageId: stage.id, temperature: hot ? 'HOT' : i % 4 === 0 ? 'WARM' : i % 5 === 0 ? 'COLD' : 'UNKNOWN',
        budgetMinMinor: BigInt((60 + (i % 9) * 10) * 100_000 * 100), budgetMaxMinor: BigInt((75 + (i % 9) * 12) * 100_000 * 100), location: AREAS[i % AREAS.length],
        propertyType: i % 3 === 0 ? '3 BHK apartment' : '2 BHK apartment', requirements: i % 4 === 0 ? 'Prefers a higher floor, near an IT park.' : null,
        buyingTimeline: (['IMMEDIATE', 'WITHIN_30_DAYS', 'ONE_TO_THREE_MONTHS', 'THREE_TO_SIX_MONTHS', 'UNKNOWN'] as const)[i % 5] as 'IMMEDIATE',
        assignedMembershipId: i % 6 === 5 ? null : agents[i % agents.length]?.id ?? null, score: hot ? 70 + (i % 25) : i % 3 === 0 ? 35 + (i % 30) : null,
        lastContactedAt: stageKey === 'new' ? null : new Date(createdAt.getTime() + 3_600_000 * (1 + (i % 20))),
        nextFollowUpAt: stage.kind === 'OPEN' && i % 3 !== 0 ? new Date(now + ((i % 9) - 2) * 86_400_000) : null,
        lostReasonId: stage.kind === 'LOST' ? reasons[i % reasons.length]?.id ?? null : null, createdByUserId: owner.userId, createdAt,
      } });
      await tx.leadActivity.create({ data: { id: randomUUID(), tenantId, leadId: lead.id, type: 'created', actorUserId: owner.userId, data: { source: 'demo_seed' }, createdAt } });
      if (stageKey !== 'new') await tx.stageTransition.create({ data: { id: randomUUID(), tenantId, leadId: lead.id, fromStageId: stages.get('new')!.id, toStageId: stage.id, actorUserId: owner.userId, createdAt: new Date(createdAt.getTime() + 86_400_000) } });
      if (i % 4 === 1) await tx.leadNote.create({ data: { id: randomUUID(), tenantId, leadId: lead.id, authorUserId: owner.userId, body: 'Spoke on the phone. Wants to compare two projects before visiting.', createdAt: new Date(createdAt.getTime() + 7_200_000) } });
      n++;
    }
    const projects: [string, string, number, number, number][] = [['Greenfield Heights', 'Wakad', 2, 1050, 7800], ['Greenfield Heights', 'Wakad', 3, 1380, 10800], ['Lakeview Residency', 'Baner', 2, 980, 9200], ['Lakeview Residency', 'Baner', 3, 1450, 13800], ['Sunrise Enclave', 'Hinjewadi', 2, 920, 6900], ['Sunrise Enclave', 'Hinjewadi', 3, 1320, 9400]];
    for (const [pi, [project, location, bhk, area, lakhs]] of projects.entries()) {
      for (let u = 1; u <= 2; u++) await tx.property.create({ data: { id: randomUUID(), tenantId, project, unitLabel: `${String.fromCharCode(65 + pi)}-${100 + u * 4}`, title: `${bhk} BHK in ${location}`, propertyType: 'Apartment', bedrooms: bhk, areaSqft: area, priceMinor: BigInt((lakhs + u * 120) * 100_000 * 100), location, status: u === 2 && pi % 3 === 0 ? 'SOLD' : u === 2 && pi % 2 === 0 ? 'HELD' : 'AVAILABLE' } });
    }
    console.log(`  demo CRM data: ${n} leads, ${projects.length * 2} properties for ${tenantName}`);
  });
}

await seedDemoCrm('Skyline Realty (demo)');
await prisma.$disconnect();
