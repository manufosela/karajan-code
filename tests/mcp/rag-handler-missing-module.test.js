// HU-3689 (#3673): a missing module while opening the RAG store is named, with the repair command.
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

const failing = {
  error: Object.assign(new Error("Cannot find module 'bindings'"), { code: "MODULE_NOT_FOUND" }),
};

vi.mock("../../src/rag/project-store.js", () => ({
  openProjectStore: () => { throw failing.error; },
}));
vi.mock("../../src/mcp/shared-helpers.js", async () => {
  const actual = await vi.importActual("../../src/mcp/shared-helpers.js");
  return {
    ...actual,
    resolveProjectDir: vi.fn(async (_s, dir) => dir),
    buildConfig: vi.fn(async () => ({ rag: { embedder: { dim: 8 } } })),
  };
});

const packageDir = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

describe("kj_rag_query when a module cannot load", () => {
  it("names the missing module and the repair commands", async () => {
    const { handleRagQuery } = await import("../../src/mcp/handlers/rag-handler.js");
    const res = await handleRagQuery({ text: "anything", projectDir: "/tmp/p" }, {});
    expect(res.ok).toBe(false);
    expect(res.error).toContain("the RAG store could not load: Cannot find module 'bindings'");
    expect(res.error).toContain("npm install -g karajan-code");
    expect(res.error).toContain(`npm rebuild in ${packageDir}`);
  });

  it("leaves any other failure message untouched", async () => {
    failing.error = new Error("disk is full");
    const { handleRagQuery } = await import("../../src/mcp/handlers/rag-handler.js");
    const res = await handleRagQuery({ text: "anything", projectDir: "/tmp/p" }, {});
    expect(res.error).toBe("kj_rag_query failed: disk is full");
  });
});
