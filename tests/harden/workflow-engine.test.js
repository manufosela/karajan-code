import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import yaml from "js-yaml";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { installWorkflows } from "../../src/harden/workflow-engine.js";

let dir;
const wfPath = join(".github", "workflows", "kj-no-ai-attribution.yml");
const read = (rel) => readFileSync(join(dir, rel), "utf8");

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "kj-wf-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("installWorkflows", () => {
  it("seeds a marked, valid-YAML no-AI-attribution workflow", () => {
    const res = installWorkflows({ projectDir: dir });
    expect(res.workflows[0]).toMatchObject({ file: wfPath, action: "inserted" });
    const text = read(wfPath);
    expect(text).toContain(">>> kj:managed:wf-no-ai v1 >>>");
    // GitHub expressions survive verbatim (not interpolated by JS).
    expect(text).toContain("${{ github.base_ref }}");
    const parsed = yaml.load(text);
    expect(parsed.name).toBe("Block AI attribution");
    expect(parsed.jobs.scan["runs-on"]).toBe("ubuntu-latest");
  });

  it("is idempotent", () => {
    installWorkflows({ projectDir: dir });
    const res = installWorkflows({ projectDir: dir });
    expect(res.workflows[0].action).toBe("unchanged");
  });

  it("never overwrites a user workflow without our marker", () => {
    const abs = join(dir, ".github", "workflows");
    mkdirSync(abs, { recursive: true });
    writeFileSync(join(abs, "kj-no-ai-attribution.yml"), "name: mine\n");
    const res = installWorkflows({ projectDir: dir });
    expect(res.workflows[0].action).toBe("skipped");
    expect(read(wfPath)).toBe("name: mine\n");
  });

  it("dry-run writes nothing", () => {
    installWorkflows({ projectDir: dir, dryRun: true });
    expect(existsSync(join(dir, wfPath))).toBe(false);
  });

  it("adds a stack-aware Quality workflow for a known language", () => {
    const res = installWorkflows({ projectDir: dir, language: "go" });
    expect(res.workflows.map((w) => w.file)).toContain(join(".github", "workflows", "kj-quality.yml"));
    const text = read(join(".github", "workflows", "kj-quality.yml"));
    expect(text).toContain("actions/setup-go@v5");
    expect(text).toContain("go test ./...");
    expect(yaml.load(text).jobs.quality["runs-on"]).toBe("ubuntu-latest");
  });

  it("python gets ruff + pytest, javascript gets npm", () => {
    const py = mkdtempSync(join(tmpdir(), "kj-wf-py-"));
    installWorkflows({ projectDir: py, language: "python" });
    expect(readFileSync(join(py, ".github", "workflows", "kj-quality.yml"), "utf8")).toContain("ruff check .");
    rmSync(py, { recursive: true, force: true });
    installWorkflows({ projectDir: dir, language: "typescript" });
    expect(read(join(".github", "workflows", "kj-quality.yml"))).toContain("npm test");
  });

  it("omits the Quality workflow for an unknown language", () => {
    const res = installWorkflows({ projectDir: dir, language: "ruby" });
    expect(res.workflows.map((w) => w.file)).not.toContain(join(".github", "workflows", "kj-quality.yml"));
  });
});
