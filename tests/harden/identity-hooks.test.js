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

let dir, ghDir;
const declare = (gh, email) => {
  fs.mkdirSync(path.join(dir, ".karajan"), { recursive: true });
  fs.writeFileSync(path.join(dir, ".karajan", "identity.local.yml"), `gh_user: ${gh}\ngit_email: ${email}\n`);
};
const hosts = (user) => fs.writeFileSync(path.join(ghDir, "hosts.yml"), `github.com:\n    users:\n        ${user}:\n    user: ${user}\n    git_protocol: ssh\n`);

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-idhooks-"));
  ghDir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-idhooks-gh-"));
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: dir });
  for (const [k, v] of [["user.email", "t@t"], ["user.name", "T"], ["commit.gpgsign", "false"], ["core.hooksPath", ".karajan/hooks"]]) execFileSync("git", ["config", k, v], { cwd: dir });
  const hooksDir = path.join(dir, ".karajan", "hooks");
  fs.mkdirSync(hooksDir, { recursive: true });
  for (const hook of ["pre-commit", "pre-push"]) fs.writeFileSync(path.join(hooksDir, hook), `${SHEBANG}\n${hookBody(hook, {})}\n`, { mode: 0o755 });
  execFileSync("git", ["checkout", "-q", "-b", "feat/KJC-TSK-0001-x"], { cwd: dir });
});
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(ghDir, { recursive: true, force: true }); });

const commit = (env = {}) => {
  fs.writeFileSync(path.join(dir, "f.js"), `// ${Math.random()}\n`);
  execFileSync("git", ["add", "f.js"], { cwd: dir });
  return spawnSync("git", ["commit", "-m", "feat: x"], { cwd: dir, encoding: "utf8", env: { ...process.env, ...env } });
};
const push = (env = {}) => spawnSync("sh", [path.join(dir, ".karajan", "hooks", "pre-push")], { cwd: dir, encoding: "utf8", env: { ...process.env, GH_CONFIG_DIR: ghDir, ...env } });

describe("pre-commit identity lock", () => {
  it("email distinto del declarado: rechaza nombrando ambos; igual: pasa; escape KJ_ALLOW_IDENTITY=1", () => {
    declare("manufosela", "a@b.c");
    const denied = commit();
    expect(denied.status).not.toBe(0);
    expect(`${denied.stdout}${denied.stderr}`).toMatch(/identity lock.*t@t.*a@b\.c/);
    expect(commit({ KJ_ALLOW_IDENTITY: "1" }).status).toBe(0);
    execFileSync("git", ["config", "user.email", "a@b.c"], { cwd: dir });
    expect(commit().status).toBe(0);
    expect(commit({ GIT_AUTHOR_EMAIL: "zzz@x.y" }).status).not.toBe(0);
  });

  it("sin identidad declarada: aviso, no bloqueo", () => {
    const res = commit();
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
    expect(push({ KJ_ALLOW_IDENTITY: "1" }).status).toBe(0);
  });
});
