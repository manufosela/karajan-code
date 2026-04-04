import jwt from 'jsonwebtoken';

const SECRET = () => process.env.JWT_SECRET || 'dev-secret-change-me';
const EXPIRES_IN = () => process.env.JWT_EXPIRES_IN || '15m';
const REFRESH_EXPIRES_IN = () => process.env.JWT_REFRESH_EXPIRES_IN || '7d';

/**
 * Sign an access token.
 * @param {{ id: string, email: string }} payload
 * @returns {string}
 */
export function signAccessToken(payload) {
  return jwt.sign(
    { sub: payload.id, email: payload.email },
    SECRET(),
    { expiresIn: EXPIRES_IN() }
  );
}

/**
 * Sign a refresh token.
 * @param {{ id: string }} payload
 * @returns {string}
 */
export function signRefreshToken(payload) {
  return jwt.sign(
    { sub: payload.id, type: 'refresh' },
    SECRET(),
    { expiresIn: REFRESH_EXPIRES_IN() }
  );
}

/**
 * Verify and decode a token.
 * @param {string} token
 * @returns {{ sub: string, email?: string, type?: string }}
 */
export function verifyToken(token) {
  return jwt.verify(token, SECRET());
}
