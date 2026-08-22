// C0 (KJC-TSK-0776, ADR 0007) — auth verified on the server: the verifier is
// injected, the `hd` claim must be an allowed domain, the role comes from git.
import { describe, it, expect } from "vitest";
import express from "express";
import request from "supertest";
import { parseConsoleConfig, createAuth, AuthError, IAP_HEADER } from "@karajan-family/console";

const config = parseConsoleConfig({
  instance: { name: "atlas", allowedDomains: ["example.com"] },
  auth: { provider: "google", audience: "client-id" },
  roles: { admins: ["admin@example.com"], readers: ["@example.com"] },
  audit: { sink: "memory" },
});
const payload = (over = {}) => ({ email: "anyone@example.com", email_verified: true, hd: "example.com", aud: "client-id", sub: "123", ...over });
// The stub verifier maps a token string to a payload: "tok:<json>"; anything else is rejected.
const verify = async (token) => {
  if (!token.startsWith("tok:")) throw new Error("bad signature");
  return JSON.parse(token.slice(4));
};
const tok = (over) => `tok:${JSON.stringify(payload(over))}`;
const auth = createAuth({ config, verify });
const fail = (p) => auth.authenticate(p).then(() => { throw new Error("should have failed"); }, (e) => { expect(e).toBeInstanceOf(AuthError); return e; });

describe("authenticate", () => {
  it("a verified Workspace account of an allowed domain gets its role from the config", async () => {
    expect(await auth.authenticate(tok())).toEqual({ email: "anyone@example.com", role: "reader", sub: "123", hd: "example.com" });
    expect((await auth.authenticate(tok({ email: "Admin@Example.com" }))).role).toBe("admin");
  });

  it("no token 401, bad token 401, wrong audience 401", async () => {
    expect((await fail("")).code).toBe("no_token");
    expect((await fail("garbage")).code).toBe("invalid_token");
    expect((await fail(tok({ aud: "other" }))).code).toBe("wrong_audience");
  });

  it("unverified email, missing or foreign hd, hd/email mismatch and no role are 403 — each named", async () => {
    expect((await fail(tok({ email_verified: false }))).code).toBe("unverified_email");
    expect((await fail(tok({ hd: undefined }))).code).toBe("domain"); // gmail account, no organisation
    expect((await fail(tok({ hd: "other.org", email: "x@other.org" }))).code).toBe("domain");
    const disagree = await fail(tok({ email: "x@other.org" })); // claims disagree
    expect(disagree.code).toBe("domain");
    expect(disagree.email).toBe("x@other.org"); // the refusal carries WHO was refused, for the audit trail
    const strict = createAuth({ config: parseConsoleConfig({ ...config, roles: { admins: ["admin@example.com"] } }), verify });
    await expect(strict.authenticate(tok())).rejects.toMatchObject({ status: 403, code: "no_role" });
  });

  it("createAuth without a verifier refuses to exist", () => {
    expect(() => createAuth({ config })).toThrow(/verify/);
  });
});

describe("requireRole middleware", () => {
  const app = express();
  app.get("/me", auth.requireRole("reader"), (req, res) => res.json({ ok: true, identity: req.identity }));
  app.get("/admin", auth.requireRole("admin"), (_req, res) => res.json({ ok: true }));

  it("sets req.identity for a valid bearer; returns the AuthError as JSON otherwise", async () => {
    const ok = await request(app).get("/me").set("Authorization", `Bearer ${tok()}`);
    expect(ok.status).toBe(200);
    expect(ok.body.identity).toMatchObject({ email: "anyone@example.com", role: "reader" });
    const none = await request(app).get("/me");
    expect(none.status).toBe(401);
    expect(none.body).toMatchObject({ ok: false, code: "no_token" });
  });

  it("rank is enforced: a reader asking for admin is 403 forbidden; an admin passes; an unknown role name fails closed at wiring", async () => {
    expect((await request(app).get("/admin").set("Authorization", `Bearer ${tok()}`)).body.code).toBe("forbidden");
    expect((await request(app).get("/admin").set("Authorization", `Bearer ${tok({ email: "admin@example.com" })}`)).status).toBe(200);
    expect(() => auth.requireRole("superuser")).toThrow(/unknown role/);
  });
});

// C1-IAP (KJC-TSK-0798): behind IAP the token travels in IAP's header, not as a Bearer, and IAP
// does not emit email_verified — but the domain and the role are still decided HERE, not by IAP.
describe("behind Identity-Aware Proxy", () => {
  const iapConfig = parseConsoleConfig({
    instance: { name: "atlas", allowedDomains: ["example.com"] },
    auth: { provider: "iap", audience: "/projects/123/locations/europe-west1/services/atlas-console" },
    roles: { admins: ["admin@example.com"], readers: ["@example.com"] },
    audit: { sink: "memory" },
  });
  const iapAuth = createAuth({ config: iapConfig, verify });
  const assertion = (over) => `tok:${JSON.stringify({ email: "anyone@example.com", hd: "example.com", sub: "1", ...over })}`;
  const app = express();
  app.get("/me", iapAuth.requireRole("reader"), (req, res) => res.json({ ok: true, identity: req.identity }));

  it("takes the assertion from IAP's header and accepts it without email_verified", async () => {
    const ok = await request(app).get("/me").set(IAP_HEADER, assertion());
    expect(ok.status).toBe(200);
    expect(ok.body.identity).toMatchObject({ email: "anyone@example.com", role: "reader", hd: "example.com" });
  });

  it("a Bearer is NOT accepted behind IAP, and no header at all is no_token", async () => {
    expect((await request(app).get("/me").set("Authorization", `Bearer ${assertion()}`)).body.code).toBe("no_token");
    expect((await request(app).get("/me")).body.code).toBe("no_token");
  });

  it("the domain is still checked here: IAP letting someone through does not grant entry", async () => {
    expect((await request(app).get("/me").set(IAP_HEADER, assertion({ email: "someone@other.org", hd: "other.org" }))).body.code).toBe("domain");
    expect((await request(app).get("/me").set(IAP_HEADER, assertion({ email: "nobody@example.com", hd: "example.com" }))).status).toBe(200);
    const noRole = parseConsoleConfig({ ...JSON.parse(JSON.stringify(iapConfig)), roles: { admins: ["admin@example.com"] } });
    const strict = createAuth({ config: noRole, verify });
    await expect(strict.authenticate(assertion())).rejects.toMatchObject({ code: "no_role" });
  });
});
