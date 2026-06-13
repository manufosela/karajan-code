import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { installGuidelines } from "../../src/harden/guidelines-engine.js";

let dir;
const read = (f) => readFileSync(join(dir, f), "utf8");

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "kj-guide-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("installGuidelines", () => {
  it("seeds AGENTS.md and CLAUDE.md with a managed block", () => {
    const res = installGuidelines({ projectDir: dir });
    expect(res.guidelines.map((g) => g.file).sort()).toEqual(["AGENTS.md", "CLAUDE.md"]);
    for (const f of ["AGENTS.md", "CLAUDE.md"]) {
      const text = read(f);
      expect(text).toContain("<!-- >>> kj:managed:guidelines v1 >>>");
      expect(text).toContain("Conventional Commits");
      expect(text).toContain("ES2025");
    }
  });

  it("preserves the user's own content outside the block", () => {
    writeFileSync(join(dir, "CLAUDE.md"), "# My project\n\nMy custom notes.\n");
    installGuidelines({ projectDir: dir });
    const text = read("CLAUDE.md");
    expect(text).toContain("My custom notes.");
    expect(text).toContain("kj:managed:guidelines");
  });

  it("is idempotent", () => {
    installGuidelines({ projectDir: dir });
    const res = installGuidelines({ projectDir: dir });
    expect(res.guidelines.every((g) => g.action === "unchanged")).toBe(true);
  });

  it("dry-run writes nothing", () => {
    installGuidelines({ projectDir: dir, dryRun: true });
    expect(existsSync(join(dir, "AGENTS.md"))).toBe(false);
  });
});
