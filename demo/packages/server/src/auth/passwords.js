import bcrypt from 'bcrypt';

const SALT_ROUNDS = 12;

/**
 * Hash a plaintext password.
 * @param {string} password
 * @returns {Promise<string>}
 */
export function hashPassword(password) {
  return bcrypt.hash(password, SALT_ROUNDS);
}

/**
 * Compare a plaintext password against a hash.
 * @param {string} password
 * @param {string} hash
 * @returns {Promise<boolean>}
 */
export function comparePassword(password, hash) {
  return bcrypt.compare(password, hash);
}
