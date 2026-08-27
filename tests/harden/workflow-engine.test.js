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
    expect(text).toContain("actions/setup-go@40f1582b2485089dde7abd97c1529aa768e1baff # v5");
    expect(text).toContain("go test ./...");
    expect(yaml.load(text).jobs.quality["runs-on"]).toBe("ubuntu-latest");
  });

  it("php gets a setup-php Quality workflow", () => {
    installWorkflows({ projectDir: dir, language: "php" });
    const text = read(join(".github", "workflows", "kj-quality.yml"));
    expect(text).toContain("shivammathur/setup-php@f3e473d116dcccaddc5834248c87452386958240 # v2");
    expect(text).toContain("vendor/bin/phpunit");
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

  it("adds shrink-budget only on the strict profile", () => {
    const std = installWorkflows({ projectDir: dir, profile: "standard" });
    expect(std.workflows.map((w) => w.file)).not.toContain(join(".github", "workflows", "kj-shrink-budget.yml"));
    const strictDir = mkdtempSync(join(tmpdir(), "kj-wf-strict-"));
    const strict = installWorkflows({ projectDir: strictDir, profile: "strict" });
    expect(strict.workflows.map((w) => w.file)).toContain(join(".github", "workflows", "kj-shrink-budget.yml"));
    expect(yaml.load(readFileSync(join(strictDir, ".github", "workflows", "kj-shrink-budget.yml"), "utf8")).name).toBe(
      "Shrink budget"
    );
    rmSync(strictDir, { recursive: true, force: true });
  });

  it("adds pack-smoke only for a publishable npm package", () => {
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "x", bin: { x: "cli.js" } }));
    const res = installWorkflows({ projectDir: dir });
    expect(res.workflows.map((w) => w.file)).toContain(join(".github", "workflows", "kj-pack-smoke.yml"));
  });

  it("omits pack-smoke for a private package", () => {
    const priv = mkdtempSync(join(tmpdir(), "kj-wf-priv-"));
    writeFileSync(join(priv, "package.json"), JSON.stringify({ name: "x", private: true, main: "i.js" }));
    const res = installWorkflows({ projectDir: priv });
    expect(res.workflows.map((w) => w.file)).not.toContain(join(".github", "workflows", "kj-pack-smoke.yml"));
    rmSync(priv, { recursive: true, force: true });
  });

  const mutFile = join(".github", "workflows", "kj-mutation.yml");

  it("omits the mutation workflow unless it is opted into", () => {
    const res = installWorkflows({ projectDir: dir, language: "javascript" });
    expect(res.workflows.map((w) => w.file)).not.toContain(mutFile);
  });

  it("seeds a nightly/manual, non-blocking mutation workflow when opted in", () => {
    const res = installWorkflows({ projectDir: dir, language: "javascript", mutation: true });
    expect(res.workflows.map((w) => w.file)).toContain(mutFile);
    const parsed = yaml.load(read(mutFile));
    // Never a PR gate: only schedule + manual dispatch.
    expect(parsed.on.schedule).toBeTruthy();
    expect(parsed.on).toHaveProperty("workflow_dispatch");
    expect(parsed.on).not.toHaveProperty("pull_request");
    const step = parsed.jobs.mutation.steps.find((s) => s["continue-on-error"]);
    expect(step["continue-on-error"]).toBe(true);
    expect(read(mutFile)).toContain("kj mutate");
  });

  it("omits the mutation workflow for a stack without a JSON report (go)", () => {
    const res = installWorkflows({ projectDir: dir, language: "go", mutation: true });
    expect(res.workflows.map((w) => w.file)).not.toContain(mutFile);
  });

  // KJC-BUG-0131 (issue #1330): npm ci in a pnpm repo kills every PR check.
  it("a pnpm repo installs with pnpm and lints through pnpm", () => {
    writeFileSync(join(dir, "pnpm-lock.yaml"), "");
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "x", bin: { x: "cli.js" }, scripts: { lint: "eslint ." } }));
    installWorkflows({ projectDir: dir, language: "javascript", mutation: true });
    const q = read(join(".github", "workflows", "kj-quality.yml"));
    expect(q).toContain("corepack enable");
    expect(q).toContain("pnpm install --frozen-lockfile");
    expect(q).toContain("pnpm run -s lint");
    expect(q).not.toContain("npm ci");
    expect(read(join(".github", "workflows", "kj-pack-smoke.yml"))).not.toContain("npm ci");
    expect(read(mutFile)).not.toContain("npm ci");
  });

  // KJC-BUG-0137 (issue #1357): `--if-present` let the gate disarm itself when
  // the script was missing — silently green, the opposite of the local hook.
  // Now the lint step only exists when the project HAS a lint script at harden
  // time, and when it exists it ENFORCES.
  it("a repo with a lint script gets an enforcing lint step — never --if-present (KJC-BUG-0137)", () => {
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "x", scripts: { lint: "eslint ." } }));
    installWorkflows({ projectDir: dir, language: "javascript" });
    const q = read(join(".github", "workflows", "kj-quality.yml"));
    expect(q).toContain("- run: npm run -s lint");
    expect(q).not.toContain("--if-present");
  });

  it("a repo without a lint script gets NO lint step — a gate that exists always enforces", () => {
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "x" }));
    installWorkflows({ projectDir: dir, language: "javascript" });
    const q = read(join(".github", "workflows", "kj-quality.yml"));
    expect(q).not.toContain("lint");
    expect(q).toContain("npm test");
  });

  it("a yarn repo installs with yarn; no lockfile keeps npm ci", () => {
    writeFileSync(join(dir, "yarn.lock"), "");
    installWorkflows({ projectDir: dir, language: "typescript" });
    const q = read(join(".github", "workflows", "kj-quality.yml"));
    expect(q).toContain("yarn install --frozen-lockfile");
    expect(q).not.toContain("npm ci");
    const plain = mkdtempSync(join(tmpdir(), "kj-wf-npm-"));
    installWorkflows({ projectDir: plain, language: "javascript" });
    expect(readFileSync(join(plain, ".github", "workflows", "kj-quality.yml"), "utf8")).toContain("npm ci");
    rmSync(plain, { recursive: true, force: true });
  });

  it("mutation workflow is idempotent", () => {
    installWorkflows({ projectDir: dir, language: "python", mutation: true });
    const res = installWorkflows({ projectDir: dir, language: "python", mutation: true });
    expect(res.workflows.find((w) => w.file === mutFile).action).toBe("unchanged");
  });
});

