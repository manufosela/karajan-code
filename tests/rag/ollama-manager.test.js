// KJC-TSK-0435 — ollama-manager.js contract.
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import net from "node:net";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import os from "node:os";

vi.mock("../../src/utils/process.js", () => ({
  runCommand: vi.fn(),
}));
import { runCommand } from "../../src/utils/process.js";
import {
  normalizeOllamaConfig, buildComposeTemplate, ensureComposeFile,
  isOllamaReachable, findAvailableOllamaPort, ollamaUp, ollamaDown,
} from "../../src/rag/ollama-manager.js";

describe("ollama-manager — KJC-TSK-0435", () => {
  let prevHome;
  beforeEach(() => {
    prevHome = process.env.KARAJAN_HOME;
    process.env.KARAJAN_HOME = mkdtempSync(join(tmpdir(), "kj-ollama-home-"));
    runCommand.mockReset();
  });
  afterEach(() => {
    if (process.env.KARAJAN_HOME) rmSync(process.env.KARAJAN_HOME, { recursive: true, force: true });
    if (prevHome === undefined) delete process.env.KARAJAN_HOME;
    else process.env.KARAJAN_HOME = prevHome;
  });

  it("normalizeOllamaConfig fills defaults + honours overrides", () => {
    const d = normalizeOllamaConfig({});
    expect(d).toMatchObject({ host: "http://localhost:11434", port: 11434, containerName: "kj-ollama", external: false });
    expect(d.timeouts.healthcheckSeconds).toBe(5);
    const o = normalizeOllamaConfig({ port: 11500, container_name: "x", external: true, volume: "v" });
    expect(o).toMatchObject({ port: 11500, host: "http://localhost:11500", containerName: "x", external: true, volume: "v" });
  });

  it("buildComposeTemplate + ensureComposeFile produce a usable yaml", async () => {
    const yml = buildComposeTemplate(normalizeOllamaConfig({ port: 11500 }));
    expect(yml).toContain("ollama/ollama:latest");
    expect(yml).toContain("- \"11500:11434\"");
    const p = await ensureComposeFile({});
    expect(existsSync(p) && readFileSync(p, "utf8")).toContain("ollama/ollama:latest");
  });

  it("isOllamaReachable reflects HTTP status from /api/tags", async () => {
    runCommand.mockResolvedValueOnce({ exitCode: 0, stdout: "200", stderr: "" });
    expect(await isOllamaReachable("http://localhost:11434")).toBe(true);
    runCommand.mockResolvedValueOnce({ exitCode: 7, stdout: "", stderr: "" });
    expect(await isOllamaReachable("http://localhost:11434")).toBe(false);
  });

  it("findAvailableOllamaPort skips occupied ports", async () => {
    const occ = await new Promise((r) => { const s = net.createServer(); s.listen(0, "127.0.0.1", () => r(s)); });
    try { expect(await findAvailableOllamaPort(occ.address().port, 5)).toBeGreaterThan(occ.address().port); }
    finally { occ.close(); }
  });

  it("ollamaUp short-circuits when host already reachable", async () => {
    runCommand.mockResolvedValue({ exitCode: 0, stdout: "200", stderr: "" });
    const res = await ollamaUp({});
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toMatch(/already reachable/);
    expect(res.reusedHost).toBe("http://localhost:11434");
  });

  it("ollamaUp refuses when external=true and host unreachable", async () => {
    runCommand.mockResolvedValueOnce({ exitCode: 7, stdout: "", stderr: "" });
    const res = await ollamaUp({ external: true, host: "http://nope:9999" });
    expect(res.exitCode).toBe(1);
    expect(res.stderr).toMatch(/external Ollama is not reachable/);
  });

  it("ollamaUp falls through to docker compose up when unreachable", async () => {
    runCommand
      .mockResolvedValueOnce({ exitCode: 7, stdout: "", stderr: "" })   // healthcheck fail
      .mockResolvedValueOnce({ exitCode: 1, stdout: "", stderr: "No such object" }) // docker inspect: no container yet
      .mockResolvedValueOnce({ exitCode: 0, stdout: "Started", stderr: "" }); // docker
    const res = await ollamaUp({});
    expect(res.exitCode).toBe(0);
    expect(runCommand).toHaveBeenLastCalledWith("docker", expect.arrayContaining(["compose", "up", "-d"]), expect.any(Object));
  });

  it("ollamaDown skips when external, otherwise invokes docker compose stop", async () => {
    const skipped = await ollamaDown({ external: true });
    expect(skipped.stdout).toMatch(/skipping Docker stop/);
    expect(runCommand).not.toHaveBeenCalled();
    runCommand.mockResolvedValue({ exitCode: 0, stdout: "stopped", stderr: "" });
    await ollamaDown({});
    expect(runCommand).toHaveBeenCalledWith("docker", expect.arrayContaining(["compose", "stop"]), expect.any(Object));
  });

  describe("rag.embedder.cpus — HU-3362", () => {
    const half = Math.max(1, Math.floor(os.availableParallelism() / 2));
    const ok = (stdout = "") => ({ exitCode: 0, stdout, stderr: "" });
    const nano = (cpus) => String(cpus * 1e9); // docker inspect HostConfig.NanoCpus
    const dockerArgs = () => runCommand.mock.calls.filter((c) => c[0] === "docker").map((c) => c[1]);

    it("defaults to half the host cores (min 1); 0 means no limit; rejects bad values", () => {
      expect(normalizeOllamaConfig({})).toMatchObject({ cpus: half, cpusExplicit: false });
      expect(normalizeOllamaConfig({ cpus: 0 })).toMatchObject({ cpus: 0, cpusExplicit: true });
      expect(normalizeOllamaConfig({ cpus: 1.5 }).cpus).toBe(1.5);
      for (const bad of [-1, "x", NaN, Infinity, 100000]) {
        expect(() => normalizeOllamaConfig({ cpus: bad })).toThrow(/rag\.embedder\.cpus/);
      }
    });

    it("writes cpus into the compose file only when limited", () => {
      expect(buildComposeTemplate(normalizeOllamaConfig({ cpus: 2 }))).toContain("cpus: 2");
      expect(buildComposeTemplate(normalizeOllamaConfig({ cpus: 0 }))).not.toContain("cpus");
    });

    it("updates a running container whose limit differs and says so", async () => {
      runCommand.mockResolvedValueOnce(ok("200")).mockResolvedValueOnce(ok(nano(4))).mockResolvedValueOnce(ok());
      const res = await ollamaUp({ cpus: 2 });
      expect(dockerArgs()[1]).toEqual(["update", "--cpus", "2", "kj-ollama"]);
      expect(res.stdout).toMatch(/CPU limit.*2/);
    });

    it("fails loudly when docker update fails on a running container", async () => {
      runCommand.mockResolvedValueOnce(ok("200")).mockResolvedValueOnce(ok(nano(4))).mockResolvedValueOnce({ exitCode: 1, stdout: "", stderr: "denied" });
      const res = await ollamaUp({ cpus: 2 });
      expect(res.exitCode).toBe(1);
      expect(res.stderr).toMatch(/Could not set the CPU limit.*denied/);
    });

    it("leaves a running container alone when the limit already matches", async () => {
      runCommand.mockResolvedValueOnce(ok("200")).mockResolvedValueOnce(ok(nano(2)));
      await ollamaUp({ cpus: 2 });
      expect(dockerArgs()).toHaveLength(1);
    });

    it("respects a limit set by hand when cpus is not configured", async () => {
      runCommand.mockResolvedValueOnce(ok("200")).mockResolvedValueOnce(ok(nano(1)));
      const res = await ollamaUp({});
      expect(dockerArgs().some((a) => a[0] === "update")).toBe(false);
      expect(res.stdout).not.toMatch(/CPU limit set/);
    });

    it("applies the default to an unlimited running container", async () => {
      runCommand.mockResolvedValueOnce(ok("200")).mockResolvedValueOnce(ok("0")).mockResolvedValueOnce(ok());
      await ollamaUp({});
      expect(dockerArgs()[1]).toEqual(["update", "--cpus", String(half), "kj-ollama"]);
    });

    it("does nothing without a container (native Ollama)", async () => {
      runCommand.mockResolvedValueOnce(ok("200")).mockResolvedValueOnce({ exitCode: 1, stdout: "", stderr: "No such object" });
      const res = await ollamaUp({ cpus: 2 });
      expect(dockerArgs()).toHaveLength(1);
      expect(res.exitCode).toBe(0);
    });

    it("external=true ignores cpus and says so only when the user set it", async () => {
      runCommand.mockResolvedValue(ok("200"));
      expect((await ollamaUp({ external: true, cpus: 2 })).stdout).toMatch(/cpus.*ignored.*external/);
      expect((await ollamaUp({ external: true })).stdout).not.toMatch(/cpus/);
      expect(dockerArgs()).toHaveLength(0);
    });

    it("writes the limit into the compose file when it starts the container", async () => {
      runCommand.mockResolvedValueOnce({ exitCode: 7, stdout: "", stderr: "" }).mockResolvedValueOnce(ok("0")).mockResolvedValueOnce(ok("Started"));
      await ollamaUp({ cpus: 3 });
      expect(readFileSync(join(process.env.KARAJAN_HOME, "docker-compose.ollama.yml"), "utf8")).toContain("cpus: 3");
    });
  });
});
