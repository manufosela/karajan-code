import { ERROR_CODES } from '@taskboard/shared';

/**
 * Simple in-memory rate limiter.
 * @param {{ windowMs?: number, max?: number }} [options]
 * @returns {import('express').RequestHandler}
 */
export function rateLimit(options = {}) {
  const windowMs = options.windowMs || Number(process.env.RATE_LIMIT_WINDOW_MS) || 60_000;
  const max = options.max || Number(process.env.RATE_LIMIT_MAX) || 100;

  /** @type {Map<string, { count: number, resetAt: number }>} */
  const clients = new Map();

  // Cleanup expired entries periodically
  const cleanup = setInterval(() => {
    const now = Date.now();
    for (const [key, val] of clients) {
      if (now > val.resetAt) clients.delete(key);
    }
  }, windowMs);
  cleanup.unref();

  return (req, res, next) => {
    const key = req.ip || 'unknown';
    const now = Date.now();
    const record = clients.get(key);

    if (!record || now > record.resetAt) {
      clients.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }

    record.count++;
    if (record.count > max) {
      return res.status(429).json({
        error: ERROR_CODES.RATE_LIMITED,
        message: 'Too many requests',
      });
    }

    next();
  };
}
