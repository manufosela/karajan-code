// HU-4699 (KJC-BUG-0648): enroll-phone commits the roster through the repo's hooks, never around
// them (no --no-verify): a hook that refuses the commit stops it, and its reason reaches the person.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { identityCommand } from "../../src/commands/identity.js";

const human = { env: {}, ttyHuman: true, ancestry: { readProc: () => ({ ppid: 1, cmd: "bash" }) }, confirm: (nonce) => nonce };

let dir, home, lines, gitEnv;
const git = (...args) => execFileSync("git", ["-C", dir, ...args], { encoding: "utf8", env: { ...process.env, ...gitEnv } });
const enroll = () => identityCommand({
  action: "enroll-phone", config: { projectDir: dir }, flags: { publicKeyBase64: Buffer.alloc(32, 7).toString("base64"), label: "mine" },
  deps: { log: (l) => lines.push(l), home, ...human, gitEnv },
});

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-enroll-hooks-"));
  home = fs.mkdtempSync(path.join(os.tmpdir(), "kj-enroll-hooks-home-"));
  lines = [];
  // The machine's global git config (and the hooks dir it may name) stays out: only this repo's hooks run.
  gitEnv = { GIT_CONFIG_GLOBAL: path.join(home, "no-global-config"), GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
  git("init", "-q", "-b", "chore/enroll");
  fs.writeFileSync(path.join(dir, "README.md"), "x\n");
  git("add", "README.md");
  git("commit", "-q", "-m", "base");
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(home, { recursive: true, force: true });
});

describe("kj identity enroll-phone and the repo's hooks", () => {
  it("a pre-commit hook that refuses the roster commit stops it, and its reason is named", async () => {
    fs.writeFileSync(path.join(dir, ".git", "hooks", "pre-commit"), "#!/bin/sh\necho 'kj: no approved cross-AI verdict for the staged diff'\nexit 1\n", { mode: 0o755 });
    expect(await enroll()).toBe(1);
    expect(git("log", "-1", "--format=%s").trim()).toBe("base");
    expect(lines.join("\n")).toContain("no se pudo commitear el padrón (kj: no approved cross-AI verdict for the staged diff)");
  });
});
