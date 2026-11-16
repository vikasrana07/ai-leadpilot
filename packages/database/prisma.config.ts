import { config as loadEnv } from 'dotenv';
import { defineConfig } from 'prisma/config';

loadEnv({ path: '../../.env' });

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations', seed: 'tsx src/seed.ts' },
  datasource: {
    // Migrations run as the schema OWNER role. The runtime client uses DATABASE_URL (RLS-subject role).
    url: process.env.DATABASE_OWNER_URL ?? '',
    // Shadow DB for `migrate dev` (pre-created with the required extensions; see postgres-init.sh).
    shadowDatabaseUrl: process.env.DATABASE_SHADOW_URL ?? '',
  },
});
