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
await prisma.$disconnect();
