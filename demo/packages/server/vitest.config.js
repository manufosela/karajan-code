import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: ['src/**/*.js'],
      exclude: ['src/index.js', 'src/logger.js', 'src/db/connection.js'],
      thresholds: { lines: 80, functions: 70, branches: 70, statements: 80 },
    },
    setupFiles: ['./tests/setup.js'],
  },
});
