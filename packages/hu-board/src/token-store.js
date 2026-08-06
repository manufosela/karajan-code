/**
 * Token persistence for HU Board (KJC-TSK-0355).
 *
 * Stored at `~/.karajan/hu-board/token` (or `$KJ_HOME/hu-board/token`)
 * with mode 0600 — single-line, hex-encoded, 32 bytes of randomness.
 * Idempotent: read existing token if file exists, otherwise generate
 * + persist a new one.
 *
 * The token is ONLY enforced when the server binds to a non-loopback
 * interface. See `auth.js` for the full threat model.
 */

import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, chmodSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";

const TOKEN_BYTES = 32;

/**
 * Compute the on-disk token path. Delegates to db.js::getKjHome which
 * (post-KJC-TSK-0420) honours KARAJAN_HOME > KJ_HOME > VITEST > default.
 * @returns {string}
 */
import { getKjHome } from "./db.js";
export function getTokenPath() {
  return join(getKjHome(), "hu-board", "token");
}

/**
 * Read the persisted token if it exists; otherwise generate a fresh
 * one, write it (mode 0600), and return it. Returns `null` only if
 * the filesystem operation itself fails (caller decides whether that
 * disables auth or aborts startup).
 *
 * @returns {string|null}
 */
export function getOrCreateToken() {
  const tokenPath = getTokenPath();
  try {
    if (existsSync(tokenPath)) {
      const raw = readFileSync(tokenPath, "utf8").trim();
      if (raw.length >= 16) return raw;
      // Corrupt or empty file — overwrite below.
    }
    const token = randomBytes(TOKEN_BYTES).toString("hex");
    mkdirSync(dirname(tokenPath), { recursive: true });
    writeFileSync(tokenPath, token, { mode: 0o600 });
    try { chmodSync(tokenPath, 0o600); } catch { /* best-effort on Windows */ }
    return token;
  } catch (err) {
    // Don't crash the board over this — just disable auth and let the
    // caller log a warning.
    console.warn(`[token-store] failed to manage token file at ${tokenPath}: ${err.message}`);
    return null;
  }
}
