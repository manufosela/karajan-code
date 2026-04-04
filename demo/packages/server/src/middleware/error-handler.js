import { ERROR_CODES, STATUS_CODES } from '@taskboard/shared';
import { logger } from '../logger.js';

/**
 * Structured error class for the API.
 */
export class AppError extends Error {
  /**
   * @param {string} code - Error code from ERROR_CODES
   * @param {string} message - Human-readable message
   * @param {number} [statusCode] - HTTP status override
   */
  constructor(code, message, statusCode) {
    super(message);
    this.code = code;
    this.statusCode = statusCode || STATUS_CODES[code] || 500;
  }
}

/**
 * Express error-handling middleware.
 * Must have 4 params to be recognized by Express.
 */
export function errorHandler(err, _req, res, _next) {
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({
      error: err.code,
      message: err.message,
    });
  }

  logger.error({ err }, 'Unhandled error');

  res.status(500).json({
    error: ERROR_CODES.INTERNAL_ERROR,
    message: 'Internal server error',
  });
}
