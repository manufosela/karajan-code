/**
 * Sonar token bootstrap (KJC-TSK-0367).
 *
 * On `kj init`, after the SonarQube container is up, try to generate the
 * analysis token via the REST API instead of asking the user to walk
 * through the web UI manually. The bootstrapper:
 *
 *   1. Probes the host with admin/admin (the container default).
 *   2. If login succeeds AND the password is still default, it rotates
 *      the password to a freshly generated value and persists that to
 *      `~/.karajan/sonar.admin-password` (mode 0600). This avoids
 *      leaving the deployment with the well-known default credentials.
 *   3. Generates a Global Analysis Token named `karajan-cli` via
 *      `POST /api/user_tokens/generate` and returns it.
 *   4. Persists the token to `~/.karajan/sonar.token` (mode 0600). The
 *      caller writes it into `config.sonarqube.token` separately.
 *
 * On any HTTP error, we return `{ ok: false, reason }` and let the
 * caller fall back to the manual-flow instructions that existed before
 * this card. We never throw — the wizard must keep going.
 */

import { writeFileSync, chmodSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { randomBytes } from "node:crypto";
import { getKarajanHome } from "../utils/paths.js";
import path from "node:path";

const DEFAULT_USER = "admin";
const DEFAULT_PASS = "admin";
const TOKEN_NAME = "karajan-cli";

/**
 * @param {string} host        e.g. http://localhost:9000
 * @param {string} pathname    "/api/..."
 * @param {object} opts
 * @param {"GET"|"POST"} [opts.method="GET"]
 * @param {Record<string,string>} [opts.form]   form-urlencoded body
 * @param {string} opts.user
 * @param {string} opts.pass
 * @returns {Promise<{ status: number, body: any }>}
 */
async function call(host, pathname, opts) {
  const url = host.replace(/\/$/, "") + pathname;
  const headers = {
    Authorization: "Basic " + Buffer.from(`${opts.user}:${opts.pass}`).toString("base64"),
  };
  let body;
  if (opts.method === "POST" && opts.form) {
    headers["Content-Type"] = "application/x-www-form-urlencoded";
    body = new URLSearchParams(opts.form).toString();
  }
  const res = await fetch(url, { method: opts.method || "GET", headers, body });
  let parsed = null;
  const text = await res.text();
  if (text) {
    try { parsed = JSON.parse(text); } catch { parsed = text; }
  }
  return { status: res.status, body: parsed };
}

/**
 * Generate a strong (32-byte hex) random password. We never re-use the
 * default `admin` password and never persist `admin` to disk.
 */
function generatePassword() {
  return randomBytes(24).toString("base64url");
}

/**
 * Persist a value at `~/.karajan/<filename>` with mode 0600.
 */
function persistSecret(filename, value) {
  const home = getKarajanHome();
  const target = path.join(home, filename);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, value, { mode: 0o600 });
  try { chmodSync(target, 0o600); } catch { /* best-effort on Windows */ }
  return target;
}

/**
 * Bootstrap the Sonar analysis token. Idempotent: if the
 * `karajan-cli` token already exists Sonar will refuse to create it
 * again (HTTP 400 with `"errors":[{"msg":"A user token...exists"}]`).
 * In that case we delete-and-recreate so kj init always returns a
 * usable token.
 *
 * @param {object} opts
 * @param {string} opts.host           Default http://localhost:9000
 * @returns {Promise<{
 *   ok: boolean,
 *   token?: string,
 *   savedTo?: string,
 *   passwordRotated?: boolean,
 *   passwordSavedTo?: string,
 *   reason?: string,
 * }>}
 */
