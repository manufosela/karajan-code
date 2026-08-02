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
  // KJC-BUG-0128: the probe checks file existence before opening — point it
  // at a path that exists so tests still exercise getLastIndexedCommit.
  dbPath: vi.fn(() => process.cwd()),
}));
vi.mock("../../src/commands/rag.js", () => ({
  ragIndexCommand: vi.fn().mockResolvedValue({ ok: true }),
}));
vi.mock("../../src/environment/playbook.js", () => ({
  // fresh object per call — envInstallCommand mutates its result
  installPlaybook: vi.fn(async () => ({ files: ["CLAUDE.md", "AGENTS.md"], target: "both" })),
  renderPlaybook: vi.fn(() => "# Karajan method (v4)"),
}));
vi.mock("../../src/rag/onnx-fallback.js", async (orig) => ({
  ...(await orig()),
  persistOnnxChoice: vi.fn().mockResolvedValue("/tmp/proj/.karajan/kj.config.yml"),
  resetEmptyStore: vi.fn(() => true),
}));
vi.mock("../../src/environment/board-access.js", () => ({
  verifyBoardAccess: vi.fn(() => ({ ok: true, backend: "hu-board", via: "bundled HU Board" })),
}));

import { envInstallCommand } from "../../src/commands/env.js";
import { getLastIndexedCommit } from "../../src/rag/vec-store.js";
import { ragIndexCommand } from "../../src/commands/rag.js";

const config = { projectDir: "/tmp/proj", rag: {} };

describe("env install is RAG-first", () => {
  beforeEach(() => vi.clearAllMocks());

  it("builds the index with sources when the project has none", async () => {
    getLastIndexedCommit.mockReturnValue(null);
    await envInstallCommand({ config, flags: { enforce: false } });
    expect(ragIndexCommand).toHaveBeenCalledTimes(1);
    expect(ragIndexCommand.mock.calls[0][0].flags.withSources).toBe(true);
  });

  it("does not reindex when an index already exists", async () => {
    getLastIndexedCommit.mockReturnValue("abc123");
    await envInstallCommand({ config, flags: { enforce: false } });
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
    const res = await envInstallCommand({ config: explicitOllama, flags: { enforce: false } });
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
    const res = await envInstallCommand({ config: explicitOllama, flags: { enforce: false } });
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
    const res = await envInstallCommand({ config, flags: { enforce: false } });
    spy.mockRestore();
    expect(res.exitCode).toBeUndefined(); // no block
    expect(ragIndexCommand).toHaveBeenCalledTimes(2);
    expect(ragIndexCommand.mock.calls[1][0].config.rag.embedder.provider).toBe("onnx");
    const { persistOnnxChoice } = await import("../../src/rag/onnx-fallback.js");
    expect(persistOnnxChoice).toHaveBeenCalledWith("/tmp/proj");
  });

  // KJC-BUG-0128: probing for an index must never CREATE the store — a vec
  // table born at 768 breaks the 384 ONNX fallback afterwards.
  it("the index probe does not open (create) the store when no db file exists", async () => {
    const { dbPath, openVecStore } = await import("../../src/rag/vec-store.js");
    dbPath.mockReturnValueOnce("/definitely/not/a/real/path.db");
    getLastIndexedCommit.mockReturnValue("abc123"); // would say "present" if consulted
    ragIndexCommand.mockResolvedValueOnce({ indexed: 10, files: 10, failed: 0 });
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    await envInstallCommand({ config, flags: { enforce: false } });
    spy.mockRestore();
    expect(openVecStore).not.toHaveBeenCalled(); // no accidental DDL
    expect(ragIndexCommand).toHaveBeenCalled(); // treated as "no index yet"
  });

  it("does not switch to ONNX when the store already has data at another dim", async () => {
    const { resetEmptyStore } = await import("../../src/rag/onnx-fallback.js");
    resetEmptyStore.mockReturnValueOnce(false);
    getLastIndexedCommit.mockReturnValue(null);
    ragIndexCommand.mockRejectedValueOnce(new Error("ollama down"));
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const res = await envInstallCommand({ config, flags: { enforce: false } });
    spy.mockRestore();
    expect(res.exitCode).toBe(3); // blocked — never destroys existing data
    expect(ragIndexCommand).toHaveBeenCalledTimes(1); // no second (onnx) attempt
  });

  it("blocks as before when the ONNX fallback also fails", async () => {
    getLastIndexedCommit.mockReturnValue(null);
    ragIndexCommand
      .mockRejectedValueOnce(new Error("ollama down"))
      .mockRejectedValueOnce(new Error("model download failed"));
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const res = await envInstallCommand({ config, flags: { enforce: false } });
    spy.mockRestore();
    expect(res.exitCode).toBe(3);
    expect(res.ragError).toMatch(/ollama down/);
  });

  // KJC-TSK-0685: no board access → block BEFORE the RAG even runs. The
  // playbook stays installed; exit 3 carries the exact steps.
  it("blocks with exit 3 when the declared board has no access path — before touching the RAG", async () => {
    const { verifyBoardAccess } = await import("../../src/environment/board-access.js");
    verifyBoardAccess.mockReturnValueOnce({ ok: false, backend: "external", name: "Linear", needed: ["configure the Linear MCP, or", "export LINEAR_API_KEY"] });
    const logs = [];
    const spy = vi.spyOn(console, "log").mockImplementation((...a) => logs.push(a.join(" ")));
    const res = await envInstallCommand({ config, flags: { enforce: false } });
    spy.mockRestore();
    expect(res.exitCode).toBe(3);
    expect(res.boardError).toMatch(/Linear|LINEAR/);
    expect(ragIndexCommand).not.toHaveBeenCalled(); // board first, RAG later
    expect(logs.join("\n")).toMatch(/PENDING USER ACTION/);
  });

  it("a healthy first index does not block", async () => {
    getLastIndexedCommit.mockReturnValue(null);
    ragIndexCommand.mockResolvedValueOnce({ indexed: 512, files: 700, failed: 0 });
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const res = await envInstallCommand({ config, flags: { enforce: false } });
    spy.mockRestore();
    expect(res.exitCode).toBeUndefined();
  });
});
