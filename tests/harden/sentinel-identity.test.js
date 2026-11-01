// IDN-B (KJC-TSK-0763, ADR 0005) — identity lock en el Sentinel, contra el
// hook GENERADO (hosts.yml falso vía GH_CONFIG_DIR, git config real).

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync, execSync } from "node:child_process";
import { installSentinelHooks } from "../../src/harden/sentinel-hooks.js";
import { placeGuardCopies } from "./_guard-copies.js";

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
  placeGuardCopies(dir);
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

  it("sin identidad declarada: fail-closed para gh y git mutador, pidiendo kj identity set; sin escape (ADR 0015)", () => {
    activeGh("manufosela");
    const gh = run("gh issue list");
    expect(gh.status).toBe(2);
    expect(gh.stderr).toContain("kj identity set");
    expect(gh.stderr).not.toContain("KJ_ALLOW");
    // KJC-TSK-1085: git push is no longer read here; an undeclared clone gets the
    // pre-push hook's advisory (kj harden declares the identity when it installs).
    expect(run("git status").status).toBe(0);
    expect(run("KJ_ALLOW_IDENTITY=1 gh issue list").status).toBe(2);
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

// KJC-BUG-0459: one gh config per account (GH_CONFIG_DIR) and its gh-<account> wrapper are the
// documented setup (ADR 0040); the lock judges the account each command really runs as.
describe("identity lock — per-account gh", () => {
  it("an inline GH_CONFIG_DIR is the config that command reads", () => {
    declare("manufosela-tribbu", "a@b.c");
    activeGh("manufosela");
    const tribbuDir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-gh-tribbu-"));
    fs.writeFileSync(path.join(tribbuDir, "hosts.yml"), "github.com:\n    user: manufosela-tribbu\n");
    try {
      expect(run(`GH_CONFIG_DIR=${tribbuDir} gh pr list`).status).toBe(0);
      expect(run("gh pr list").status).toBe(2);
      // The assignment survives a wrapper: env, sudo... rescan with it (review catch).
      expect(run(`env GH_CONFIG_DIR=${tribbuDir} gh pr list`).status).toBe(0);
      declare("manufosela", "a@b.c");
      expect(run("gh pr list").status).toBe(0);
      expect(run(`env GH_CONFIG_DIR=${tribbuDir} gh pr list`).status).toBe(2);
      // ...and so does one written before the wrapper (review catch).
      expect(run(`GH_CONFIG_DIR=${tribbuDir} env gh pr list`).status).toBe(2);
      expect(run(`GH_CONFIG_DIR=${tribbuDir} bash -lc 'gh pr list'`).status).toBe(2);
      // An inner assignment naming the default dir is still the inner one's choice (review catch).
      expect(run(`GH_CONFIG_DIR=${tribbuDir} env GH_CONFIG_DIR=${ghDir} gh pr list`).status).toBe(0);
      // A gh auth switch moves the default config only; an explicit assignment is not overridden.
      expect(run(`gh auth switch --user manufosela && GH_CONFIG_DIR=${tribbuDir} gh pr list`).status).toBe(2);
    } finally {
      fs.rmSync(tribbuDir, { recursive: true, force: true });
    }
  });

  it("a gh-<account> wrapper is judged by its own config, read and never executed", () => {
    // The accounts guide: gh-<account> runs gh with GH_CONFIG_DIR=~/.config/gh-<account>.
    const xdg = fs.mkdtempSync(path.join(os.tmpdir(), "kj-gh-xdg-"));
    fs.mkdirSync(path.join(xdg, "gh-acme"));
    fs.writeFileSync(path.join(xdg, "gh-acme", "hosts.yml"), "github.com:\n    user: manufosela-tribbu\n");
    const env = { XDG_CONFIG_HOME: xdg };
    try {
      declare("manufosela-tribbu", "a@b.c");
      activeGh("manufosela");
      expect(run("gh-acme pr list", env).status).toBe(0);
      expect(run("/home/someone/.local/bin/gh-acme pr list", env).status).toBe(0);
      declare("manufosela", "a@b.c");
      const denied = run("gh-acme issue comment 1 --body hola", env);
      expect(denied.status).toBe(2);
      expect(denied.stderr).toContain("manufosela-tribbu");
      expect(run("gh-acme auth status", env).status).toBe(0);
      // The documented wrapper sets GH_CONFIG_DIR itself (`GH_CONFIG_DIR=... exec gh`), so an inline
      // assignment does not change its account: still judged by its own config.
      expect(run(`GH_CONFIG_DIR=${ghDir} gh-acme pr list`, env).status).toBe(2);
      // No config for that wrapper: no session, never a guess.
      expect(run("gh-other pr list", env).stderr).toMatch(/no session/);
    } finally {
      fs.rmSync(xdg, { recursive: true, force: true });
    }
  });
});

// KJC-TSK-1085 (ADR 0015): git authorship and push identity moved to the git hooks
// (pre-commit: the author; pre-push: every pushed commit and the gh session; see
// identity-hooks.test.js). The Sentinel no longer reads git commands for identity.
describe("identity lock — git lives in the hooks", () => {
  it("git commit, tag, rebase or push with another identity is not the Sentinel's to deny", () => {
    declare("manufosela", "otro@mail.x");
    activeGh("manufosela-tribbu");
    for (const m of ['git commit -m "feat: x"', "git tag v1", "git rebase main", "git push -u origin feat/x"]) {
      expect(run(m).stderr, m).not.toMatch(/identity lock/);
    }
  });
});
