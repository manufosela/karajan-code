// IDN-C (KJC-TSK-0764, ADR 0005) — identity lock en los hooks de git (tier B,
// cualquier host): pre-commit compara autor/committer (git var) con el email
// declarado del clon; pre-push compara la sesión de gh (hosts.yml) con el
// gh_user declarado. Sin identidad: aviso, no bloqueo. Real sh + git.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { hookBody, SHEBANG } from "../../src/harden/hook-templates.js";
import { fakeKjPath } from "./_fake-kj.js";

let dir, ghDir, destination;
const declare = (gh, email) => {
  fs.mkdirSync(path.join(dir, ".karajan"), { recursive: true });
  fs.writeFileSync(path.join(dir, ".karajan", "identity.local.yml"), `gh_user: ${gh}\ngit_email: ${email}\n`);
};
const hosts = (user) => fs.writeFileSync(path.join(ghDir, "hosts.yml"), `github.com:\n    users:\n        ${user}:\n    user: ${user}\n    git_protocol: ssh\n`);

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-idhooks-"));
  ghDir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-idhooks-gh-"));
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: dir });
  destination = path.join(ghDir, "destination.git");
  execFileSync("git", ["init", "-q", "--bare", destination]);
  for (const [k, v] of [["user.email", "t@t"], ["user.name", "T"], ["commit.gpgsign", "false"], ["core.hooksPath", ".karajan/hooks"]]) execFileSync("git", ["config", k, v], { cwd: dir });
  const hooksDir = path.join(dir, ".karajan", "hooks");
  fs.mkdirSync(hooksDir, { recursive: true });
  for (const hook of ["pre-commit", "pre-push"]) fs.writeFileSync(path.join(hooksDir, hook), `${SHEBANG}\n${hookBody(hook, {})}\n`, { mode: 0o755 });
  execFileSync("git", ["checkout", "-q", "-b", "feat/KJC-TSK-0001-x"], { cwd: dir });
});
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(ghDir, { recursive: true, force: true }); });

// As git calls the hook with refs on stdin: $1 the remote name, $2 its push URL.
const runPrePush = (input, args = ["origin", destination], shFlags = []) => spawnSync("sh", [...shFlags, path.join(dir, ".karajan", "hooks", "pre-push"), ...args], {
  cwd: dir, encoding: "utf8", input, env: { ...process.env, GH_CONFIG_DIR: ghDir },
});
const commit = (env = {}) => {
  fs.writeFileSync(path.join(dir, "f.js"), `// ${Math.random()}\n`);
  execFileSync("git", ["add", "f.js"], { cwd: dir });
  return spawnSync("git", ["commit", "-m", "feat: x"], { cwd: dir, encoding: "utf8", env: { ...process.env, ...env } });
};
const push = (env = {}) => spawnSync("sh", [path.join(dir, ".karajan", "hooks", "pre-push")], { cwd: dir, encoding: "utf8", env: { ...process.env, GH_CONFIG_DIR: ghDir, ...env } });

describe("pre-commit identity lock", () => {
  it("email distinto del declarado: rechaza nombrando ambos; igual: pasa; sin escape (ADR 0015)", () => {
    declare("manufosela", "a@b.c");
    const denied = commit();
    expect(denied.status).not.toBe(0);
    expect(`${denied.stdout}${denied.stderr}`).toMatch(/identity lock.*t@t.*a@b\.c/);
    expect(`${denied.stdout}${denied.stderr}`).not.toContain("KJ_ALLOW");
    expect(commit({ KJ_ALLOW_IDENTITY: "1" }).status).not.toBe(0);
    execFileSync("git", ["config", "user.email", "a@b.c"], { cwd: dir });
    expect(commit().status).toBe(0);
    expect(commit({ GIT_AUTHOR_EMAIL: "zzz@x.y" }).status).not.toBe(0);
  });

  // The advisory is printed only when kj is installed (HU-3530): the test brings its own kj.
  it("sin identidad declarada: aviso, no bloqueo", () => {
    const res = commit({ PATH: fakeKjPath(ghDir, { basePath: process.env.PATH }) });
    expect(res.status).toBe(0);
    expect(`${res.stdout}${res.stderr}`).toMatch(/no identity declared/);
  });
});

