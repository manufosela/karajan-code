// HU-5032 (ADR 0069): a hook whose template is newer than the base's judges is sealed in two steps.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { hardenCommand } from "../../src/commands/harden.js";
import { installHooks, renderCanonicalHook } from "../../src/harden/harden-engine.js";
import { handEditDetector } from "../../src/harden/hand-edit.js";
import { SHEBANG, TEMPLATE_SINCE } from "../../src/harden/hook-templates.js";
import { PROVENANCE_FILE } from "../../src/harden/supervisor-commit.js";
import { verifiedSupervisorFiles } from "../../src/policy/supervisor-verify.js";

const sha256 = (text) => createHash("sha256").update(text).digest("hex");
const OLD = { test: "npm run old-suite" }; // another pre-push: what the base's kj rendered
const NEW = { test: "npm test" }; // the project's current settings
const OLDER_JUDGE = [5, 40, 0];
const V540 = {
  "{}": "4778d6f623cf2c7f26f6254053bb839b8bfb080caeaddc97f83140f28abbede6",
  [JSON.stringify(NEW)]: "6e64be6b939e7c44231bbf7e533910ea9d960a720dd04d67807d71f4b757422d",
};
let repo;
const hookPath = () => join(repo, ".karajan", "hooks", "pre-push");
const read = () => readFileSync(hookPath(), "utf8");
const prePush = (res) => res.hooks.find((h) => h.hook === "pre-push");
const managedBody = (content) => {
  const lines = content.split("\n");
  const at = (mark) => lines.findIndex((l) => l.includes(`${mark} kj:managed:hook:pre-push`));
  return lines.slice(at(">>>") + 1, at("<<<")).join("\n");
};

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "kj-since-"));
  execFileSync("git", ["init", "-q"], { cwd: repo });
});
afterEach(() => rmSync(repo, { recursive: true, force: true }));

// Changing a hook template means bumping its TEMPLATE_SINCE to the release that ships it, and updating
// the hash pinned here: a judge older than that release cannot render the new template.
describe("TEMPLATE_SINCE", () => {
  it.each([["pre-push", "5.41.0", "d1a79ab508d60d38098fe2f01c8efce51d1586ed63f5d3fea97fbfa08d51fd12"]])("pins the %s template that exists since kj %s", (hook, since, hash) => {
    expect(TEMPLATE_SINCE[hook]).toBe(since);
    expect(sha256(renderCanonicalHook(hook, {}))).toBe(hash);
  });

  // Computed with kj 5.40.0's own render (git show v5.40.0:src/harden/hook-templates.js).
  it.each([[{}], [NEW]])("with previousTemplate, renders the pre-push of kj 5.40.0 for cmds %j", (cmds) => {
    expect(sha256(renderCanonicalHook("pre-push", { cmds, previousTemplate: { "pre-push": true } }))).toBe(V540[JSON.stringify(cmds)]);
  });
});

describe("installHooks with the base's judges on an older kj (HU-5032)", () => {
  it("writes the hook with the previous template and the current settings, which the verifier recomputes", async () => {
    await installHooks({ projectDir: repo, cmds: OLD });
    const res = await installHooks({ projectDir: repo, cmds: NEW, judgeVersion: OLDER_JUDGE });
    expect(prePush(res).action).toBe("deferred");
    expect(res.generation.previousTemplate).toEqual({ "pre-push": true });
    expect(sha256(read())).toBe(V540[JSON.stringify(NEW)]);
    expect(res.generation.bodySha256["pre-push"]).toBe(sha256(managedBody(read())));
    const files = [{ file: ".karajan/hooks/pre-push", sha256: sha256(read()) }];
    writeFileSync(join(repo, PROVENANCE_FILE), JSON.stringify({ kj_version: "9.9.9", generation: res.generation, files }));
    expect(verifiedSupervisorFiles({ projectDir: repo }).files.has(".karajan/hooks/pre-push")).toBe(true);
  });

  it.each([
    ["the judges run the kj that ships it", [5, 41, 0]],
    ["the base has no judge workflows", null],
  ])("writes the new template when %s", async (_, judgeVersion) => {
    await installHooks({ projectDir: repo, cmds: OLD });
    const res = await installHooks({ projectDir: repo, judgeVersion });
    expect(prePush(res).action).toBe("updated");
    expect(read()).toBe(renderCanonicalHook("pre-push", {}));
    expect(res.generation).not.toHaveProperty("previousTemplate");
  });

  it("writes a hook that does not exist yet with the previous template, deferred", async () => {
    const res = await installHooks({ projectDir: repo, judgeVersion: OLDER_JUDGE });
    expect(prePush(res).action).toBe("deferred");
    expect(sha256(read())).toBe(V540["{}"]);
    expect(read()).toBe(renderCanonicalHook("pre-push", res.generation));
  });

  it("a hook edited by hand stays kept-edited, not deferred", async () => {
    const { generation } = await installHooks({ projectDir: repo, cmds: OLD });
    writeFileSync(join(repo, PROVENANCE_FILE), JSON.stringify({ kj_version: "5.41.0", generation, files: [] }));
    writeFileSync(hookPath(), read().replace("npm run old-suite", "npm run my-suite"));
    expect(prePush(await installHooks({ projectDir: repo, judgeVersion: OLDER_JUDGE })).action).toBe("kept-edited");
  });

  it("kj harden reads the judges' kj from the base and says the hook comes in two steps", async () => {
    const git = (...args) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", ...args], { cwd: repo });
    mkdirSync(join(repo, ".github", "workflows"), { recursive: true });
    writeFileSync(join(repo, ".github", "workflows", "kj-verdicts.yml"), "- run: npm install karajan-code@5.40.0\n");
    git("checkout", "-q", "-b", "main");
    git("add", ".github");
    git("commit", "-q", "--no-verify", "-m", "chore: judges");
    await installHooks({ projectDir: repo, cmds: OLD });
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    await hardenCommand({ projectDir: repo, config: false, ci: false, guidelines: false, dryRun: true, logger });
    expect(logger.warn.mock.calls.map(([l]) => l).filter((l) => l.includes("two steps"))).toEqual([
      "⚠ the pre-push changes in two steps because the base branch's judges run kj 5.40.0, which cannot verify the new one: merge this seal PR (it moves the judges to this kj), then run kj harden again to bring the new pre-push.",
    ]);
  });

  it("a deferred hook is not taken for a hand edit once sealed, so the next harden brings the new one", async () => {
    await installHooks({ projectDir: repo, cmds: OLD });
    const { generation } = await installHooks({ projectDir: repo, judgeVersion: OLDER_JUDGE });
    const files = [{ file: ".karajan/hooks/pre-push", sha256: sha256(read()) }];
    writeFileSync(join(repo, PROVENANCE_FILE), JSON.stringify({ kj_version: "5.41.0", generation, files }));
    expect(handEditDetector(repo, renderCanonicalHook, `${SHEBANG}\nset -e\n`)("pre-push", read())).toBe(false);
    expect(prePush(await installHooks({ projectDir: repo, judgeVersion: [5, 41, 0] })).action).toBe("updated");
  });
});
