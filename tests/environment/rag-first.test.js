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
  installPlaybook: vi.fn().mockResolvedValue({ files: ["CLAUDE.md", "AGENTS.md"], target: "both" }),
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

  it("index failure does not break the playbook install (reported, not thrown)", async () => {
    getLastIndexedCommit.mockReturnValue(null);
    ragIndexCommand.mockRejectedValueOnce(new Error("ollama down"));
    const res = await envInstallCommand({ config, flags: {} });
    expect(res.files).toContain("CLAUDE.md");
    expect(res.ragError).toMatch(/ollama down/);
  });
});
