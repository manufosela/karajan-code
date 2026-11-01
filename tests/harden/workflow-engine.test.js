import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import yaml from "js-yaml";
import * as prettier from "prettier";
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
    // Fail-loud (codex catch, KJC-TSK-0818): an unresolvable base range must
    // FAIL the job — swallowing it would pass the scan on an empty corpus.
    expect(text).not.toContain("|| true");
    expect(text).toContain("cannot resolve origin/");
    // KJC-BUG-0164: the PR body is attribution surface too — via env (never
    // interpolated into the script: untrusted text), scanned with the pattern.
    expect(text).toContain("PR_BODY: ${{ github.event.pull_request.body }}");
    expect(text).toContain("AI attribution detected in the PR body");
  });

  it("is idempotent", () => {
    installWorkflows({ projectDir: dir });
    const res = installWorkflows({ projectDir: dir });
    expect(res.workflows[0].action).toBe("unchanged");
  });

  // KJC-BUG-0182: the pre-commit's format:check rejected the workflows harden
  // had just written (prettier wants a blank line between a block scalar and
  // the closing marker). Every workflow harden can write, with every extra on,
  // must already be what prettier would print.
  it("writes every workflow exactly as prettier formats it", async () => {
    mkdirSync(join(dir, ".karajan"), { recursive: true });
    writeFileSync(join(dir, ".karajan", "policy.yml"), "rules: []\n");
    writeFileSync(join(dir, ".karajan", "kj.config.yml"), "steward:\n  action: true\n");
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "x", bin: { x: "cli.js" }, scripts: { lint: "eslint ." } }));
    const res = installWorkflows({ projectDir: dir, language: "javascript", profile: "strict", mutation: true, kjVersion: "9.9.9" });
    expect(res.workflows.length).toBeGreaterThanOrEqual(7);
    for (const wf of res.workflows) {
      const text = read(wf.file);
      expect(await prettier.format(text, { parser: "yaml" }), wf.file).toBe(text);
    }
  });

  // KJC-BUG-0399: the PR's own code must never judge the PR. The policy check ran
  // `node bin/kj.js` from the PR checkout, so a PR could rewrite the judge and pass.
  it("the policy check runs the base branch's kj on the PR as data, never the PR's own kj", () => {
    mkdirSync(join(dir, ".karajan"), { recursive: true });
    writeFileSync(join(dir, ".karajan", "policy.yml"), "rules: []\n");
    installWorkflows({ projectDir: dir, kjVersion: "9.9.9" });
    const text = read(".github/workflows/kj-policy.yml");
    expect(text).not.toMatch(/node bin\/kj\.js/);
    // The base ref is fetched explicitly: a missing ref must not fall back to npx in silence.
    expect(text.indexOf('git fetch --no-tags origin "${BASE_REF}:refs/remotes/origin/${BASE_REF}"')).toBeLessThan(text.indexOf("git cat-file"));
    expect(text).toContain('git worktree add --detach "$JUDGE" "origin/${BASE_REF}"');
    expect(text).toContain('KJ="node $JUDGE/bin/kj.js"');
    expect(text).toContain('$KJ policy check --range "origin/${BASE_REF}...HEAD" --strict');
  });

  // KJC-BUG-0419 (GHSA-3xrh-frxv-mwxr): on `pull_request` GitHub runs the YAML of the
  // PR, so a PR could rewrite this very workflow (exit 0, another kj) and pass. The
  // YAML and the judge must come from the base; the PR is fetched and read, never run.
  it("the policy workflow runs from the base branch and treats the PR only as data", () => {
    mkdirSync(join(dir, ".karajan"), { recursive: true });
    writeFileSync(join(dir, ".karajan", "policy.yml"), "rules: []\n");
    installWorkflows({ projectDir: dir, kjVersion: "9.9.9" });
    const text = read(".github/workflows/kj-policy.yml");
    const wf = yaml.load(text);
    expect(Object.keys(wf.on)).toEqual(["pull_request_target"]);
    expect(wf.permissions).toEqual({ contents: "read" });
    const step = wf.jobs["policy-check"].steps.find((s) => s.run);
    expect(step.env.PR_NUMBER).toBe("${{ github.event.pull_request.number }}");
    expect(step.run).not.toContain("${{");
    // No npx: it would resolve config from whatever directory it runs in.
    expect(step.run).not.toMatch(/\bnpx\b/);
    expect(step.run).toContain('git fetch --no-tags origin "+refs/pull/${PR_NUMBER}/head:refs/remotes/origin/kj-pr-head"');
    expect(step.run).toContain("npm install --no-save --ignore-scripts --no-audit --no-fund karajan-code@9.9.9");
    expect(step.run).toContain('KJ="node $JUDGE/node_modules/karajan-code/bin/kj.js"');
    // The PR is checked out apart, after the judge is installed, and only judged there.
    const afterPr = step.run.slice(step.run.indexOf('cd "$PR_TREE"'));
    expect(step.run.indexOf('git worktree add --detach "$PR_TREE" origin/kj-pr-head')).toBeGreaterThan(step.run.indexOf("fi"));
    expect(afterPr.trim().split("\n")).toEqual(['cd "$PR_TREE"', '$KJ policy check --range "origin/${BASE_REF}...HEAD" --strict']);
  });

  // KJC-BUG-0424: the PR that moves the trigger gets no policy-check at all (the base's
  // YAML listens to pull_request, the new one to pull_request_target). Harden says so.
  it("warns when it moves an existing policy workflow from pull_request to pull_request_target", () => {
    mkdirSync(join(dir, ".karajan"), { recursive: true });
    writeFileSync(join(dir, ".karajan", "policy.yml"), "rules: []\n");
    const wfDir = join(dir, ".github", "workflows");
    mkdirSync(wfDir, { recursive: true });
    writeFileSync(join(wfDir, "kj-policy.yml"), "# >>> kj:managed:wf-policy v1 >>>\nname: Policy\non:\n  pull_request:\njobs: {}\n# <<< kj:managed:wf-policy <<<\n");
    const moved = installWorkflows({ projectDir: dir, kjVersion: "9.9.9" }).workflows.find((w) => w.file.endsWith("kj-policy.yml"));
    expect(moved.action).toBe("updated");
    expect(moved.note).toMatch(/pull_request_target/);
    expect(moved.note).toMatch(/admin/);
    const again = installWorkflows({ projectDir: dir, kjVersion: "9.9.9" }).workflows.find((w) => w.file.endsWith("kj-policy.yml"));
    expect(again.note).toBeUndefined();
  });

  it("does not warn when it seeds the policy workflow for the first time", () => {
    mkdirSync(join(dir, ".karajan"), { recursive: true });
    writeFileSync(join(dir, ".karajan", "policy.yml"), "rules: []\n");
    const seeded = installWorkflows({ projectDir: dir, kjVersion: "9.9.9" }).workflows.find((w) => w.file.endsWith("kj-policy.yml"));
    expect(seeded.action).toBe("inserted");
    expect(seeded.note).toBeUndefined();
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
    expect(text).toContain("shivammathur/setup-php@eb7c497e18156a6bbabfef1d3a82760b9eda3962 # v2");
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

  // KJC-BUG-0309 (#2023): the app lives in a subdirectory and the root has no package.json.
  it("runs the Quality workflow in the language root, with that root's package manager and lint", async () => {
    mkdirSync(join(dir, "app"));
    writeFileSync(join(dir, "app", "package.json"), JSON.stringify({ name: "x", private: true, scripts: { lint: "eslint ." } }));
    writeFileSync(join(dir, "app", "pnpm-lock.yaml"), "");
    installWorkflows({ projectDir: dir, language: "javascript", root: "app" });
    const text = read(join(".github", "workflows", "kj-quality.yml"));
    const job = yaml.load(text).jobs.quality;
    expect(job.defaults).toEqual({ run: { "working-directory": "app" } });
    expect(text).toContain("pnpm install --frozen-lockfile");
    expect(text).toContain("pnpm run -s lint");
    expect(await prettier.format(text, { parser: "yaml" })).toBe(text);
    // the root of the repo needs no defaults; an unsafe root is refused, not written
    installWorkflows({ projectDir: dir, language: "go", root: "." });
    expect(yaml.load(read(join(".github", "workflows", "kj-quality.yml"))).jobs.quality.defaults).toBeUndefined();
    expect(() => installWorkflows({ projectDir: dir, language: "go", root: "a: b\n" })).toThrow(/not a safe directory/);
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

  // KJC-BUG-0450 (#2789): hooks and workflows read the package manager the same way;
  // the packageManager field wins over a lockfile that is not there yet.
  it("packageManager in package.json picks pnpm even before a lockfile exists", () => {
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "x", packageManager: "pnpm@9.12.0", scripts: { lint: "eslint ." } }));
    installWorkflows({ projectDir: dir, language: "javascript" });
    const q = read(join(".github", "workflows", "kj-quality.yml"));
    expect(q).toContain("pnpm install --frozen-lockfile");
    expect(q).not.toContain("npm ci");
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

  // KJC-BUG-0318: and the plan JSON `kj plan share` writes, only directly under
  // .karajan-shared/plans/ (glob magic: `*` does not cross `/`), as loc-budget.js.
  it("the shrink budget leaves out the shared plan JSON and nothing nested under it", async () => {
    const t = await import("../../src/harden/workflow-templates.js");
    const spec = ".karajan-shared/plans/*.json";
    expect(t.SHRINK_BUDGET_WORKFLOW).toContain(`':(glob,exclude)${spec}'`);
    const repo = mkdtempSync(join(tmpdir(), "kj-shared-plans-"));
    try {
      const git = (...a) => execFileSync("git", ["-C", repo, ...a], { encoding: "utf8" });
      git("init", "-q");
      for (const f of [".karajan-shared/plans/p.json", ".karajan-shared/plans/n/x.json", "src/a.js"]) {
        mkdirSync(dirname(join(repo, f)), { recursive: true });
        writeFileSync(join(repo, f), "{}\n");
      }
      git("add", "-A");
      const listed = git("diff", "--cached", "--name-only", "--", ".", `:(glob,exclude)${spec}`).trim().split("\n");
      expect(listed.sort()).toEqual([".karajan-shared/plans/n/x.json", "src/a.js"]);
    } finally { rmSync(repo, { recursive: true, force: true }); }
  });
});
