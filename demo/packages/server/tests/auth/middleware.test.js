import { describe, it, expect, vi } from 'vitest';
import { authMiddleware } from '../../src/auth/middleware.js';
import { signAccessToken } from '../../src/auth/jwt.js';

function mockReqRes(cookies = {}) {
  return {
    req: { cookies },
    res: { status: vi.fn().mockReturnThis(), json: vi.fn() },
    next: vi.fn(),
  };
}

describe('authMiddleware', () => {
  it('sets req.user with valid token', () => {
    const token = signAccessToken({ id: 'u1', email: 'a@b.com' });
    const { req, res, next } = mockReqRes({ access_token: token });
    authMiddleware(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(req.user).toEqual({ id: 'u1', email: 'a@b.com' });
  });

  it('returns 401 without token', () => {
    const { req, res, next } = mockReqRes({});
    authMiddleware(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 with invalid token', () => {
    const { req, res, next } = mockReqRes({ access_token: 'bad' });
    authMiddleware(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });
});
