// C1 (KJC-TSK-0777, ADR 0007) — corpora health for readers; access (the
// service's invoker binding) for admins, every change sealed in the trail.
// The memory adapter stands in for gcp-cloud-run.
import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { parseConsoleConfig, createConsoleApp, memorySink, memoryAdapter } from "@karajan-family/console";

const config = parseConsoleConfig({
  instance: { name: "atlas", allowedDomains: ["example.com"] },
  auth: { provider: "google" },
  roles: { admins: ["admin@example.com"], readers: ["@example.com"] },
  corpora: [
    { id: "code", name: "Code", adapter: "gcp-cloud-run", project: "p", region: "r", service: "atlas-code" },
    { id: "docs", adapter: "gcp-cloud-run", project: "p", region: "r", service: "atlas-docs" },
  ],
  audit: { sink: "memory" },
});
const verify = async (t) => JSON.parse(t.slice(4));
const as = (email) => `Bearer tok:${JSON.stringify({ email, email_verified: true, hd: "example.com", sub: "1" })}`;
const reader = as("anyone@example.com");
const admin = as("admin@example.com");

let app, gcp;
beforeEach(() => {
  gcp = memoryAdapter();
  app = createConsoleApp({ config, verify, sink: memorySink(), adapters: { "gcp-cloud-run": gcp } });
});

describe("corpora", () => {
  it("GET /api/corpora gives every corpus its health (reader); an adapter failure is reported per corpus, not as a 500", async () => {
    const res = await request(app).get("/api/corpora").set("Authorization", reader);
    expect(res.status).toBe(200);
    expect(res.body.corpora).toEqual([
      { id: "code", name: "Code", adapter: "gcp-cloud-run", ok: true, corpus: "code", fingerprint: "memory", files: 0, chunks: 0 },
      { id: "docs", name: "docs", adapter: "gcp-cloud-run", ok: true, corpus: "docs", fingerprint: "memory", files: 0, chunks: 0 },
    ]);
    gcp.health = async () => { throw new Error("service unreachable"); };
    const down = await request(app).get("/api/corpora").set("Authorization", reader);
    expect(down.status).toBe(200);
    expect(down.body.corpora[0]).toMatchObject({ id: "code", ok: false, error: "service unreachable" });
  });

  it("access: admin only; grant and revoke change the invoker list and are sealed with the principal", async () => {
    expect((await request(app).get("/api/corpora/code/access").set("Authorization", reader)).status).toBe(403);
    const granted = await request(app).post("/api/corpora/code/access").set("Authorization", admin).send({ email: "New@Example.com" });
    expect(granted.status).toBe(200);
    expect(granted.body).toMatchObject({ ok: true, granted: "new@example.com" });
    expect((await request(app).get("/api/corpora/code/access").set("Authorization", admin)).body.members).toEqual(["new@example.com"]);
    const revoked = await request(app).delete("/api/corpora/code/access/new@example.com").set("Authorization", admin);
    expect(revoked.body).toMatchObject({ ok: true, revoked: true });
    const actions = app.console.audit.entries().filter((e) => e.action.startsWith("access."));
    expect(actions.map((e) => [e.action, e.target, e.outcome, e.detail.principal, e.who.email])).toEqual([
      ["access.grant", "corpus:code", "ok", "new@example.com", "admin@example.com"],
      ["access.revoke", "corpus:code", "ok", "new@example.com", "admin@example.com"],
    ]);
  });

  it("an email outside the domain is 400, an unknown corpus 404, a missing capability 503, an adapter failure 502 and sealed as error", async () => {
    expect((await request(app).post("/api/corpora/code/access").set("Authorization", admin).send({ email: "x@other.org" })).status).toBe(400);
    // Revoking an outsider is allowed on purpose: cleaning a stray binding is an admin's job.
    expect((await request(app).delete("/api/corpora/code/access/x@other.org").set("Authorization", admin)).body).toMatchObject({ ok: true, revoked: false });
    expect((await request(app).post("/api/corpora/nope/access").set("Authorization", admin).send({ email: "x@example.com" })).status).toBe(404);
    delete gcp.grant;
    expect((await request(app).post("/api/corpora/code/access").set("Authorization", admin).send({ email: "x@example.com" })).status).toBe(503);
    gcp.grant = async () => { throw new Error("iam denied"); };
    const failed = await request(app).post("/api/corpora/code/access").set("Authorization", admin).send({ email: "x@example.com" });
    expect(failed.status).toBe(502);
    expect(failed.body.error).toBe("iam denied");
    expect(app.console.audit.entries().at(-1)).toMatchObject({ action: "access.grant", outcome: "error", detail: { message: "iam denied" } });
  });
});
