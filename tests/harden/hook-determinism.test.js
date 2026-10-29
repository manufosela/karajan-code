// HU-2762: the generated hooks are byte-stable across machines, and the global
// chain is resolved at run time (real sh, real git, throwaway repo).
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { installHooks } from "../../src/harden/harden-engine.js";

const git = (cwd, env, ...args) => spawnSync("git", args, { cwd, env, encoding: "utf8" });

describe("hook determinism (HU-2762)", () => {
  let root, repo, env;
  const writeHooksDir = (name, script) => {
    const hooks = path.join(root, name);
    fs.mkdirSync(hooks, { recursive: true });
    fs.writeFileSync(path.join(hooks, "commit-msg"), script, { mode: 0o755 });
    const cfg = path.join(root, `${name}.gitconfig`);
    fs.writeFileSync(cfg, `[core]\n\thooksPath = ${hooks}\n`);
    return { hooks, cfg };
  };
  const commit = () => {
    fs.writeFileSync(path.join(repo, "f.txt"), `${Math.random()}\n`);
    git(repo, env, "add", "f.txt");
    return git(repo, env, "-c", "user.name=T", "-c", "user.email=t@e.st", "commit", "-q", "-m", "fix: a thing");
  };

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "kj-determinism-"));
    repo = path.join(root, "repo");
    fs.mkdirSync(repo);
    env = { ...process.env, HOME: root, GIT_CONFIG_GLOBAL: path.join(root, "none.gitconfig") };
    git(repo, env, "init", "-q", "-b", "work");
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it("a second install under another HOME and GIT_CONFIG_GLOBAL changes nothing", async () => {
    const saved = { ...process.env };
    try {
      Object.assign(process.env, env);
      await installHooks({ projectDir: repo });
      git(repo, env, "add", ".karajan");
      const { cfg } = writeHooksDir("elsewhere", "#!/bin/sh\nexit 0\n");
      for (const variant of [{ HOME: path.join(root, "other"), GIT_CONFIG_GLOBAL: cfg }, { GIT_CONFIG_GLOBAL: undefined }]) {
        for (const [k, v] of Object.entries(variant)) {
          if (v === undefined) delete process.env[k]; else process.env[k] = v;
        }
        const { hooks } = await installHooks({ projectDir: repo });
        expect(hooks.map((h) => h.action)).toEqual(Array(hooks.length).fill("unchanged"));
        expect(git(repo, env, "diff", "--stat", "--", ".karajan").stdout).toBe("");
      }
    } finally {
      for (const k of Object.keys(process.env)) delete process.env[k];
      Object.assign(process.env, saved);
    }
  });

  describe("run-time chain (minimal profile)", () => {
    beforeEach(async () => {
      const saved = process.env.GIT_CONFIG_GLOBAL;
      process.env.GIT_CONFIG_GLOBAL = env.GIT_CONFIG_GLOBAL;
      try { await installHooks({ projectDir: repo, profile: "minimal" }); } finally {
        if (saved === undefined) delete process.env.GIT_CONFIG_GLOBAL; else process.env.GIT_CONFIG_GLOBAL = saved;
      }
    });

    it("a global hook created AFTER install still runs and can veto the commit", () => {
      env.GIT_CONFIG_GLOBAL = writeHooksDir("late", "#!/bin/sh\necho late-global-said-no >&2\nexit 7\n").cfg;
      const r = commit();
      expect(r.status).not.toBe(0);
      expect(r.stderr).toContain("late-global-said-no");
    });

    it("no global setting → the commit passes", () => {
      expect(commit().status).toBe(0);
    });

    it("a global setting equal to the repo's own hooks dir does not call itself", () => {
      const cfg = path.join(root, "self.gitconfig");
      fs.writeFileSync(cfg, `[core]\n\thooksPath = ${path.join(repo, ".karajan", "hooks")}\n`);
      env.GIT_CONFIG_GLOBAL = cfg;
      expect(commit().status).toBe(0);
    });
  });
});
