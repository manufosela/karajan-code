import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import { validate } from '../../src/middleware/validate.js';

describe('validate middleware', () => {
  const schema = z.object({ name: z.string().min(1) });

  function mockReqRes(body) {
    return {
      req: { body },
      res: { status: vi.fn().mockReturnThis(), json: vi.fn() },
      next: vi.fn(),
    };
  }

  it('passes valid data to next', () => {
    const { req, res, next } = mockReqRes({ name: 'valid' });
    validate(schema)(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(req.body.name).toBe('valid');
  });

  it('returns 400 on invalid data', () => {
    const { req, res, next } = mockReqRes({ name: '' });
    validate(schema)(req, res, next);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'VALIDATION_ERROR' })
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('includes field-level error details', () => {
    const { req, res, next } = mockReqRes({});
    validate(schema)(req, res, next);
    const response = res.json.mock.calls[0][0];
    expect(response.details).toBeDefined();
    expect(response.details[0].path).toBe('name');
  });
});
