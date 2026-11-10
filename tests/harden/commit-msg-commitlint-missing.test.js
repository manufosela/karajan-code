// HU-3729: under commit-convention=project the header check belongs to the project's commitlint.
// Without it installed the hook cannot check the header: it says so (stderr) and still lets the commit through.
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { hookBody } from "../../src/harden/hook-templates.js";

let dir;
const NOTICE = /header check skipped: commitlint not found.*npm install.*CI will still check/s;

// A fake kj that answers the convention; a fake commitlint that accepts only a "feat:" header.
const setup = (convention) => {
  mkdirSync(join(dir, "hooks"));
  writeFileSync(join(dir, "hooks", "commit-msg"), `#!/bin/sh\n${hookBody("commit-msg", {}, {})}\n`, { mode: 0o755 });
  mkdirSync(join(dir, "bin"));
  writeFileSync(join(dir, "bin", "kj"), `#!/bin/sh\n[ "$1 $2" = "gates value" ] && echo ${convention} && exit 0\nexit 1\n`, { mode: 0o755 });
};
const installCommitlint = () => {
  mkdirSync(join(dir, "node_modules", ".bin"), { recursive: true });
  const bin = join(dir, "node_modules", ".bin", "commitlint");
  writeFileSync(bin, '#!/bin/sh\nhead -n1 "$2" | grep -q "^feat: " || { echo "fake commitlint: bad header"; exit 1; }\n');
  chmodSync(bin, 0o755);
};
const commit = (message) => {
  writeFileSync(join(dir, "MSG"), message);
  const env = { ...process.env, PATH: `${join(dir, "bin")}:${process.env.PATH}` };
  return spawnSync("git", ["commit", "-q", "--allow-empty", "-F", "MSG"], { cwd: dir, encoding: "utf8", env });
};

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "kj-nocl-"));
  const git = (...args) => spawnSync("git", args, { cwd: dir, encoding: "utf8" });
  git("init", "-q");
  git("config", "core.hooksPath", join(dir, "hooks"));
  git("config", "user.name", "t");
  git("config", "user.email", "t@example.com");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("commit-msg hook: commitlint under commit-convention=project", () => {
  it("(a) absent: prints the notice on stderr and exits 0", () => {
    setup("project");
    const res = commit("whatever header\n");
    expect(res.status).toBe(0);
    expect(res.stderr).toMatch(NOTICE);
  });

  it("(b) present and a bad header: refuses as before", () => {
    setup("project");
    installCommitlint();
    const res = commit("bad header\n");
    expect(res.status).not.toBe(0);
    expect(res.stdout + res.stderr).toMatch(/fake commitlint: bad header/);
  });

  it("(c) present and a good header: accepts silently", () => {
    setup("project");
    installCommitlint();
    const res = commit("feat: add thing\n");
    expect(res.status).toBe(0);
    expect(res.stderr).not.toMatch(/commitlint/);
  });

  it("stays silent under the conventional convention, where the built-in header check runs", () => {
    setup("conventional");
    const res = commit("feat: add thing\n");
    expect(res.status).toBe(0);
    expect(res.stderr).not.toMatch(/commitlint/);
  });
});
