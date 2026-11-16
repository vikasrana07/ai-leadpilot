import argon2 from 'argon2';
import { randomUUID } from 'node:crypto';
import { createPrismaClient } from './index.js';

/**
 * Creates (or resets the password of) a platform administrator. Runs as the schema OWNER: the application role cannot create
 * admins, by design. Usage:
 *   PLATFORM_ADMIN_PASSWORD='...' pnpm --filter @leadpilot/database platform:create-admin you@company.com "Your Name"
 * The password comes from the environment, never argv (shell history, process lists).
 */
const [email, name] = process.argv.slice(2);
const password = process.env.PLATFORM_ADMIN_PASSWORD;
const url = process.env.DATABASE_OWNER_URL;
if (!email || !name || !password || !url) throw new Error('Usage: PLATFORM_ADMIN_PASSWORD=... platform:create-admin <email> "<name>" (needs DATABASE_OWNER_URL)');
if (password.length < 12) throw new Error('Use a password of at least 12 characters');

const prisma = createPrismaClient(url);
const passwordHash = await argon2.hash(password, { type: argon2.argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 });
const existing = await prisma.platformAdmin.findUnique({ where: { email } });
if (existing) {
  await prisma.platformAdmin.update({ where: { id: existing.id }, data: { passwordHash, name, status: 'ACTIVE', failedLogins: 0, lockedUntil: null } });
  console.log(`Updated platform admin ${email}`);
} else {
  await prisma.platformAdmin.create({ data: { id: randomUUID(), email, name, passwordHash } });
  console.log(`Created platform admin ${email}`);
}
await prisma.$disconnect();
