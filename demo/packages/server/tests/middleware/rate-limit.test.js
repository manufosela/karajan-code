import { describe, it, expect, vi } from 'vitest';
import { rateLimit } from '../../src/middleware/rate-limit.js';

describe('rateLimit', () => {
  it('allows requests within limit', () => {
    const limiter = rateLimit({ windowMs: 60000, max: 3 });
    const req = { ip: '127.0.0.1' };
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    const next = vi.fn();

    limiter(req, res, next);
    limiter(req, res, next);
    limiter(req, res, next);

    expect(next).toHaveBeenCalledTimes(3);
    expect(res.status).not.toHaveBeenCalled();
  });

  it('blocks requests over limit', () => {
    const limiter = rateLimit({ windowMs: 60000, max: 2 });
    const req = { ip: '127.0.0.1' };
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    const next = vi.fn();

    limiter(req, res, next);
    limiter(req, res, next);
    limiter(req, res, next); // Over limit

    expect(next).toHaveBeenCalledTimes(2);
    expect(res.status).toHaveBeenCalledWith(429);
  });

  it('tracks different IPs separately', () => {
    const limiter = rateLimit({ windowMs: 60000, max: 1 });
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    const next = vi.fn();

    limiter({ ip: '1.1.1.1' }, res, next);
    limiter({ ip: '2.2.2.2' }, res, next);

    expect(next).toHaveBeenCalledTimes(2);
  });
});
