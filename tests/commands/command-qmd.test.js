// KJC-TSK-0509 — kj qmd query CLI wrapper. Mocks runCommand so the handler
// stays hermetic; no real qmd binary required.
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../../src/utils/process.js", () => ({ runCommand: vi.fn() }));

import { runCommand } from "../../src/utils/process.js";
import { qmdQueryCommand } from "../../src/commands/qmd.js";

const noopLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

beforeEach(() => {
  vi.resetAllMocks();
  for (const k of ["info", "warn", "error"]) noopLogger[k].mockClear();
  process.exitCode = undefined;
});

describe("qmdQueryCommand — KJC-TSK-0509", () => {
  it("throws when text is blank", async () => {
    await expect(
      qmdQueryCommand({ text: "   ", config: { projectDir: "/tmp/p" }, logger: noopLogger, flags: {} })
    ).rejects.toThrow(/text argument required/);
    expect(runCommand).not.toHaveBeenCalled();
  });

  it("auto-resolves <slug>-docs, supports overrides, scope mapping, clamp, fast", async () => {
    runCommand.mockResolvedValue({ exitCode: 0, stdout: "[]", stderr: "" });
    // default → my-repo-docs
    await qmdQueryCommand({ text: "auth flow", config: { projectDir: "/tmp/My-Repo" }, logger: noopLogger, flags: {} });
    expect(runCommand.mock.calls[0][1].slice(0, 8))
      .toEqual(["query", "auth flow", "--format", "json", "-c", "my-repo-docs", "-n", "10"]);
    // --collection wins, --top-k clamps to 50, --fast adds --no-rerank
    await qmdQueryCommand({ text: "x", config: { projectDir: "/tmp/p" }, logger: noopLogger, flags: { collection: "custom", topK: 999, fast: true } });
    const a2 = runCommand.mock.calls[1][1];
    expect(a2[a2.indexOf("-c") + 1]).toBe("custom");
    expect(a2[a2.indexOf("-n") + 1]).toBe("50");
    expect(a2).toContain("--no-rerank");
    // --scope=plans → <slug>-karajan-plans
    await qmdQueryCommand({ text: "x", config: { projectDir: "/tmp/p" }, logger: noopLogger, flags: { scope: "plans" } });
    expect(runCommand.mock.calls[2][1]).toContain("p-karajan-plans");
  });

  it("returns installable error and exitCode=127 on ENOENT or shell-not-found", async () => {
    // ENOENT path
    runCommand.mockRejectedValueOnce(Object.assign(new Error("ENOENT"), { code: "ENOENT" }));
    const r1 = await qmdQueryCommand({ text: "x", config: { projectDir: "/tmp/p" }, logger: noopLogger, flags: {} });
    expect(r1).toEqual({ ok: false, error: "qmd not installed", installable: true });
    expect(process.exitCode).toBe(127);
    expect(noopLogger.error).toHaveBeenCalledWith(expect.stringMatching(/npm install -g @tobilu\/qmd/));
    // exitCode=127 fallback
    process.exitCode = undefined;
    runCommand.mockResolvedValueOnce({ exitCode: 127, stdout: "", stderr: "qmd: command not found" });
    const r2 = await qmdQueryCommand({ text: "x", config: { projectDir: "/tmp/p" }, logger: noopLogger, flags: {} });
    expect(r2.installable).toBe(true);
    expect(process.exitCode).toBe(127);
  });

  it("suggests `kj init` when collection is missing", async () => {
    runCommand.mockResolvedValue({ exitCode: 1, stdout: "", stderr: "Error: no such collection 'my-repo-docs'" });
    const res = await qmdQueryCommand({ text: "x", config: { projectDir: "/tmp/My-Repo" }, logger: noopLogger, flags: {} });
    expect(res).toEqual({ ok: false, error: "collection not registered", collection: "my-repo-docs" });
    expect(noopLogger.error).toHaveBeenCalledWith(expect.stringMatching(/kj init/));
  });

  it("prints raw JSON when --json, friendly hits otherwise", async () => {
    const hits = [{ source: "docs/a.md", score: 0.91, snippet: "alpha" }];
    runCommand.mockResolvedValue({ exitCode: 0, stdout: JSON.stringify(hits), stderr: "" });
    // --json → raw
    const chunks = [];
    const orig = process.stdout.write.bind(process.stdout);
    process.stdout.write = (s) => { chunks.push(String(s)); return true; };
    try {
      await qmdQueryCommand({ text: "x", config: { projectDir: "/tmp/p" }, logger: noopLogger, flags: { json: true } });
    } finally { process.stdout.write = orig; }
    expect(JSON.parse(chunks.join("").trim())).toEqual(hits);
    expect(noopLogger.info).not.toHaveBeenCalled();
    // no --json → friendly
    await qmdQueryCommand({ text: "x", config: { projectDir: "/tmp/My-Repo" }, logger: noopLogger, flags: {} });
    const lines = noopLogger.info.mock.calls.map((c) => c[0]).join("\n");
    expect(lines).toMatch(/1 hit\(s\) in my-repo-docs/);
    expect(lines).toMatch(/docs\/a\.md.*score=0\.9100/);
    expect(lines).toMatch(/alpha/);
  });

  it("returns malformed-JSON error when qmd stdout is not valid JSON", async () => {
    runCommand.mockResolvedValue({ exitCode: 0, stdout: "not-json", stderr: "" });
    const res = await qmdQueryCommand({ text: "x", config: { projectDir: "/tmp/p" }, logger: noopLogger, flags: {} });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/not valid JSON/);
  });
});
