// HU-3521: --exclude removes a root from the stack the hook commands come from, and a generated
// lint/format step whose tool is not on PATH says it was skipped instead of failing every commit.
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveCmds } from "../../src/commands/harden.js";
import { commandsForLanguage } from "../../src/harden/hook-commands.js";
import { hookBody } from "../../src/harden/hook-templates.js";
import { bareToolsPath } from "./_fake-kj.js";

let repo;
let BARE_PATH;
const write = (rel, text = "") => {
  fs.mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true });
  fs.writeFileSync(path.join(repo, rel), text);
};
const preCommit = (cmds, bin = BARE_PATH) => spawnSync("sh", ["-c", hookBody("pre-commit", cmds)], {
  cwd: repo, encoding: "utf8", env: { PATH: bin, HOME: repo, GIT_CONFIG_GLOBAL: "/dev/null" },
});
const fakeTool = (name, exitCode) => {
  const bin = fs.mkdtempSync(path.join(repo, "bin-"));
  fs.writeFileSync(path.join(bin, name), `#!/bin/sh\nexit ${exitCode}\n`, { mode: 0o755 });
  return `${bin}:${BARE_PATH}`;
};
const out = (res) => `${res.stdout}${res.stderr}`;

beforeEach(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), "kj-missing-tool-"));
  execFileSync("git", ["init", "-q", "-b", "main", "--template="], { cwd: repo });
  BARE_PATH = bareToolsPath(repo); // no go/gofmt/kj, whatever the machine has installed
});
afterEach(() => fs.rmSync(repo, { recursive: true, force: true }));

describe("resolveCmds honours the scope of the run", () => {
  it("a Go file only under the excluded path does not make the repo Go", async () => {
    write("scripts/go.mod", "module helper\n");
    const scope = { exclude: ["scripts"] };
    expect(await resolveCmds(repo, null, scope)).toEqual({});
  });

  it("a Gradle repo with a Go helper under the excluded path gets no go commands", async () => {
    write("settings.gradle.kts", "");
    write("scripts/go.mod", "module helper\n");
    const cmds = await resolveCmds(repo, "gradle", { exclude: ["scripts"] });
    expect(JSON.stringify(cmds)).not.toMatch(/go vet|gofmt/);
  });
});

describe("pre-commit with a lint/format tool that is not installed", () => {
  const goCmds = commandsForLanguage("go");

  it("names the skipped step and its tool, and exits 0", () => {
    const res = preCommit(goCmds);
    expect(res.status).toBe(0);
    expect(out(res)).toMatch(/lint skipped: go not found/);
    expect(out(res)).toMatch(/format skipped: gofmt not found/);
  });

  it("a tool that exists and finds a violation still fails the commit", () => {
    const res = preCommit(goCmds, fakeTool("go", 1));
    expect(res.status).toBe(1);
    expect(out(res)).toMatch(/lint failed/);
  });

  it("a tool that exists and passes does not print a skip", () => {
    const res = preCommit({ lint: "go vet ./..." }, fakeTool("go", 0));
    expect(res.status).toBe(0);
    expect(out(res)).not.toMatch(/skipped/);
  });
});
