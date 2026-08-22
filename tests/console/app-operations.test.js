// C2 (KJC-TSK-0778, ADR 0007) — operations over the console: listed for readers,
// dispatched only by the roles the operation names, every dispatch sealed with
// its inputs; runs read by their ref through the adapter the ref belongs to.
import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { parseConsoleConfig, createConsoleApp, memorySink } from "@karajan-family/console";

const config = parseConsoleConfig({
  instance: { name: "atlas", allowedDomains: ["example.com"] },
  auth: { provider: "google" },
  roles: { admins: ["admin@example.com"], operators: ["ops@example.com"], readers: ["@example.com"] },
  operations: [
    { id: "sync-docs", adapter: "github-workflow", repo: "org/atlas", workflow: "sync.yml" },
    { id: "rotate", adapter: "github-workflow", repo: "org/atlas", workflow: "rotate.yml", roles: ["admin"] },
  ],
  github: { appId: 1, installationId: 2 },
  audit: { sink: "memory" },
});
const verify = async (t) => { if (!t.startsWith("tok:")) throw new Error("bad"); return JSON.parse(t.slice(4)); };
const tok = (email) => `Bearer tok:${JSON.stringify({ email, email_verified: true, hd: "example.com", sub: "1" })}`;
const github = {
  name: "github-workflow",
  calls: [],
  dispatch: async (op, inputs) => { github.calls.push({ op: op.id, inputs }); return { runRef: `github:${op.repo}:777`, url: "https://github.com/org/atlas/actions/runs/777", status: "queued" }; },
  runStatus: async (ref) => ({ runRef: ref, status: "completed", conclusion: "success" }),
  runLog: async (ref) => `log of ${ref}`,
};
let app, sink;
beforeEach(() => { sink = memorySink(); github.calls = []; app = createConsoleApp({ config, verify, sink, adapters: { "github-workflow": github } }); });

describe("console operations (C2)", () => {
  it("readers list operations but cannot dispatch; an operator dispatches with inputs and the trail seals them", async () => {
    const list = (await request(app).get("/api/operations").set("Authorization", tok("anyone@example.com"))).body;
    expect(list.operations).toEqual([
      { id: "sync-docs", adapter: "github-workflow", repo: "org/atlas", workflow: "sync.yml", ref: "main", roles: ["operator"], available: true },
      { id: "rotate", adapter: "github-workflow", repo: "org/atlas", workflow: "rotate.yml", ref: "main", roles: ["admin"], available: true },
    ]);
    expect((await request(app).post("/api/operations/sync-docs/dispatch").set("Authorization", tok("anyone@example.com")).send({})).status).toBe(403);
    const res = await request(app).post("/api/operations/sync-docs/dispatch").set("Authorization", tok("ops@example.com")).send({ inputs: { corpus: "docs" } });
    expect(res.body).toMatchObject({ ok: true, runRef: "github:org/atlas:777", status: "queued" });
    expect(github.calls).toEqual([{ op: "sync-docs", inputs: { corpus: "docs" } }]);
    const sealed = app.console.audit.entries().at(-1);
    expect(sealed).toMatchObject({ who: { email: "ops@example.com", role: "operator" }, action: "operation.dispatch", target: "operation:sync-docs", outcome: "ok", detail: { inputs: { corpus: "docs" } } });
  });

  it("the operation's roles rule (admin qualifies by rank); malformed or secret-looking inputs never reach the adapter", async () => {
    const ops = tok("ops@example.com");
    const denied = await request(app).post("/api/operations/rotate/dispatch").set("Authorization", ops).send({});
    expect(denied.status).toBe(403);
    expect(app.console.audit.entries().at(-1)).toMatchObject({ who: { email: "ops@example.com" }, action: "auth", outcome: "denied" });
    expect((await request(app).post("/api/operations/rotate/dispatch").set("Authorization", tok("admin@example.com")).send({})).body.ok).toBe(true);
    expect((await request(app).post("/api/operations/sync-docs/dispatch").set("Authorization", ops).send({ inputs: ["x"] })).status).toBe(400);
    expect((await request(app).post("/api/operations/sync-docs/dispatch").set("Authorization", ops).send({ inputs: { n: 1 } })).status).toBe(400);
    const leak = await request(app).post("/api/operations/sync-docs/dispatch").set("Authorization", ops).send({ inputs: { token: "ghp_x" } });
    expect(leak.status).toBe(400);
    expect(leak.body.error).toMatch(/looks like a secret/);
    expect(github.calls.map((c) => c.op)).toEqual(["rotate"]); // the secret-looking input never reached the adapter
    expect((await request(app).post("/api/operations/nope/dispatch").set("Authorization", ops).send({})).status).toBe(404);
  });

  it("runs are read through the adapter the ref belongs to; foreign refs are refused", async () => {
    const reader = tok("anyone@example.com");
    const ref = encodeURIComponent("github:org/atlas:777");
    expect((await request(app).get(`/api/runs/${ref}`).set("Authorization", reader)).body).toMatchObject({ ok: true, status: "completed", conclusion: "success" });
    expect((await request(app).get(`/api/runs/${ref}/log`).set("Authorization", reader)).body).toEqual({ ok: true, runRef: "github:org/atlas:777", log: "log of github:org/atlas:777" });
    expect((await request(app).get("/api/runs/memory%3A1").set("Authorization", reader)).body).toMatchObject({ ok: true, status: "completed" });
    expect((await request(app).get("/api/runs/jenkins%3A1").set("Authorization", reader)).status).toBe(400);
  });
});
