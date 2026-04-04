import { verifyToken } from './jwt.js';
import { ERROR_CODES } from '@taskboard/shared';
import { logger } from '../logger.js';

/**
 * Express middleware that validates the JWT from httpOnly cookie.
 * Sets req.user = { id, email } on success.
 */
export function authMiddleware(req, res, next) {
  const token = req.cookies?.access_token;

  if (!token) {
    return res.status(401).json({
      error: ERROR_CODES.UNAUTHORIZED,
      message: 'Authentication required',
    });
  }

  try {
    const decoded = verifyToken(token);
    req.user = { id: decoded.sub, email: decoded.email };
    next();
  } catch (err) {
    logger.warn({ err: err.message }, 'Invalid token');
    return res.status(401).json({
      error: ERROR_CODES.UNAUTHORIZED,
      message: 'Invalid or expired token',
    });
  }
}
