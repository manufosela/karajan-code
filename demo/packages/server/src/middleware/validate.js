import { ZodError } from 'zod';
import { ERROR_CODES } from '@taskboard/shared';

/**
 * Express middleware factory for Zod schema validation.
 * @param {import('zod').ZodSchema} schema
 * @returns {import('express').RequestHandler}
 */
export function validate(schema) {
  return (req, res, next) => {
    try {
      req.body = schema.parse(req.body);
      next();
    } catch (err) {
      if (err instanceof ZodError) {
        return res.status(400).json({
          error: ERROR_CODES.VALIDATION_ERROR,
          message: 'Validation failed',
          details: err.errors.map((e) => ({
            path: e.path.join('.'),
            message: e.message,
          })),
        });
      }
      next(err);
    }
  };
}
