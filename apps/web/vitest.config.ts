import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// The app's `@/` alias and the automatic JSX runtime, so presentational components can be rendered to a string in unit tests.
export default defineConfig({
  esbuild: { jsx: 'automatic' },
  resolve: { alias: { '@': fileURLToPath(new URL('.', import.meta.url)) } },
});