export async function bootstrapSonarToken({ host = "http://localhost:9000" } = {}) {
  let user = DEFAULT_USER;
  let pass = DEFAULT_PASS;
  let passwordRotated = false;
  let passwordSavedTo = null;
  // KJC-BUG-0035: capture rotation failures so the caller can log them
  // instead of swallowing the error silently. Pre-fix the rotation
  // returned status 403/500/network were ignored and the user never knew.
  let passwordRotationError = null;

  // 1) Probe: does admin/admin still work?
  const probe = await call(host, "/api/authentication/validate", { user, pass }).catch((err) => ({ status: 0, body: err.message }));
  if (probe.status === 0) {
    return { ok: false, reason: `network error reaching ${host}: ${probe.body}` };
  }
  if (probe.status === 401 || (probe.body && probe.body.valid === false)) {
    return { ok: false, reason: "admin/admin login failed (password may already be customized — set sonarqube.token manually)" };
  }

  // 2) Rotate the default password if it's still in place. This stops
  //    the well-known credentials from being a stable attack surface
  //    on this user's machine.
  const newPass = generatePassword();
  const change = await call(host, "/api/users/change_password", {
    method: "POST",
    user,
    pass,
    form: { login: user, previousPassword: pass, password: newPass },
  }).catch((err) => ({ status: 0, body: err.message }));

  if (change.status === 204 || change.status === 200) {
    pass = newPass;
    passwordRotated = true;
    passwordSavedTo = persistSecret("sonar.admin-password", pass);
  } else if (change.status === 400 && Array.isArray(change.body?.errors)
              && change.body.errors.some(e => /default/i.test(e.msg))) {
    // Sonar complained the password matches a default — rare. Try with
    // a longer one.
    const longerPass = generatePassword() + generatePassword();
    const retry = await call(host, "/api/users/change_password", {
      method: "POST",
      user,
      pass,
      form: { login: user, previousPassword: pass, password: longerPass },
    }).catch(() => ({ status: 0 }));
    if (retry.status === 204 || retry.status === 200) {
      pass = longerPass;
      passwordRotated = true;
      passwordSavedTo = persistSecret("sonar.admin-password", pass);
    } else {
      passwordRotationError = `rotate-retry HTTP ${retry.status}: ${detailFromBody(retry.body)}`;
    }
  } else if (change.status === 401) {
    // Expected: admin already changed password — not a failure.
  } else if (change.status !== 0) {
    // KJC-BUG-0035: ANY other non-success status (403, 500, 400-without-default, …)
    // means the rotation didn't happen and admin/admin is still live on disk.
    // Surface it via the result so the caller can warn the user.
    passwordRotationError = `rotate HTTP ${change.status}: ${detailFromBody(change.body)}`;
  } else {
    // status === 0: network error before getting any HTTP response.
    passwordRotationError = `rotate network error: ${detailFromBody(change.body)}`;
  }

  // 3) Token already exists? Revoke it so we can re-create cleanly.
  await call(host, "/api/user_tokens/revoke", {
    method: "POST",
    user,
    pass,
    form: { name: TOKEN_NAME },
  }).catch(() => { /* token may not exist — that's fine */ });

  // 4) Generate the analysis token.
  const gen = await call(host, "/api/user_tokens/generate", {
    method: "POST",
    user,
    pass,
    form: { name: TOKEN_NAME, type: "GLOBAL_ANALYSIS_TOKEN" },
  }).catch((err) => ({ status: 0, body: err.message }));

  if (gen.status !== 200 || !gen.body?.token) {
    const detail = gen.body?.errors?.[0]?.msg || gen.body || `HTTP ${gen.status}`;
    return { ok: false, reason: `token generation failed: ${detail}`, passwordRotated, passwordSavedTo };
  }

  const token = gen.body.token;
  const savedTo = persistSecret("sonar.token", token);

  return {
    ok: true,
    token,
    savedTo,
    passwordRotated,
    passwordSavedTo: passwordRotated ? passwordSavedTo : null,
    passwordRotationError,
  };
}

function detailFromBody(body) {
  if (!body) return "no body";
  if (typeof body === "string") return body.slice(0, 200);
  if (Array.isArray(body.errors)) {
    return body.errors.map(e => e?.msg || JSON.stringify(e)).join("; ").slice(0, 200);
  }
  try { return JSON.stringify(body).slice(0, 200); } catch { return "(unserialisable)"; }
}
