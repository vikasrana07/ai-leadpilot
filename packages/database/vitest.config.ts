import { config } from 'dotenv';
import { defineConfig } from 'vitest/config';

config({ path: '../../.env', quiet: true });

export default defineConfig({
  test: { include: ['test/**/*.test.ts'], testTimeout: 30_000, fileParallelism: false },
});
