// C0 (KJC-TSK-0776, ADR 0007) — every console action leaves a hash-chained
// entry (who, action, target, outcome) on the same kernel kj uses for policy
// decisions; secrets never land in it; sinks are the only I/O.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createAudit, memorySink, fileSink, sinkFromConfig } from "@karajan-family/console";

const who = { email: "admin@example.com", role: "admin" };

describe("audit trail", () => {
  it("records chained entries and verifies them; a tampered line breaks the chain verifiably", () => {
    const audit = createAudit({ sink: memorySink() });
    audit.record({ who, action: "access.grant", target: "corpus:code", outcome: "ok", detail: { principal: "x@example.com" } });
    audit.record({ who, action: "operation.dispatch", target: "op:sync-docs", outcome: "denied" });
    expect(audit.verify()).toEqual({ ok: true, length: 2 });
    const [a, b] = audit.entries();
    expect(a).toMatchObject({ who, action: "access.grant", target: "corpus:code", outcome: "ok", prev: null });
    expect(b.prev).toHaveLength(64);
    const lines = audit.sink.lines();
    const broken = memorySink();
    broken.append(lines[0].replace('"ok"', '"denied"'));
    broken.append(lines[1]);
    expect(createAudit({ sink: broken }).verify()).toMatchObject({ ok: false, at: 1 });
  });

  it("the file sink persists and chains across instances (lastLine read from disk)", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-console-audit-"));
    const file = path.join(dir, "audit", "console.jsonl");
    createAudit({ sink: fileSink(file) }).record({ who, action: "a", outcome: "ok" });
    const second = createAudit({ sink: fileSink(file) });
    second.record({ who, action: "b", outcome: "ok" });
    expect(second.verify()).toEqual({ ok: true, length: 2 });
    expect(second.entries()[1].prev).toHaveLength(64);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("wrap seals ok / denied / error and re-throws; the secret-looking detail is refused loudly", async () => {
    const audit = createAudit({ sink: memorySink() });
    await expect(audit.wrap({ who, action: "x", target: "t" }, async () => ({ done: true, audit: { version: 3 } }))).resolves.toEqual({ done: true, audit: { version: 3 } });
    await expect(audit.wrap({ who, action: "x" }, async () => { throw Object.assign(new Error("nope"), { status: 403 }); })).rejects.toThrow("nope");
    await expect(audit.wrap({ who, action: "x" }, async () => { throw new Error("boom"); })).rejects.toThrow("boom");
    expect(audit.entries().map((e) => e.outcome)).toEqual(["ok", "denied", "error"]);
    expect(audit.entries()[0].detail).toEqual({ version: 3 });
    expect(() => audit.record({ who, action: "secret.write", outcome: "ok", detail: { id: "notion", token: "abc" } })).toThrow(/never stores secrets/);
    expect(() => audit.record({ who, action: "x", outcome: "ok", detail: { nested: { value: "v" } } })).toThrow(/nested\.value/);
    expect(() => audit.record({ who: {}, action: "x", outcome: "ok" })).toThrow(/required/);
  });

  it("sinkFromConfig: memory and file are available; gcs-jsonl needs the console's Google auth", () => {
    expect(sinkFromConfig({ sink: "memory" }).kind).toBe("memory");
    expect(sinkFromConfig({ sink: "file", path: "/tmp/x.jsonl" }).kind).toBe("file");
    expect(() => sinkFromConfig({ sink: "gcs-jsonl", bucket: "b" })).toThrow(/auth\.request/);
    expect(sinkFromConfig({ sink: "gcs-jsonl", bucket: "b" }, { auth: { request: async () => ({ data: {} }) } }).kind).toBe("gcs-jsonl");
    expect(() => createAudit({ sink: {} })).toThrow(/sink/);
  });
});
