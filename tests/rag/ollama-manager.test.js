// KJC-TSK-0435 — ollama-manager.js contract.
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import net from "node:net";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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
});
