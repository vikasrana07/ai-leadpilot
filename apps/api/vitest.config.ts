import { config } from 'dotenv';
import { defineConfig } from 'vitest/config';

config({ path: '../../.env', quiet: true });

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    fileParallelism: false,
    env: { NODE_ENV: 'test', AI_DEBOUNCE_MS: '0', VIRUS_SCAN_MODE: 'mock', AI_PROVIDER: 'mock', THROTTLE_AUTH_LIMIT: '1000', THROTTLE_GLOBAL_LIMIT: '100000' },
  },
});
