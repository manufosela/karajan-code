// HU-3840 — agent worktree folders the test runner does not exclude.
import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { VERDICTS, evaluateAgentWorktreesExcluded } from "../../src/steward/invariants.js";
import { sweepRunnerExcludes } from "../../src/steward/runner-excludes.js";

const dirs = [];
afterAll(() => dirs.forEach((d) => fs.rmSync(d, { recursive: true, force: true })));
const repo = (files, folders = [".claude/worktrees"]) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-agent-wt-"));
  dirs.push(dir);
  for (const f of folders) fs.mkdirSync(path.join(dir, f), { recursive: true });
  for (const [name, body] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), body);
  return dir;
};
const run = (files, folders) => evaluateAgentWorktreesExcluded(sweepRunnerExcludes(repo(files, folders)));
const vitestExclude = (glob) => ({ "vitest.config.js": `export default { test: { exclude: ["**/node_modules/**", ${JSON.stringify(glob)}] } };` });
const jestIgnore = (pattern) => ({ "jest.config.json": JSON.stringify({ testPathIgnorePatterns: [pattern] }) });

describe("evaluateAgentWorktreesExcluded", () => {
  it("no agent folder: ok", () => {
    const r = run({}, []);
    expect(r).toMatchObject({ verdict: VERDICTS.OK, evidence: "no agent worktree folders" });
  });
  it("agent folder and no runner config: not-observable", () => {
    const r = run({});
    expect(r.verdict).toBe(VERDICTS.NOT_OBSERVABLE);
    expect(r.evidence).toBe("no vitest or jest config to check");
  });
  it("vitest config without exclude: broken, naming folder and config", () => {
    const r = run({ "vitest.config.js": "export default { test: { include: ['**/*.test.js'] } };" });
    expect(r.verdict).toBe(VERDICTS.BROKEN);
    expect(r.evidence).toContain(".claude/worktrees in vitest.config.js");
    expect(r.remedy).toContain("exclude agent worktrees from the test runner");
  });
  it("vitest exclude with a glob: ok", () => {
    const r = run({ "vitest.config.ts": "export default { test: { exclude: ['node_modules', '**/.claude/**'] } };" });
    expect(r.verdict).toBe(VERDICTS.OK);
  });
  it("vite.config with a test block is checked, without one it is ignored", () => {
    expect(run({ "vite.config.js": "export default { test: { globals: true } };" }).verdict).toBe(VERDICTS.BROKEN);
    expect(run({ "vite.config.js": "export default {};" }).verdict).toBe(VERDICTS.NOT_OBSERVABLE);
  });
  it("jest key of package.json: ignore patterns ok, missing broken", () => {
    const ok = run({ "package.json": JSON.stringify({ jest: { testPathIgnorePatterns: ["/.claude/"] } }) });
    expect(ok.verdict).toBe(VERDICTS.OK);
    const bad = run({ "package.json": JSON.stringify({ jest: { verbose: true } }) });
    expect(bad.evidence).toContain("package.json (jest)");
  });
  it("a parent folder exclude covers the worktrees", () => {
    const r = run({ "jest.config.json": JSON.stringify({ modulePathIgnorePatterns: ["<rootDir>/.kj"] }) }, [".kj/worktrees"]);
    expect(r.verdict).toBe(VERDICTS.OK);
  });
  it("one config excluding and another not: broken", () => {
    const r = run({
      "vitest.config.js": "export default { test: { exclude: ['.claude'] } };",
      "jest.config.js": "module.exports = {};",
    });
    expect(r.verdict).toBe(VERDICTS.BROKEN);
    expect(r.evidence).toContain("jest.config.js");
    expect(r.evidence).not.toContain("vitest.config.js");
  });
  it.each([".claude/**", "./.claude/", "**/.claude", "**/{.claude,.kj}/**", ".claude/worktrees/*", "**/worktrees/**"])(
    "the vitest glob %s covers the folder or its parent: ok", (glob) => expect(run(vitestExclude(glob)).verdict).toBe(VERDICTS.OK));
  // The review's case: an entry that merely CONTAINS `.claude` excludes nothing of the agent's tree.
  it.each(["src/.claude-fixtures/**", "**/.claude-cache/**", "docs/.claude/**", "**/.claude/*.md", "!.claude/**", "{**/.claude/**,x}"])(
    "the vitest glob %s does not cover .claude/worktrees: broken", (glob) => expect(run(vitestExclude(glob)).verdict).toBe(VERDICTS.BROKEN));
  it("an exclude outside the test block (coverage.exclude) does not stop the runner: broken", () =>
    expect(run({ "vitest.config.ts": "export default { test: { coverage: { exclude: ['.claude/**'] } } };" }).verdict).toBe(VERDICTS.BROKEN));
  it("jest patterns are regexes on the absolute path: the folder ok, a near miss broken", () => {
    expect(run(jestIgnore(String.raw`/\.claude/`)).verdict).toBe(VERDICTS.OK);
    expect(run(jestIgnore(String.raw`/src/\.claude-fixtures/`)).verdict).toBe(VERDICTS.BROKEN);
    expect(run(jestIgnore("/lane/")).verdict).toBe(VERDICTS.BROKEN); // one lane's name is not every lane
  });
  it("a runner config that does not parse: not-observable, naming it", () => {
    const r = run({ "vitest.config.ts": "export default { test: {" });
    expect(r.verdict).toBe(VERDICTS.NOT_OBSERVABLE);
    expect(r.evidence).toContain("vitest.config.ts could not be parsed");
  });
});
