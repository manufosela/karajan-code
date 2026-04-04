import { describe, it, expect } from 'vitest';
import { signAccessToken, signRefreshToken, verifyToken } from '../../src/auth/jwt.js';

describe('JWT utils', () => {
  const payload = { id: 'user-123', email: 'test@example.com' };

  it('signs and verifies an access token', () => {
    const token = signAccessToken(payload);
    const decoded = verifyToken(token);
    expect(decoded.sub).toBe('user-123');
    expect(decoded.email).toBe('test@example.com');
  });

  it('signs and verifies a refresh token', () => {
    const token = signRefreshToken({ id: 'user-123' });
    const decoded = verifyToken(token);
    expect(decoded.sub).toBe('user-123');
    expect(decoded.type).toBe('refresh');
  });

  it('throws on invalid token', () => {
    expect(() => verifyToken('invalid.token.here')).toThrow();
  });

  it('throws on tampered token', () => {
    const token = signAccessToken(payload);
    const tampered = token.slice(0, -5) + 'XXXXX';
    expect(() => verifyToken(tampered)).toThrow();
  });
});
