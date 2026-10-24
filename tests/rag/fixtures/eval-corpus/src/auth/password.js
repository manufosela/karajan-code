// Passwords: hashed with scrypt and a per-user salt; never stored or logged in clear.
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const KEY_LENGTH = 64;

/** Hash a password with a fresh salt; the result carries both, colon separated. */
export function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, KEY_LENGTH).toString("hex");
  return `${salt}:${hash}`;
}

/** Constant-time comparison of a password against a stored hash. */
export function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(":");
  const candidate = scryptSync(password, salt, KEY_LENGTH);
  return timingSafeEqual(candidate, Buffer.from(hash, "hex"));
}

/** At least 12 characters with a letter and a digit; the rest is the user's business. */
export function isStrongEnough(password) {
  return password.length >= 12 && /[a-z]/i.test(password) && /\d/.test(password);
}
