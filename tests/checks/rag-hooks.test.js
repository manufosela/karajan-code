// KJC-BUG-0100 — doctor visibility for the RAG post-merge refresh.
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execa } from "execa";
import { beforeEach, describe, expect, it } from "vitest";

import { createRagHooksCheck } from "../../src/checks/rag-hooks.js";

describe("rag-hooks check — KJC-BUG-0100", () => {
  let root, projectDir;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "kj-rag-check-"));
    projectDir = join(root, "proj");
    mkdirSync(projectDir, { recursive: true });
  });

  it("is info (ok) outside a git repository", async () => {
    const r = await createRagHooksCheck({ projectDir }).detect();
    expect(r.ok).toBe(true);
    expect(r.severity).toBe("info");
  });

  it("warns when no post-merge hook reindexes the RAG", async () => {
    await execa("git", ["-C", projectDir, "init", "-q"]);
    const r = await createRagHooksCheck({ projectDir }).detect();
    expect(r.ok).toBe(false);
    expect(r.severity).toBe("warn");
    expect(r.fix).toMatch(/install-hooks/);
  });

  it("is ok when the effective post-merge hook reindexes the RAG (core.hooksPath)", async () => {
    await execa("git", ["-C", projectDir, "init", "-q"]);
    await execa("git", ["-C", projectDir, "config", "core.hooksPath", ".karajan/hooks"]);
    const dir = join(projectDir, ".karajan", "hooks");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "post-merge"), "#!/usr/bin/env sh\nkj rag index --since auto\n");
    const r = await createRagHooksCheck({ projectDir }).detect();
    expect(r.ok).toBe(true);
    expect(r.detail).toMatch(/\.karajan\/hooks/);
  });
});
