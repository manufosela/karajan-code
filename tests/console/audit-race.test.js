// KJC-BUG-0150 (from tribbu-atlas' field test of 0.1.1 on Cloud Run): with an
// ASYNC sink, concurrent record() calls read the same last line before the
// previous upload has landed, so several entries chain on the same prev and
// the chain verifies as broken. record() must be serialised per process:
// the next entry computes its prev only once the previous one is sealed.
import { describe, it, expect } from "vitest";
import { createAudit } from "@karajan-family/console";
import { gcsSink } from "../../packages/console/src/sinks/gcs.js";

const who = { email: "nobody@example.com", role: null };

function fakeBucket({ failOn = null } = {}) {
  const objects = new Map();
  let uploads = 0;
  const auth = {
    request: async ({ url, method, data }) => {
      const u = new URL(url);
      if (method === "GET" && u.pathname === "/storage/v1/b/b1/o") return { data: { items: [...objects.keys()].map((name) => ({ name })) } };
      if (method === "GET" && u.pathname.startsWith("/storage/v1/b/b1/o/")) return { data: objects.get(decodeURIComponent(u.pathname.slice("/storage/v1/b/b1/o/".length))) };
      if (method === "POST") {
        const attempt = (uploads += 1); // captured BEFORE the delay: deterministic whichever order the network answers in
        await new Promise((resolve) => setTimeout(resolve, 5)); // the network: the upload lands LATER
        if (attempt === failOn) throw new Error("503 upload refused");
        objects.set(u.searchParams.get("name"), data);
        return { data: {} };
      }
      throw new Error(`unexpected ${method} ${url}`);
    },
  };
  let clock = 1_000_000;
  return { objects, sink: gcsSink({ bucket: "b1", auth, now: () => (clock += 1), pid: 15 }) };
}

describe("audit record() under concurrency (KJC-BUG-0150)", () => {
  it("seven denied requests in the same instant produce ONE chain, each prev the hash of the previous entry", async () => {
    const { sink } = fakeBucket();
    const audit = createAudit({ sink });
    await audit.ready();
    await Promise.all(Array.from({ length: 7 }, (_, i) => audit.record({ who, action: "auth", target: `/me#${i}`, outcome: "denied", detail: { code: "no_token" } })));
    const entries = audit.entries();
    expect(entries).toHaveLength(7);
    expect(entries[0].prev).toBeNull();
    expect(entries.slice(1).every((e) => typeof e.prev === "string" && e.prev.length === 64)).toBe(true);
    expect(new Set(entries.map((e) => e.prev)).size).toBe(7); // no two entries chained on the same prev
    expect(audit.verify()).toEqual({ ok: true, length: 7 });
    expect(entries.map((e) => e.target)).toEqual(Array.from({ length: 7 }, (_, i) => `/me#${i}`)); // call order kept
  });

  it("a refused upload in the middle rejects THAT record only; the ones after it chain on the last sealed entry", async () => {
    const { sink } = fakeBucket({ failOn: 2 });
    const audit = createAudit({ sink });
    await audit.ready();
    const results = await Promise.allSettled([1, 2, 3].map((i) => audit.record({ who, action: "auth", target: `/${i}`, outcome: "denied" })));
    expect(results.map((r) => r.status)).toEqual(["fulfilled", "rejected", "fulfilled"]);
    expect(audit.entries().map((e) => e.target)).toEqual(["/1", "/3"]);
    expect(audit.verify()).toEqual({ ok: true, length: 2 });
  });

  // KJC-TSK-0799 (tribbu-atlas, 22-aug): reading the audit right after a burst
  // returned fewer entries while the queue drained — nothing lost, but an
  // audit that LOOKS incomplete is worse than a slow one.
  it("drained() resolves when the in-flight queue is empty, with every burst entry sealed", async () => {
    const { sink } = fakeBucket();
    const audit = createAudit({ sink });
    await audit.ready();
    for (let i = 0; i < 5; i++) void audit.record({ who, action: "auth", target: `/burst#${i}`, outcome: "denied" });
    expect(audit.entries().length).toBeLessThan(5); // the race the field saw
    await audit.drained();
    expect(audit.entries()).toHaveLength(5);
  });

  it("a failing upload never hangs drained() — and the failed entry is not counted as sealed", async () => {
    const { sink } = fakeBucket({ failOn: 2 });
    const audit = createAudit({ sink });
    await audit.ready();
    for (let i = 1; i <= 3; i++) audit.record({ who, action: "auth", target: `/${i}`, outcome: "denied" }).catch(() => undefined);
    await audit.drained();
    expect(audit.entries().map((e) => e.target)).toEqual(["/1", "/3"]);
  });
});
