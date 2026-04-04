import { describe, it, expect, vi } from 'vitest';
import { AppError, errorHandler } from '../../src/middleware/error-handler.js';

describe('errorHandler', () => {
  function mockRes() {
    return { status: vi.fn().mockReturnThis(), json: vi.fn() };
  }

  it('handles AppError with correct status', () => {
    const err = new AppError('NOT_FOUND', 'Not found');
    const res = mockRes();
    errorHandler(err, {}, res, () => {});
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: 'NOT_FOUND', message: 'Not found' });
  });

  it('handles unknown errors as 500', () => {
    const res = mockRes();
    errorHandler(new Error('boom'), {}, res, () => {});
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'INTERNAL_ERROR' })
    );
  });

  it('uses custom statusCode when provided', () => {
    const err = new AppError('VALIDATION_ERROR', 'Bad input', 422);
    const res = mockRes();
    errorHandler(err, {}, res, () => {});
    expect(res.status).toHaveBeenCalledWith(422);
  });
});
