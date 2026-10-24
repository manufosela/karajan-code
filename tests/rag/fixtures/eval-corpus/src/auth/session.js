// Sessions: a signed token per login, verified on every request.
import { createHmac, randomUUID } from "node:crypto";

const SESSION_TTL_MS = 8 * 60 * 60 * 1000;

/** Create a session for a user: id, expiry and the HMAC signature of both. */
export function createSession(userId, secret, now = Date.now()) {
  const id = randomUUID();
  const expiresAt = now + SESSION_TTL_MS;
  return { id, userId, expiresAt, token: signToken(id, expiresAt, secret) };
}

/** True when the token matches the session and it has not expired. */
export function verifyToken(session, token, secret, now = Date.now()) {
  if (now > session.expiresAt) return false;
  return signToken(session.id, session.expiresAt, secret) === token;
}

function signToken(id, expiresAt, secret) {
  return createHmac("sha256", secret).update(`${id}.${expiresAt}`).digest("base64url");
}
