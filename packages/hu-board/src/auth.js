/**
 * Optional Bearer-token authentication middleware for HU Board.
 *
 * When the `HU_BOARD_TOKEN` env var is set, every request that reaches this
 * middleware must carry the same token either as:
 *   - `Authorization: Bearer <token>` header, or
 *   - `?token=<token>` query parameter.
 *
 * When the env var is **not** set the middleware is a no-op, preserving full
 * backward compatibility.
 */

/**
 * Returns an Express middleware that enforces token auth when HU_BOARD_TOKEN
 * is defined.
 *
 * @returns {import('express').RequestHandler}
 */
export function authMiddleware() {
  return (req, res, next) => {
    const expected = process.env.HU_BOARD_TOKEN;

    // No token configured -> skip auth entirely (backward compatible)
    if (!expected) return next();

    const token = extractToken(req);

    if (token === expected) return next();

    return res.status(401).json({
      error: 'Unauthorized',
      message:
        'Set HU_BOARD_TOKEN env var and pass token in Authorization header or ?token= query',
    });
  };
}

/**
 * Extracts a bearer token from the Authorization header or the `token` query
 * parameter.
 *
 * @param {import('express').Request} req
 * @returns {string|undefined}
 */
function extractToken(req) {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7);
  }
  if (req.query && req.query.token) {
    return req.query.token;
  }
  return undefined;
}
