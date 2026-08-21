// C0 (KJC-TSK-0776, ADR 0007) — the console app: auth + audit + adapters
// wired; status public and minimal; me/config/audit behind roles; every
// refusal JSON and every denied auth attempt sealed in the trail.
import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { parseConsoleConfig, createConsoleApp, memorySink } from "@karajan-family/console";

const config = parseConsoleConfig({
  instance: { name: "atlas", allowedDomains: ["example.com"] },
  auth: { provider: "google" },
  roles: { admins: ["admin@example.com"], readers: ["@example.com"] },
  corpora: [{ id: "code", adapter: "gcp-cloud-run", project: "p", region: "r", service: "s" }],
  operations: [{ id: "sync-docs", adapter: "github-workflow", repo: "org/atlas", workflow: "sync.yml" }],
  secrets: [{ id: "notion", adapter: "github-secret", repo: "org/atlas", name: "NOTION_TOKEN" }],
  audit: { sink: "memory" },
});
const verify = async (t) => { if (!t.startsWith("tok:")) throw new Error("bad"); return JSON.parse(t.slice(4)); };
const tok = (email = "anyone@example.com", hd = "example.com") => `Bearer tok:${JSON.stringify({ email, email_verified: true, hd, sub: "1" })}`;

let app, sink;
beforeEach(() => { sink = memorySink(); app = createConsoleApp({ config, verify, sink }); });

describe("console app (C0)", () => {
  it("status is public and minimal, and says which adapters this build lacks", async () => {
    const res = await request(app).get("/api/status");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, instance: "atlas", adapters: { registered: ["memory"] } });
    expect(res.body.adapters.missing.sort()).toEqual(["gcp-cloud-run", "github-secret", "github-workflow"]);
    expect(res.headers["x-powered-by"]).toBeUndefined();
  });

  it("me needs a reader; config is the public view (secret NAMES never leave); audit is admin-only and verifies the chain", async () => {
    expect((await request(app).get("/api/me").set("Authorization", tok())).body.identity).toMatchObject({ email: "anyone@example.com", role: "reader" });
    const cfg = (await request(app).get("/api/config").set("Authorization", tok())).body;
    expect(cfg.corpora[0]).toEqual({ id: "code", name: "code", adapter: "gcp-cloud-run", available: false });
    expect(cfg.secrets).toEqual({ count: 1 }); // a reader learns how many, not which
    expect(JSON.stringify(cfg)).not.toContain("notion");
    const adminCfg = (await request(app).get("/api/config").set("Authorization", tok("admin@example.com"))).body;
    expect(adminCfg.secrets).toEqual([{ id: "notion", adapter: "github-secret" }]);
    expect(JSON.stringify(adminCfg)).not.toContain("NOTION_TOKEN"); // handles yes, secret NAMES never
    expect((await request(app).get("/api/audit").set("Authorization", tok())).status).toBe(403);
    const audit = (await request(app).get("/api/audit").set("Authorization", tok("admin@example.com"))).body;
    expect(audit.chain.ok).toBe(true);
    expect(audit.entries.at(-1)).toMatchObject({ action: "auth", outcome: "denied", detail: { code: "forbidden" } });
  });

  it("denied auth attempts are sealed with what the token claimed, unknown api routes are JSON 404", async () => {
    expect((await request(app).get("/api/me")).status).toBe(401);
    expect((await request(app).get("/api/me").set("Authorization", tok("x@other.org", "other.org"))).status).toBe(403);
    const entries = app.console.audit.entries();
    expect(entries.map((e) => e.detail.code)).toEqual(["no_token", "domain"]);
    expect(entries[0].who.email).toBe("anonymous");
    expect(entries[1].who.email).toBe("x@other.org");
    const nope = await request(app).get("/api/nope").set("Authorization", tok());
    expect(nope.status).toBe(404);
    expect(nope.body).toEqual({ ok: false, error: "no such endpoint" });
  });

  it("the memory adapter serves tests: health, grant/revoke, dispatch", async () => {
    const m = app.console.registry.demand("memory", "grant");
    const corpus = config.corpora[0];
    await m.grant(corpus, "x@example.com");
    expect(await m.listAccess(corpus)).toEqual(["x@example.com"]);
    expect((await m.revoke(corpus, "x@example.com")).revoked).toBe(true);
    expect((await m.dispatch(config.operations[0], { ref: "main" })).runRef).toBe("memory:1");
    expect(() => app.console.registry.demand("memory", "secretWrite")).toThrow(/no capability/);
    expect(() => app.console.registry.demand("gcp-cloud-run", "health")).toThrow(/not registered/);
  });
});
