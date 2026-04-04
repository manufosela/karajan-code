import { afterEach, vi } from 'vitest';

// Silence pino during tests
vi.mock('../src/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

afterEach(() => {
  vi.restoreAllMocks();
});
