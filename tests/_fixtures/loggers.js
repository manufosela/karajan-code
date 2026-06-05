import { vi } from "vitest";

// Shared test fixtures for the noop logger pattern. Twenty-plus test
// files declared the same `{ info, warn, error, debug }` mock inline
// (audit by KJC-TSK-0502). Importing from here keeps the shape uniform
// and gives a single point to extend (e.g. add `trace`) without sweeping
// the test tree.

export const createNoopLogger = () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
});

export const createNoopLoggerWithContext = () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  setContext: vi.fn(),
});
