/**
 * KJC-TSK-0355 — token persistence sanity checks.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, statSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { getOrCreateToken, getTokenPath } from '../src/token-store.js';

let tmpDir;
let originalKjHome;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'hu-board-token-'));
  originalKjHome = process.env.KJ_HOME;
  process.env.KJ_HOME = tmpDir;
});

afterEach(() => {
  if (originalKjHome === undefined) delete process.env.KJ_HOME;
  else process.env.KJ_HOME = originalKjHome;
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('token-store', () => {
  it('writes a fresh hex-encoded token on first call', () => {
    const token = getOrCreateToken();
    expect(token).toBeTypeOf('string');
    expect(token.length).toBeGreaterThanOrEqual(32);
    expect(token).toMatch(/^[0-9a-f]+$/);
  });

  it('persists the token to ~/.karajan/hu-board/token (mode 0600 on POSIX)', () => {
    const token = getOrCreateToken();
    const tokenPath = getTokenPath();
    expect(tokenPath.startsWith(tmpDir)).toBe(true);
    expect(readFileSync(tokenPath, 'utf8').trim()).toBe(token);
    if (process.platform !== 'win32') {
      const mode = statSync(tokenPath).mode & 0o777;
      expect(mode).toBe(0o600);
    }
  });

  it('reuses the existing token on subsequent calls (idempotent)', () => {
    const first = getOrCreateToken();
    const second = getOrCreateToken();
    expect(second).toBe(first);
  });

  it('regenerates the token if the on-disk file is corrupt / too short', () => {
    const tokenPath = getTokenPath();
    mkdirSync(dirname(tokenPath), { recursive: true });
    writeFileSync(tokenPath, 'short');
    const token = getOrCreateToken();
    expect(token.length).toBeGreaterThanOrEqual(32);
    expect(readFileSync(tokenPath, 'utf8').trim()).toBe(token);
  });
});