describe("pre-push identity lock", () => {
  it("sesion gh distinta de la declarada: rechaza con el switch exacto; igual: pasa; sin hosts.yml: rechaza", () => {
    declare("manufosela", "t@t");
    hosts("manufosela-tribbu");
    const denied = push();
    expect(denied.status).not.toBe(0);
    expect(denied.stdout).toContain("gh auth switch --user manufosela");
    hosts("manufosela");
    expect(push().status).toBe(0);
    fs.rmSync(path.join(ghDir, "hosts.yml"));
    expect(push().status).not.toBe(0);
    expect(push({ KJ_ALLOW_IDENTITY: "1" }).status).not.toBe(0);
  });

  // KJC-BUG-0459: with a per-account gh as the credential helper (ADR 0040), the push goes out as
  // that gh's account, whatever the default gh config says.
  it("reads the config of the gh-<account> credential helper, the account the push goes out as", () => {
    // The accounts guide: gh-<account> runs gh with GH_CONFIG_DIR=~/.config/gh-<account>.
    const xdg = fs.mkdtempSync(path.join(os.tmpdir(), "kj-idhooks-xdg-"));
    fs.mkdirSync(path.join(xdg, "gh-acme"));
    fs.writeFileSync(path.join(xdg, "gh-acme", "hosts.yml"), "github.com:\n    user: manufosela-tribbu\n");
    try {
      for (const v of ["", "!/home/someone/.local/bin/gh-acme auth git-credential"]) {
        execFileSync("git", ["config", "--add", "credential.https://github.com.helper", v], { cwd: dir });
      }
      hosts("manufosela");
      declare("manufosela-tribbu", "t@t");
      expect(push({ XDG_CONFIG_HOME: xdg }).status).toBe(0);
      declare("manufosela", "t@t");
      const denied = push({ XDG_CONFIG_HOME: xdg });
      expect(denied.status).not.toBe(0);
      expect(denied.stdout).toContain("manufosela-tribbu");
    } finally {
      fs.rmSync(xdg, { recursive: true, force: true });
    }
  });

  // KJC-TSK-1085: a rebase, cherry-pick, merge or tag never ran pre-commit; the
  // push checks every commit it brings against the declared identity.
  it("rechaza un commit del push con otra identidad aunque no pasara por pre-commit", () => {
    declare("manufosela", "t@t");
    hosts("manufosela");
    const pushRefs = () => {
      const sha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: dir, encoding: "utf8" }).trim();
      return runPrePush(`refs/heads/x ${sha} refs/heads/x ${"0".repeat(40)}\n`);
    };
    expect(commit().status).toBe(0);
    expect(pushRefs().status).toBe(0);
    fs.writeFileSync(path.join(dir, "f.js"), "// other\n");
    execFileSync("git", ["add", "f.js"], { cwd: dir });
    execFileSync("git", ["-c", "core.hooksPath=/dev/null", "-c", "user.email=intruder@x.y", "commit", "-q", "-m", "feat: y"], { cwd: dir });
    const denied = pushRefs();
    expect(denied.status).not.toBe(0);
    expect(denied.stdout).toMatch(/identity lock — commit \w+ is authored\/committed as intruder@x\.y intruder@x\.y but this clone is declared as t@t/);
  });

  // KJC-BUG-0436: merging origin/main into a pushed branch brings main's merges (made by
  // GitHub, under another identity). The remote already has them: this push does not.
  it("does not judge commits the remote already has when it updates an existing branch", () => {
    declare("manufosela", "t@t");
    hosts("manufosela");
    const git = (...args) => execFileSync("git", args, { cwd: dir, encoding: "utf8" }).trim();
    expect(commit().status).toBe(0);
    const pushed = git("rev-parse", "HEAD");
    git("update-ref", "refs/remotes/origin/feat/KJC-TSK-0001-x", pushed);
    git("checkout", "-q", "-b", "main-upstream");
    fs.writeFileSync(path.join(dir, "main.js"), "// main\n");
    git("add", "main.js");
    git("-c", "core.hooksPath=/dev/null", "-c", "user.email=github@x.y", "commit", "-q", "-m", "feat: on main");
    git("-c", "core.hooksPath=/dev/null", "push", "-q", destination, "HEAD:refs/heads/main");
    git("checkout", "-q", "feat/KJC-TSK-0001-x");
    git("-c", "core.hooksPath=/dev/null", "-c", "user.email=t@t", "merge", "-q", "--no-ff", "--no-edit", "main-upstream");
    const update = () => runPrePush(`refs/heads/x ${git("rev-parse", "HEAD")} refs/heads/x ${pushed}\n`);
    expect(update().status).toBe(0);
    fs.writeFileSync(path.join(dir, "f.js"), "// intruder\n");
    git("add", "f.js");
    git("-c", "core.hooksPath=/dev/null", "-c", "user.email=intruder@x.y", "commit", "-q", "-m", "feat: y");
    expect(update().stdout).toMatch(/identity lock — commit \w+ is authored\/committed as intruder@x\.y/);
  });

  // HU-4815 (#4808, point 3): a remote tip the clone lacks makes rev-list fail; the loop sat left of
  // `|| exit 1`, set -e never stopped it, and the push went out with no commit checked.
  it("refuses with a message when the commits of the push cannot be listed", () => {
    declare("manufosela", "t@t");
    hosts("manufosela");
    fs.writeFileSync(path.join(dir, "f.js"), "// intruder\n");
    execFileSync("git", ["add", "f.js"], { cwd: dir });
    execFileSync("git", ["-c", "core.hooksPath=/dev/null", "-c", "user.email=intruder@x.y", "commit", "-q", "-m", "feat: y"], { cwd: dir });
    const sha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: dir, encoding: "utf8" }).trim();
    const denied = runPrePush(`refs/heads/x ${sha} refs/heads/x ${"1".repeat(40)}\n`, ["origin", destination], ["-e"]);
    expect(denied.status).not.toBe(0);
    expect(denied.stdout).toMatch(/identity lock — cannot list the commits pushed to refs\/heads\/x.*git fetch/);
  });

  // HU-4994 (#4808, point 4): only what the destination advertises counts as already pushed.
  describe("what the push destination really has", () => {
    const git = (...args) => execFileSync("git", args, { cwd: dir, encoding: "utf8" }).trim();
    const intruderCommit = () => {
      declare("manufosela", "t@t");
      hosts("manufosela");
      expect(commit().status).toBe(0);
      fs.writeFileSync(path.join(dir, "f.js"), "// intruder\n");
      git("add", "f.js");
      git("-c", "core.hooksPath=/dev/null", "-c", "user.email=intruder@x.y", "commit", "-q", "-m", "feat: y");
      return git("rev-parse", "HEAD");
    };
    const pushTo = (url, sha) => runPrePush(`refs/heads/x ${sha} refs/heads/x ${"0".repeat(40)}\n`, ["origin", url]);

    it("checks a commit that only a stale cached remote branch holds", () => {
      const sha = intruderCommit();
      git("update-ref", "refs/remotes/origin/gone", sha);
      const denied = pushTo(destination, sha);
      expect(denied.status).not.toBe(0);
      expect(denied.stdout).toMatch(/identity lock — commit \w+ is authored\/committed as intruder@x\.y/);
    });

    it("passes when the destination already has the commit on another branch", () => {
      const sha = intruderCommit();
      git("-c", "core.hooksPath=/dev/null", "push", "-q", destination, `${sha}:refs/heads/other`);
      expect(pushTo(destination, sha).status).toBe(0);
    });

    it("refuses when the destination cannot be read", () => {
      const bad = path.join(destination, "missing");
      const denied = pushTo(bad, intruderCommit());
      expect(denied.status).not.toBe(0);
      expect(denied.stdout).toContain(`identity lock — cannot read the refs of the push destination (${bad}): `);
    });
  });

  // KJC-BUG-0550 (#3834): the installed hook runs under set -e; a lookup that finds nothing must not end it in silence.
  it("no credential helper for github.com and no hosts.yml: passes or refuses with a message, never a silent exit", () => {
    const pushE = () => spawnSync("sh", ["-e", path.join(dir, ".karajan", "hooks", "pre-push")], {
      cwd: dir, encoding: "utf8", env: { ...process.env, GH_CONFIG_DIR: ghDir, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" },
    });
    declare("manufosela", "t@t");
    hosts("manufosela");
    expect(pushE().status).toBe(0);
    fs.rmSync(path.join(ghDir, "hosts.yml"));
    const denied = pushE();
    expect(denied.status).not.toBe(0);
    expect(denied.stdout).toContain("gh session is none");
  });
});
