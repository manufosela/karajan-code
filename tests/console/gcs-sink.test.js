// C1.1 (KJC-TSK-0784) — gcs-jsonl sink against a fake bucket: the chain is
// rebuilt from the objects in name order, every append uploads one immutable
// object and waits, a refused upload leaves no phantom entry.
import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { createAudit, parseConsoleConfig, createConsoleApp, memoryAdapter } from "@karajan-family/console";
import { gcsSink } from "../../packages/console/src/sinks/gcs.js";

let objects, failUploads, auth, clock;
const who = { email: "admin@example.com", role: "admin" };
beforeEach(() => {
  objects = new Map();
  failUploads = false;
  clock = 1_000_000;
  auth = {
    request: async ({ url, method, data }) => {
      const u = new URL(url);
      if (method === "GET" && u.pathname === "/storage/v1/b/b1/o") return { data: { items: [...objects.keys()].filter((n) => n.startsWith(u.searchParams.get("prefix"))).map((name) => ({ name })) } };
      if (method === "GET" && u.pathname.startsWith("/storage/v1/b/b1/o/")) return { data: objects.get(decodeURIComponent(u.pathname.slice("/storage/v1/b/b1/o/".length))) };
      if (method === "POST" && u.pathname === "/upload/storage/v1/b/b1/o") {
        if (failUploads) throw new Error("403 storage.objects.create denied");
        objects.set(u.searchParams.get("name"), data);
        return { data: {} };
      }
      throw new Error(`unexpected ${method} ${url}`);
    },
  };
});
const sink = () => gcsSink({ bucket: "b1", auth, now: () => (clock += 1), pid: 42 });

describe("gcs-jsonl sink", () => {
  it("appends one object per entry (ordered names), waits for the upload, and rebuilds the chain from the bucket", async () => {
    const a = createAudit({ sink: sink() });
    await a.record({ who, action: "a", outcome: "ok" });
    await a.record({ who, action: "b", outcome: "ok" });
    expect([...objects.keys()]).toEqual(["audit/00000001000001-000000-42.json", "audit/00000001000002-000001-42.json"]);
    const again = createAudit({ sink: sink() });
    await again.ready();
    expect(again.verify()).toEqual({ ok: true, length: 2 });
    await again.record({ who, action: "c", outcome: "ok" });
    expect(again.entries().map((e) => e.action)).toEqual(["a", "b", "c"]);
    expect(objects.size).toBe(3);
  });

  it("a refused upload rejects the record and leaves no phantom entry; the next record chains correctly", async () => {
    const a = createAudit({ sink: sink() });
    await a.record({ who, action: "a", outcome: "ok" });
    failUploads = true;
    await expect(a.record({ who, action: "b", outcome: "ok" })).rejects.toThrow(/denied/);
    expect(a.entries().map((e) => e.action)).toEqual(["a"]);
    failUploads = false;
    await a.record({ who, action: "c", outcome: "ok" });
    expect(a.verify()).toEqual({ ok: true, length: 2 });
  });

  it("the app waits for the sink to load and a failed seal turns the action into a 502", async () => {
    objects.set("audit/00000000000001-000000-7.json", JSON.stringify({ ts: "t", who, action: "old", outcome: "ok", prev: null }));
    const config = parseConsoleConfig({ instance: { name: "x", allowedDomains: ["example.com"] }, auth: { provider: "google" }, roles: { admins: ["admin@example.com"] }, corpora: [{ id: "code", adapter: "gcp-cloud-run", project: "p", region: "r", service: "s" }], audit: { sink: "gcs-jsonl", bucket: "b1" } });
    const app = createConsoleApp({ config, verify: async (t) => JSON.parse(t), gcpAuth: auth, adapters: { "gcp-cloud-run": memoryAdapter() } });
    const admin = `Bearer ${JSON.stringify({ email: "admin@example.com", email_verified: true, hd: "example.com" })}`;
    const audit = await request(app).get("/api/audit").set("Authorization", admin);
    expect(audit.body.entries.map((e) => e.action)).toEqual(["old"]);
    expect((await request(app).post("/api/corpora/code/access").set("Authorization", admin).send({ email: "x@example.com" })).status).toBe(200);
    expect(objects.size).toBe(2);
    failUploads = true;
    const failed = await request(app).post("/api/corpora/code/access").set("Authorization", admin).send({ email: "y@example.com" });
    expect(failed.status).toBe(502);
    expect(failed.body.error).toMatch(/denied/);
  });
});
