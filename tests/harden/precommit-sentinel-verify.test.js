// KJC-TSK-1205 (ADR 0030): a tampered Sentinel is caught before each commit too,
// not only when the turn ends. The pre-commit block is run as the shell runs it.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { hookBody } from "../../src/harden/hook-templates.js";

const block = () => {
  const lines = hookBody("pre-commit", {}).split("\n");
  const start = lines.findIndex((l) => l.includes("KJC-TSK-1205"));
  const end = lines.findIndex((l, i) => i > start && l === "fi");
  return lines.slice(start, end + 1).join("\n");
};

describe("pre-commit verifies the Sentinel", () => {
  let dir;
  let bin;
  const commit = (verifyExit) => {
    fs.writeFileSync(path.join(bin, "kj"), `#!/bin/sh\n[ "$1 $2" = "sentinel verify" ] && exit ${verifyExit}\nexit 0\n`, { mode: 0o755 });
    return spawnSync("sh", ["-c", block()], { cwd: dir, encoding: "utf8", env: { ...process.env, PATH: `${bin}:/usr/bin:/bin` } });
  };
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-precommit-sentinel-"));
    bin = path.join(dir, "bin");
    fs.mkdirSync(bin);
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("a project with the Sentinel: tampered refuses the commit, intact lets it through", () => {
    fs.mkdirSync(path.join(dir, ".karajan", "harness"), { recursive: true });
    const refused = commit(1);
    expect(refused.status).toBe(1);
    expect(refused.stdout + refused.stderr).toMatch(/kj harden/);
    expect(commit(0).status).toBe(0);
  });

  it("a project without the Sentinel is not asked about it", () => {
    expect(commit(1).status).toBe(0);
  });
});
