/**
 * Bearer-token authentication middleware for HU Board.
 *
 * Threat model — KJC-TSK-0355:
 *   The board is a localhost dev tool. The "shared dev machine" risk
 *   only kicks in when the server binds beyond loopback (e.g.
 *   `--bind 0.0.0.0` to access from another laptop on LAN). For pure
 *   loopback traffic, the OS already enforces "only the local user
 *   can connect", so a token would be UX friction with zero benefit
 *   (the browser opens `http://localhost:4000` and would stop working
 *   without manual `?token=...` injection on every link).
 *
 * Behaviour:
 *   - When `HU_BOARD_TOKEN` is set AND the request is from a non-
 *     loopback address → require the token in `Authorization: Bearer`
 *     header, `?token=` query param, or `kj_board_token` cookie.
 *   - When the request comes from loopback (127.0.0.1 / ::1 / ::ffff:127.0.0.1)
 *     → skip auth. The browser running on the same machine just works.
 *   - When `HU_BOARD_TOKEN` is unset → skip auth entirely. Tests and
 *     legacy callers keep working.
 */

import { timingSafeEqual } from "node:crypto";

/** Loopback addresses we trust without auth, regardless of token state. */
const LOOPBACK_ADDRESSES = new Set([
  "127.0.0.1",
  "::1",
  "::ffff:127.0.0.1",
]);

/**
 * Returns an Express middleware that enforces token auth for non-
 * loopback requests when HU_BOARD_TOKEN is defined.
 *
 * @returns {import('express').RequestHandler}
 */
export function authMiddleware() {
  return (req, res, next) => {
    const expected = process.env.HU_BOARD_TOKEN;
    if (!expected) return next();

    if (isLoopback(req)) return next();

    const token = extractToken(req);
    if (tokensMatch(token, expected)) return next();

    return res.status(401).json({
      error: "Unauthorized",
      message:
        "HU Board is bound to a non-loopback interface. Pass the token from " +
        "~/.karajan/hu-board/token via Authorization: Bearer <token>, " +
        "?token=<token>, or the kj_board_token cookie.",
    });
  };
}

/**
 * Constant-time comparison of a presented token against the expected one.
 *
 * `===` on strings stops at the first differing byte, so the time it takes to
 * reject a token leaks how much of a correct prefix was supplied. Over the
 * loopback interface that is noise — but this middleware exists precisely for
 * the case the header above describes, where the board is bound beyond
 * loopback and the peer is on the LAN. There the difference is measurable, and
 * the token can be recovered a byte at a time.
 *
 * `timingSafeEqual` throws when the buffers differ in length, so the length is
 * checked first. That is not a leak worth closing: the length of the expected
 * token is fixed by whatever wrote `~/.karajan/hu-board/token`, and a token of
 * the wrong length is wrong regardless of its contents.
 *
 * @param {string|undefined} presented
 * @param {string} expected
 * @returns {boolean}
 */
function tokensMatch(presented, expected) {
  if (typeof presented !== "string") return false;
  const left = Buffer.from(presented, "utf8");
  const right = Buffer.from(expected, "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
}

/**
 * @param {import('express').Request} req
 * @returns {boolean}
 */
function isLoopback(req) {
  // Express populates req.ip from req.socket.remoteAddress unless
  // `trust proxy` is set (we don't, by design — the board never sits
  // behind a proxy in its supported deployment). req.ip is therefore
  // the actual peer address.
  const ip = req.ip || req.socket?.remoteAddress || "";
  return LOOPBACK_ADDRESSES.has(ip);
}

/**
 * @param {import('express').Request} req
 * @returns {string|undefined}
 */
function extractToken(req) {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    return authHeader.slice(7);
  }
  if (req.query && typeof req.query.token === "string") {
    return req.query.token;
  }
  // Cookie parsing: we don't pull cookie-parser as a dep just for one
  // header. Express stores the raw header in req.headers.cookie; the
  // grammar is `name=value; name2=value2`. Good enough for one key.
  const cookieHeader = req.headers.cookie;
  if (cookieHeader) {
    for (const part of cookieHeader.split(";")) {
      const [name, ...rest] = part.trim().split("=");
      if (name === "kj_board_token") return rest.join("=");
    }
  }
  return undefined;
}