// KJC-BUG-0136 (issue #1374) — a mutable action tag lets its owner run
// arbitrary code inside every hardened repo's CI. Every generated workflow
// pins actions to a full commit SHA with the version in a comment — the
// practice kj audit itself demands (semgrep github-actions-mutable-action-tag).
describe("pinned actions — no mutable tags in generated workflows (KJC-BUG-0136)", () => {
  it("every `uses:` in every template is pinned to a 40-hex SHA with a version comment", async () => {
    const t = await import("../../src/harden/workflow-templates.js");
    const flat = (w) => {
      if (!w) return "";
      return typeof w === "string" ? w : (w.content ?? Object.values(w).join("\n"));
    };
    const corpora = [
      t.NO_AI_ATTRIBUTION_WORKFLOW,
      t.SHRINK_BUDGET_WORKFLOW,
      t.packSmokeWorkflow("npm"),
      t.packSmokeWorkflow("pnpm"),
      ...["node", "python", "go", "php"].map((lang) => flat(t.qualityWorkflowFor(lang))),
      ...["node", "python"].map((lang) => flat(t.mutationWorkflowFor(lang))),
    ].join("\n");
    const uses = corpora.split("\n").filter((l) => l.includes("uses:"));
    expect(uses.length).toBeGreaterThan(0);
    for (const line of uses) {
      expect(line).toMatch(/uses: [\w.-]+\/[\w.-]+@[0-9a-f]{40} # v/);
      expect(line).not.toMatch(/@v\d/);
    }
  });

  // STW-E (KJC-TSK-0793): the scheduled Action is OPT-IN (steward.action:
  // true) and carries the same discipline as every generated workflow.
  it("the steward workflow is pinned, scheduled, dispatchable, and publishes the report", async () => {
    const t = await import("../../src/harden/workflow-templates.js");
    const body = t.stewardWorkflowFor("4.22.0", "karajan-code");
    expect(body).toMatch(/schedule:/);
    expect(body).toMatch(/workflow_dispatch/);
    expect(body).toMatch(/karajan-code@4\.22\.0/);
    expect(body).toMatch(/kj steward sweep/);
    for (const line of body.split("\n").filter((l) => l.includes("uses:"))) {
      expect(line).toMatch(/@[0-9a-f]{40} # v/);
    }
  });

  // KJC-TSK-0795 AC4 (epic KJC-PCS-0082) — measured in GREBLA: a 414-line
  // budget warning that was almost all pnpm-lock.yaml. Generated weight
  // nobody wrote must not count against anyone's budget.
  it("the generated shrink budget excludes lockfiles and generated output", async () => {
    const t = await import("../../src/harden/workflow-templates.js");
    for (const p of ["*.lock", "package-lock.json", "pnpm-lock.yaml", "npm-shrinkwrap.json", "dist/**", "build/**", "coverage/**", "**/*.snap", "**/__snapshots__/**"]) {
      expect(t.SHRINK_BUDGET_WORKFLOW).toContain(`':!${p}'`);
    }
  });
});
