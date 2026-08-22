// C0 (KJC-TSK-0776, ADR 0007) — who is calling, verified ON THE SERVER. The
// verifier is injected (Google in production, a stub in tests): the console
// never trusts a claim it did not verify, and a Workspace identity is only
// accepted when its `hd` claim is one of the instance's allowed domains.
import { resolveRole } from "./config.js";

/** Where IAP puts its signed assertion. Declared here so this module stays free of Google's library. */
export const IAP_HEADER = "x-goog-iap-jwt-assertion";

export const ROLE_RANK = { reader: 1, operator: 2, admin: 3 };

export class AuthError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = "AuthError";
    this.status = status;
    this.code = code;
  }
}

/**
 * @param {{config: object, verify: (token: string) => Promise<object>}} deps
 *   verify resolves the ID token's payload ({email, email_verified, hd, aud, sub}) or throws.
 */
export function createAuth({ config, verify }) {
  if (typeof verify !== "function") throw new TypeError("createAuth: verify(token) is required — the console never guesses who is calling");
  const domains = new Set(config.instance.allowedDomains.map((d) => d.toLowerCase()));
  // Where the token travels, and what the provider guarantees, depend on the provider:
  // Google Sign-In sends an ID token as a Bearer and states email_verified; IAP puts its own
  // assertion in a header and does not — the account was authenticated by Google before reaching us.
  const behindIap = config.auth.provider === "iap";

  async function authenticate(token) {
    if (!token) throw new AuthError(401, "no_token", "sign in with a Google account of the instance's domain");
    let p;
    try { p = await verify(token); } catch (err) { throw new AuthError(401, "invalid_token", `token rejected: ${err?.message || err}`); }
    // From here on the claimed email travels with every refusal: the audit trail records WHO was refused.
    const email = String(p?.email || "").toLowerCase();
    const deny = (status, code, message) => Object.assign(new AuthError(status, code, message), email ? { email } : {});
    if (!p) throw deny(401, "invalid_token", "the verified token carried no payload");
    if (!behindIap && p.email_verified !== true) throw deny(403, "unverified_email", "the Google account email is not verified");
    // With IAP the audience was already enforced by the verifier (it cannot verify without it).
    if (!behindIap && config.auth.audience && p.aud !== config.auth.audience) throw deny(401, "wrong_audience", "token issued for another application");
    // `hd` is only present on Google Workspace accounts: no hd = no organisation = no entry.
    const hd = String(p.hd || "").toLowerCase();
    if (!hd || !domains.has(hd)) throw deny(403, "domain", `account outside the allowed domains (${[...domains].join(", ")})`);
    if (!email.endsWith(`@${hd}`)) throw deny(403, "domain", "email and hd claims disagree");
    const role = resolveRole(config, email);
    if (!role) throw deny(403, "no_role", `${email} has no role in console.config.json`);
    return { email, role, sub: p.sub ?? null, hd };
  }

  /** express middleware: Bearer token → req.identity, or the AuthError as JSON. */
  const requireRole = (minimum = "reader") => {
    // An unknown role name must fail CLOSED at wiring time, never open at request time (review catch).
    if (!Object.hasOwn(ROLE_RANK, minimum)) throw new TypeError(`requireRole: unknown role "${minimum}" (reader | operator | admin)`);
    return async (req, res, next) => {
    const token = behindIap ? (req.get?.(IAP_HEADER) || "").trim() : (/^Bearer\s+(.+)$/i.exec(req.get?.("authorization") || "")?.[1] ?? "").trim();
    try {
      const identity = await authenticate(token);
      if (ROLE_RANK[identity.role] < ROLE_RANK[minimum]) throw new AuthError(403, "forbidden", `${identity.role} cannot do what needs ${minimum}`);
      req.identity = identity;
      next();
    } catch (err) {
      if (!(err instanceof AuthError)) return next(err);
      res.status(err.status).json({ ok: false, error: err.message, code: err.code, ...(err.email ? { email: err.email } : {}) });
    }
    };
  };

  return { authenticate, requireRole };
}
