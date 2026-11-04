// HU-3364 — `kj doctor` and the Steward report an embedder over its CPU budget and name the indexer behind it.
import { describe, it, expect, vi } from "vitest";
import { basename } from "node:path";
import { probeEmbedderLoad, evaluateEmbedderLoad, getEmbedderLoadChecks } from "../../src/checks/embedder-load.js";

const ON = { rag: { preload: { enabled: true } } };
const ok = (stdout = "") => ({ exitCode: 0, stdout, stderr: "" });
const PS = "  4242 12:03 node /x/bin/kj.js rag index --with-sources\n  4300 05:00 vim notes.md\n  abc 01:00 kj rag index\n";

// A fake machine: docker stats answers `cpu` in order, docker inspect the NanoCpus, ps the table, lsof a cwd.
function machine({ cpu = ["212.5%", "230.0%"], nano = "0", ps = PS, docker = ok } = {}) {
  const calls = [];
  const samples = [...cpu];
  const run = vi.fn(async (cmd, args) => {
    calls.push([basename(cmd), ...args]);
    if (basename(cmd) === "docker" && args[0] === "stats") return docker === ok ? ok(`${samples.shift() ?? samples[0]}\n`) : docker(args);
    if (basename(cmd) === "docker") return docker === ok ? ok(`${nano}\n`) : docker(args);
    if (basename(cmd) === "ps") return ok(ps);
    return ok("p4242\nfcwd\nn/work/proj\n");
  });
  return { run, calls, sleep: vi.fn(async () => {}), cores: 4, readCwd: () => null, lease: () => ({ pid: 4242, running: true }) };
}
const probe = (io, config = ON) => probeEmbedderLoad(config, io);

describe("embedder-load probe", () => {
  it("does nothing when the embedder is external, RAG is off, or the provider is not ollama", async () => {
    for (const cfg of [{ rag: { preload: { enabled: true }, embedder: { external: true } } }, {}, { rag: { preload: { enabled: true }, embedder: { provider: "x" } } }]) {
      const m = machine();
      expect((await probe(m, cfg)).state).toBe("skipped");
      expect(m.run).not.toHaveBeenCalled();
    }
  });

  it("says so when Docker is missing, the daemon is down or the container is not there", async () => {
    for (const stderr of ["spawn docker ENOENT", "Cannot connect to the Docker daemon", "Error: No such object: kj-ollama"]) {
      const r = await probe(machine({ docker: () => ({ exitCode: 1, stdout: "", stderr }) }));
      expect(r).toMatchObject({ state: "skipped" });
      expect(r.reason).toMatch(/Docker|kj-ollama/);
    }
  });

  it("under budget takes one sample; a spike (second sample under) is not reported", async () => {
    const calm = machine({ cpu: ["80%"] });
    expect(await probe(calm)).toMatchObject({ state: "ok", cpu: 80, budget: 200 }); // 4 cores → half = 2 → 200 %
    expect(calm.sleep).not.toHaveBeenCalled();
    const spike = machine({ cpu: ["300%", "40%"] });
    expect((await probe(spike)).state).toBe("ok");
    expect(spike.sleep).toHaveBeenCalledOnce();
  });

  it("uses the container's own CPU limit as the budget when it has one", async () => {
    expect(await probe(machine({ cpu: ["120%", "130%"], nano: String(1e9) }))).toMatchObject({ state: "over", budget: 100, samples: [120, 130] });
    expect((await probe(machine({ cpu: ["300%", "n/a"] }))).state).toBe("skipped"); // second sample fails: no reading, not "NaN% ok"
  });

  it("over budget: names every kj rag index with pid, elapsed, cwd and the lease; ignores other processes and bad pids", async () => {
    const m = machine();
    const r = await probe(m);
    expect(r.indexers).toEqual([{ pid: 4242, elapsed: "12m03s", cwd: "/work/proj", holdsLease: true }]);
    // read-only: only docker stats/inspect, ps and lsof ever run
    expect(m.calls.every(([c, a]) => (c === "docker" && ["stats", "inspect"].includes(a)) || ["ps", "lsof"].includes(c))).toBe(true);
  });

  it("over budget with no kj indexer: says the load is not from one", async () => {
    const r = await probe(machine({ ps: "  4300 05:00 vim notes.md\n" }));
    expect(r.indexers).toEqual([]);
    expect(getEmbedderLoadChecks()[0].render(r).detail).toMatch(/not from a kj indexer/);
  });
});

describe("embedder-load reports", () => {
  const over = { state: "over", cpu: 230, budget: 200, samples: [212.5, 230], container: "kj-ollama", gapMs: 5000, indexers: [{ pid: 4242, elapsed: "12m03s", cwd: "/work/proj", holdsLease: true }] };

  it("doctor: a passing check is one short line, over budget names the cause and the fixes in order", async () => {
    const [check] = getEmbedderLoadChecks();
    expect(check.render({ state: "ok", cpu: 80, budget: 200 })).toMatchObject({ ok: true, detail: expect.not.stringContaining("\n") });
    const r = check.render(over);
    expect(r.ok).toBe(false);
    expect(r.detail).toMatch(/pid 4242.*12m03s.*\/work\/proj.*holds the machine lease/);
    expect(r.fix.indexOf("rag.embedder.cpus")).toBeLessThan(r.fix.indexOf("lease"));
    expect(r.fix.indexOf("lease")).toBeLessThan(r.fix.indexOf("predates the embedded header"));
  });

  it("steward: over budget is broken with the same facts; anything else is ok", () => {
    expect(evaluateEmbedderLoad(over)).toMatchObject({ verdict: "broken", evidence: expect.stringContaining("pid 4242") });
    expect(evaluateEmbedderLoad({ state: "skipped", reason: "Docker is not available" }).verdict).toBe("ok");
    expect(evaluateEmbedderLoad(null).verdict).toBe("unknown");
  });
});
