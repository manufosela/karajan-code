// KJC-BUG-0164 — la atribución a IA es superficie EN TODAS PARTES, con
// reglas deterministas: el pre-commit escanea las líneas AÑADIDAS del diff
// staged (ejecutado de verdad, no leído), y el workflow cubre cuerpo y
// título de la PR. Las menciones legítimas a herramientas siguen siendo
// legales; la ATRIBUCIÓN no.
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, beforeEach, afterEach } from "vitest";

import { installHooks } from "../../src/harden/harden-engine.js";
import { AI_ATTRIBUTION } from "../../src/harden/hook-templates.js";
import { NO_AI_ATTRIBUTION_WORKFLOW } from "../../src/harden/workflow-templates.js";

let repo;
const git = (args, env = {}) =>
  execFileSync("git", args, { cwd: repo, encoding: "utf8", env: { ...process.env, ...env } });

beforeEach(async () => {
  repo = mkdtempSync(join(tmpdir(), "kj-attrib-"));
  git(["init", "-q", "-b", "main"]);
  git(["config", "user.email", "t@t"]);
  git(["config", "user.name", "t"]);
  git(["commit", "-q", "--allow-empty", "-m", "chore: init", "--no-verify"]);
  git(["checkout", "-q", "-b", "feat/x"]);
  await installHooks({ projectDir: repo });
});

afterEach(() => rmSync(repo, { recursive: true, force: true }));

describe("pre-commit scans ADDED content for AI attribution (KJC-BUG-0164)", () => {
  it("an added line with an attribution footer refuses to commit", () => {
    writeFileSync(join(repo, "CHANGELOG.md"), "## 1.0\n\n🤖 Generated with [Claude Code](https://x)\n");
    git(["add", "CHANGELOG.md"]);
    expect(() => git(["commit", "-q", "-m", "docs: changelog"])).toThrow(/attribution/i);
  });

  it("a legitimate tool MENTION commits fine", () => {
    writeFileSync(join(repo, "notes.md"), "El reviewer del metodo es codex y el coder claude.\n");
    git(["add", "notes.md"]);
    expect(() => git(["commit", "-q", "-m", "docs: notes"])).not.toThrow();
  });

  // KJC-BUG-0170: the generated supervisor hooks CONTAIN the attribution
  // pattern by design (they are the guard). The bootstrap commit that
  // versions .karajan/hooks must not self-detect — the guard excludes them
  // by literal path, like it already excludes its own source in the kj repo.
  it("committing the generated .karajan/hooks does not self-detect (KJC-BUG-0170)", () => {
    git(["add", ".karajan/hooks/pre-commit", ".karajan/hooks/commit-msg"]);
    expect(() => git(["commit", "-q", "-m", "chore: seal supervisor hooks"])).not.toThrow();
  });

  // KJC-BUG-0200 (issue #1772, reported from the field): the harness scripts
  // carry the pattern for the same reason the hooks do — they ARE the guard —
  // but .karajan/harness was added to the product after this exclusion list,
  // so the bootstrap commit that versions them was refused. With kj bootstrap
  // now making the contract commit (4.32.0), this blocks the new path too.
  it("committing the generated .karajan/harness does not self-detect either", async () => {
    const { installSentinelHooks } = await import("../../src/harden/sentinel-hooks.js");
    installSentinelHooks({ projectDir: repo, logger: { info() {}, warn() {} } });
    // KJC-TSK-1208: kj harden copies no guard any more; a project may still hold an older kj's.
    const { placeGuardCopies } = await import("./_guard-copies.js");
    placeGuardCopies(repo);
    git(["add", "--force", ".karajan/harness"]);
    expect(() => git(["commit", "-q", "-m", "chore: bootstrap kj harden harness"])).not.toThrow();
  });
});

// KJC-BUG-0503 (HU-3580): the local hook, kj review and the CI workflow judge
// with ONE list. Every judge refuses the same messages and accepts the same.
describe("one attribution list for every judge (KJC-BUG-0503)", () => {
  const refused = [
    "Co-authored-by: Claude <noreply@anthropic.com>",
    "Co-authored-by: Cursor Agent <cursoragent@cursor.com>",
    "Co-authored-by: Codex <codex@openai.com>",
    "Written with GPT-5",
    "Generated with Gemini",
    "Assisted by Claude",
    "Created by Claude",
    "fix: written by claude",
    "🤖 Generated with [Claude Code](https://claude.com/claude-code)",
  ];
  const accepted = [
    "feat: add the claude provider adapter",
    "docs: explain how copilot reviews work",
    "Co-authored-by: Jane Doe <jane@example.com>",
  ];
  const posixGrep = (msg) => {
    try {
      execFileSync("grep", ["-qiE", AI_ATTRIBUTION], { input: msg });
      return true;
    } catch (error) {
      if (error.status === 1) return false;
      throw error;
    }
  };

  it.each(refused)("refuses %s in JS, in POSIX grep and in the CI workflow", (msg) => {
    expect(new RegExp(AI_ATTRIBUTION, "i").test(msg)).toBe(true);
    expect(posixGrep(msg)).toBe(true);
    expect(NO_AI_ATTRIBUTION_WORKFLOW).toContain(`pat='${AI_ATTRIBUTION}'`);
  });

  it.each(accepted)("accepts %s", (msg) => {
    expect(new RegExp(AI_ATTRIBUTION, "i").test(msg)).toBe(false);
    expect(posixGrep(msg)).toBe(false);
  });

  it("the robot emoji is refused only by the workflow's PR body and title check", () => {
    const prBodyCheck = '| grep -qiE "$pat|generated with \\[?claude|🤖"; then';
    expect(NO_AI_ATTRIBUTION_WORKFLOW).toContain(`"$PR_BODY" "$PR_TITLE" ${prBodyCheck}`);
    expect(NO_AI_ATTRIBUTION_WORKFLOW).toContain('"$msgs" | grep -qiE "$pat"; then');
  });

  it("a code line with the robot emoji is not attribution", () => {
    expect(new RegExp(AI_ATTRIBUTION, "i").test('icon: "🤖"')).toBe(false);
    expect(posixGrep('icon: "🤖"')).toBe(false);
  });

  it("the pattern fits inside a single-quoted shell string", () => {
    expect(AI_ATTRIBUTION).not.toContain("'");
  });
});
