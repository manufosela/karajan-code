// IDN-B (KJC-TSK-0763, ADR 0005) — identity lock en el Sentinel, contra el
// hook GENERADO (hosts.yml falso vía GH_CONFIG_DIR, git config real).

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync, execSync } from "node:child_process";
import { installSentinelHooks } from "../../src/harden/sentinel-hooks.js";

let dir, gate, ghDir;
const run = (command, env = {}) =>
  spawnSync("node", [gate], {
    input: JSON.stringify({ session_id: "s1", tool_name: "Bash", tool_input: { command } }),
    encoding: "utf8", cwd: dir, env: { ...process.env, GH_CONFIG_DIR: ghDir, ...env },
  });
const activeGh = (user) => fs.writeFileSync(path.join(ghDir, "hosts.yml"), `github.com:\n    users:\n        ${user}:\n    user: ${user}\n    git_protocol: ssh\n`);
const declare = (gh, email) => {
  fs.mkdirSync(path.join(dir, ".karajan"), { recursive: true });
  fs.writeFileSync(path.join(dir, ".karajan", "identity.local.yml"), `gh_user: ${gh}\ngit_email: ${email}\ndeclared_at: 2026-08-20T00:00:00.000Z\n`);
};

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-sentinel-id-"));
  ghDir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-gh-"));
  execSync(
    "git init -q -b main && git config user.email a@b.c && git config user.name t && git commit -q --allow-empty -m init && git checkout -q -b feat/KJC-TSK-0001-demo",
    { cwd: dir },
  );
  installSentinelHooks({ projectDir: dir });
  gate = path.join(dir, ".karajan", "harness", "pretooluse-sentinel.mjs");
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(ghDir, { recursive: true, force: true });
});

describe("identity lock — gh", () => {
  it("cuenta activa distinta de la declarada: deny nombrando ambas y el switch exacto; con el switch como prefijo pasa", () => {
    declare("manufosela", "a@b.c");
    activeGh("manufosela-tribbu");
    const denied = run("gh issue comment 1 --body hola");
    expect(denied.status).toBe(2);
    expect(denied.stderr).toContain("manufosela-tribbu");
    expect(denied.stderr).toContain("gh auth switch --user manufosela");
    expect(run("gh auth switch --user manufosela && gh issue comment 1 --body hola").status).toBe(0);
    // Los comandos de sesion de gh son el remedio: nunca se bloquean.
    expect(run("gh auth switch --user manufosela").status).toBe(0);
    expect(run("gh auth status").status).toBe(0);
    // Una mencion textual de gh no es un comando gh; con la cuenta correcta, pasa.
    expect(run("grep -n gh notas.txt").status).toBe(0);
    activeGh("manufosela");
    expect(run("gh pr list --limit 3").status).toBe(0);
  });

  it("sin identidad declarada: fail-closed para gh y git mutador, pidiendo kj identity set; escape KJ_ALLOW_IDENTITY=1 por prefijo", () => {
    activeGh("manufosela");
    const gh = run("gh issue list");
    expect(gh.status).toBe(2);
    expect(gh.stderr).toContain("kj identity set");
    expect(run("git push origin x").status).toBe(2);
    expect(run("git status").status).toBe(0);
    expect(run("KJ_ALLOW_IDENTITY=1 gh issue list").status).toBe(0);
    const st = JSON.parse(fs.readFileSync(path.join(dir, ".karajan", "harness", "sentinel-state.json"), "utf8"));
    expect(st.escape_events.some((e) => e.escape === "KJ_ALLOW_IDENTITY")).toBe(true);
    // Sin sesion gh (hosts.yml ausente) tampoco se adivina: deny.
    declare("manufosela", "a@b.c");
    fs.rmSync(path.join(ghDir, "hosts.yml"));
    expect(run("gh issue list").stderr).toMatch(/no session/);
  });

  it("un shell envoltorio no esconde el payload (catch de codex): bash -c / eval / env se escanean por dentro", () => {
    declare("manufosela", "a@b.c");
    activeGh("manufosela-tribbu");
    expect(run("bash -lc 'gh issue comment 1 --body hola'").status).toBe(2);
    expect(run("bash -lc 'echo $(git push origin main)'").status).toBe(2);
    expect(run("sudo -u bob gh pr merge 3").status).toBe(2);
    const wrapped = run("bash -lc 'gh auth switch --user manufosela && gh pr list'");
    expect(wrapped.stderr).toBe("");
    expect(wrapped.status).toBe(0);
  });
});

describe("identity lock — autoria git (IDN-B2)", () => {
  it("commit/tag/merge/rebase/cherry-pick con email efectivo distinto: deny; con -c user.email= del declarado pasa", () => {
    declare("manufosela", "otro@mail.x");
    activeGh("manufosela");
    const denied = run('git commit -m "feat: x"');
    expect(denied.status).toBe(2);
    expect(denied.stderr).toContain("otro@mail.x");
    expect(denied.stderr).toContain("a@b.c");
    expect(run('git -c user.email=otro@mail.x commit -m "feat: x"').status).toBe(0);
    for (const m of ["git tag v1", "git merge feat/y", "git cherry-pick abc", "git rebase main", "git --git-dir .git commit -m x", "git --work-tree . am p.patch"]) expect(run(m).status).toBe(2);
    declare("manufosela", "a@b.c");
    expect(run('git commit -m "feat: x"').status).toBe(0);
  });

  it("todas las fuentes que git honra (catch de codex): env en el comando o en la sesion, --author, y -C otro-repo", () => {
    declare("manufosela", "a@b.c");
    activeGh("manufosela");
    expect(run("GIT_AUTHOR_EMAIL=zzz@x.y git commit -m x").status).toBe(2);
    expect(run('git commit --author="Z <zzz@x.y>" -m x').status).toBe(2);
    expect(run("git commit -m x", { GIT_COMMITTER_EMAIL: "zzz@x.y" }).status).toBe(2);
    // git resuelve la identidad (catch de codex): GIT_CONFIG_* inyectado tambien cuenta
    // (EMAIL no: git solo lo usa como fallback cuando no hay user.email configurado).
    expect(run("GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=user.email GIT_CONFIG_VALUE_0=zzz@x.y git commit -m x").status).toBe(2);
    const other = path.join(dir, "otro");
    // user.name tambien: sin el, git var falla (CI no tiene config global) y el gate deniega por "none".
    execSync(`git init -q ${other} && git -C ${other} config user.email zzz@other.x && git -C ${other} config user.name z`, { cwd: dir });
    expect(run(`git -C ${other} commit -m x`).status).toBe(2);
    expect(run(`git -C ${other} -c user.email=a@b.c commit -m x`).status).toBe(0);
  });
});

describe("identity lock — git push", () => {
  it("push autentica con la sesion de gh, no con user.email (catch de codex): cuenta distinta deny, switch como prefijo pasa; lectura libre", () => {
    declare("manufosela", "a@b.c");
    activeGh("manufosela-tribbu");
    const denied = run("git push -u origin feat/x");
    expect(denied.status).toBe(2);
    expect(denied.stderr).toContain("gh auth switch --user manufosela");
    expect(run("gh auth switch --user manufosela && git push -u origin feat/x").status).toBe(0);
    expect(run("git -C sub -c core.x=1 push origin x").status).toBe(2);
    expect(run("git log --oneline -1").status).toBe(0);
  });
});
