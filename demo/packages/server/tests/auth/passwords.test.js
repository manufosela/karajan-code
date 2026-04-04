import { describe, it, expect } from 'vitest';
import { hashPassword, comparePassword } from '../../src/auth/passwords.js';

describe('Password utils', () => {
  it('hashes a password and verifies it', async () => {
    const hash = await hashPassword('MyPassword123');
    expect(hash).not.toBe('MyPassword123');
    expect(await comparePassword('MyPassword123', hash)).toBe(true);
  });

  it('rejects wrong password', async () => {
    const hash = await hashPassword('Correct');
    expect(await comparePassword('Wrong', hash)).toBe(false);
  });

  it('produces different hashes for same input', async () => {
    const h1 = await hashPassword('Same');
    const h2 = await hashPassword('Same');
    expect(h1).not.toBe(h2);
  });
});
