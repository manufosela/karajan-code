import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

vi.mock("../src/utils/process.js", () => ({ runCommand: vi.fn() }));

import { runCommand } from "../src/utils/process.js";
import {
  projectSlug, planQmdCollections, registerQmdCollections, QMD_DEFAULT_PATHS
} from "../src/utils/qmd-collection.js";

const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };

let tmpRoot, projectDir;
function setupProject(name) {
  tmpRoot = mkdtempSync(path.join(tmpdir(), "qmd-coll-"));
  projectDir = path.join(tmpRoot, name);
  mkdirSync(projectDir, { recursive: true });
}
beforeEach(() => vi.resetAllMocks());
afterEach(() => { if (tmpRoot) rmSync(tmpRoot, { recursive: true, force: true }); });

describe("projectSlug", () => {
  it("lowercases, sanitises and trims dashes", () => {
    expect(projectSlug("/tmp/MyProject")).toBe("myproject");
    expect(projectSlug("/tmp/My Cool Project!")).toBe("my-cool-project");
    expect(projectSlug("/tmp/---Edge---")).toBe("edge");
    expect(projectSlug("/tmp/!!!")).toBe("project");
  });
});

describe("planQmdCollections", () => {
  it("exposes the default paths", () => {
    expect(QMD_DEFAULT_PATHS).toEqual(["docs", ".reviews", ".karajan/plans"]);
  });

  it("returns only existing directories", () => {
    setupProject("Karajan");
    mkdirSync(path.join(projectDir, "docs"));
    mkdirSync(path.join(projectDir, ".reviews"));
    const names = planQmdCollections(projectDir).map((r) => r.name).sort();
    expect(names).toEqual(["karajan-docs", "karajan-reviews"]);
  });

  it("returns [] when nothing indexable exists", () => {
    setupProject("Empty");
    expect(planQmdCollections(projectDir)).toEqual([]);
  });

  it("skips entries that exist as files, not directories", () => {
    setupProject("Mixed");
    writeFileSync(path.join(projectDir, "docs"), "i am a file");
    expect(planQmdCollections(projectDir)).toEqual([]);
  });
});

describe("registerQmdCollections", () => {
  it("no-ops when no indexable folder exists", async () => {
    setupProject("Empty");
    const result = await registerQmdCollections(projectDir, logger);
    expect(result).toMatchObject({ ok: true, added: [], skipped: [], errors: [] });
    expect(runCommand).not.toHaveBeenCalled();
  });

  it("registers new collections", async () => {
    setupProject("Alpha");
    mkdirSync(path.join(projectDir, "docs"));
    mkdirSync(path.join(projectDir, ".reviews"));
    runCommand
      .mockResolvedValueOnce({ exitCode: 0, stdout: "", stderr: "" })
      .mockResolvedValue({ exitCode: 0, stdout: "", stderr: "" });
    const result = await registerQmdCollections(projectDir, logger);
    expect(result.ok).toBe(true);
    expect(result.added.sort()).toEqual(["alpha-docs", "alpha-reviews"]);
  });

  it("skips collections already present (idempotent)", async () => {
    setupProject("Beta");
    mkdirSync(path.join(projectDir, "docs"));
    runCommand.mockResolvedValueOnce({ exitCode: 0, stdout: "beta-docs (qmd://abc)\n", stderr: "" });
    const result = await registerQmdCollections(projectDir, logger);
    expect(result).toMatchObject({ ok: true, added: [], skipped: ["beta-docs"] });
    expect(runCommand).toHaveBeenCalledTimes(1);
  });

  it("flips ok:false when qmd add fails", async () => {
    setupProject("Gamma");
    mkdirSync(path.join(projectDir, "docs"));
    runCommand
      .mockResolvedValueOnce({ exitCode: 0, stdout: "", stderr: "" })
      .mockResolvedValueOnce({ exitCode: 1, stdout: "", stderr: "boom" });
    const result = await registerQmdCollections(projectDir, logger);
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain("gamma-docs");
  });
});
