// ENV-E1 (KJC-TSK-0640): the playbook's step 1 ("query the RAG before
// coding") must never point at a missing or stale index — env install
// builds it when absent, rag query delta-updates on drift before serving.
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/rag/vec-store.js", () => ({
  openVecStore: vi.fn(() => ({ close: vi.fn() })),
  projectSlug: vi.fn(() => "proj"),
  getLastIndexedCommit: vi.fn(),
  setLastIndexedCommit: vi.fn(),
  countChunks: vi.fn(() => 0),
}));
vi.mock("../../src/commands/rag.js", () => ({
  ragIndexCommand: vi.fn().mockResolvedValue({ ok: true }),
}));
vi.mock("../../src/environment/playbook.js", () => ({
  // fresh object per call — envInstallCommand mutates its result
  installPlaybook: vi.fn(async () => ({ files: ["CLAUDE.md", "AGENTS.md"], target: "both" })),
}));
vi.mock("../../src/rag/onnx-fallback.js", async (orig) => ({
  ...(await orig()), persistOnnxChoice: vi.fn().mockResolvedValue("/tmp/proj/.karajan/kj.config.yml"),
}));

import { envInstallCommand } from "../../src/commands/env.js";
import { getLastIndexedCommit } from "../../src/rag/vec-store.js";
import { ragIndexCommand } from "../../src/commands/rag.js";

const config = { projectDir: "/tmp/proj", rag: {} };

describe("env install is RAG-first", () => {
  beforeEach(() => vi.clearAllMocks());

  it("builds the index with sources when the project has none", async () => {
    getLastIndexedCommit.mockReturnValue(null);
    await envInstallCommand({ config, flags: {} });
    expect(ragIndexCommand).toHaveBeenCalledTimes(1);
    expect(ragIndexCommand.mock.calls[0][0].flags.withSources).toBe(true);
  });

  it("does not reindex when an index already exists", async () => {
    getLastIndexedCommit.mockReturnValue("abc123");
    await envInstallCommand({ config, flags: {} });
    expect(ragIndexCommand).not.toHaveBeenCalled();
  });

  it("--no-rag opts out of index creation", async () => {
    getLastIndexedCommit.mockReturnValue(null);
    await envInstallCommand({ config, flags: { rag: false } });
    expect(ragIndexCommand).not.toHaveBeenCalled();
  });

  // KJC-TSK-0659 stop-on-sudo: a RAG that cannot index BLOCKS (exit 3) —
  // never "success" with an empty index. The playbook stays installed.
  // KJC-TSK-0683: with an EXPLICIT provider the user's choice is respected —
  // no ONNX fallback, straight to the block.
  const explicitOllama = { projectDir: "/tmp/proj", rag: { embedder: { provider: "ollama" } } };

  it("index failure blocks with pending-user-action (exit 3), playbook still installed", async () => {
    getLastIndexedCommit.mockReturnValue(null);
    ragIndexCommand.mockRejectedValueOnce(new Error("ollama down"));
    const logs = [];
    const spy = vi.spyOn(console, "log").mockImplementation((...a) => logs.push(a.join(" ")));
    const res = await envInstallCommand({ config: explicitOllama, flags: {} });
    spy.mockRestore();
    expect(res.files).toContain("CLAUDE.md");
    expect(res.ragError).toMatch(/ollama down/);
    expect(res.exitCode).toBe(3);
    const out = logs.join("\n");
    expect(out).toMatch(/PENDING USER ACTION/);
    expect(out).toMatch(/ollama/);
    expect(out).toMatch(/kj rag index --with-sources/);
  });

  it("an index that embeds 0 of N files blocks too — empty is not success", async () => {
    getLastIndexedCommit.mockReturnValue(null);
    ragIndexCommand.mockResolvedValueOnce({ indexed: 0, files: 727, failed: 727 });
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const res = await envInstallCommand({ config: explicitOllama, flags: {} });
    spy.mockRestore();
    expect(res.exitCode).toBe(3);
    expect(res.ragError).toMatch(/0 of 727/);
  });

  // KJC-TSK-0683: limited machines — default provider + Ollama down falls
  // back to the built-in ONNX embedder and PERSISTS the choice (dims differ:
  // the election must be sticky, never oscillate per run).
  it("default provider + failed first index falls back to ONNX and persists it", async () => {
    getLastIndexedCommit.mockReturnValue(null);
    ragIndexCommand
      .mockRejectedValueOnce(new Error("ollama down"))
      .mockResolvedValueOnce({ indexed: 300, files: 400, failed: 0 });
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const res = await envInstallCommand({ config, flags: {} });
    spy.mockRestore();
    expect(res.exitCode).toBeUndefined(); // no block
    expect(ragIndexCommand).toHaveBeenCalledTimes(2);
    expect(ragIndexCommand.mock.calls[1][0].config.rag.embedder.provider).toBe("onnx");
    const { persistOnnxChoice } = await import("../../src/rag/onnx-fallback.js");
    expect(persistOnnxChoice).toHaveBeenCalledWith("/tmp/proj");
  });

  it("blocks as before when the ONNX fallback also fails", async () => {
    getLastIndexedCommit.mockReturnValue(null);
    ragIndexCommand
      .mockRejectedValueOnce(new Error("ollama down"))
      .mockRejectedValueOnce(new Error("model download failed"));
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const res = await envInstallCommand({ config, flags: {} });
    spy.mockRestore();
    expect(res.exitCode).toBe(3);
    expect(res.ragError).toMatch(/ollama down/);
  });

  it("a healthy first index does not block", async () => {
    getLastIndexedCommit.mockReturnValue(null);
    ragIndexCommand.mockResolvedValueOnce({ indexed: 512, files: 700, failed: 0 });
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const res = await envInstallCommand({ config, flags: {} });
    spy.mockRestore();
    expect(res.exitCode).toBeUndefined();
  });
});
