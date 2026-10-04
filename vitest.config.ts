import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { root: '.', include: ['tests/**/*.test.ts'], testTimeout: 60_000, env: { DATA_DIR: './data-store-test', MOCK_AI: '1' } },
});
