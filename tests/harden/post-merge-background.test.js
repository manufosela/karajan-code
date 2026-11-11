// KJC-BUG-0381: the post-merge hook ran `kj rag index --since auto` in the
// foreground, so every local merge waited minutes for the reindex (one took 15).
// The reindex now runs detached, with a lock so two never run at once.
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { SHEBANG, hookBody } from "../../src/harden/hook-templates.js";

let dir;
const waitFor = async (cond, ms = 5000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (cond()) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return false;
};

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "kj-postmerge-"));
  spawnSync("git", ["init", "-q", dir]);
  const bin = join(dir, "bin");
  mkdirSync(bin);
  // A slow kj that counts its runs.
  writeFileSync(join(bin, "kj"), `#!/bin/sh\necho run >> "${join(dir, "runs")}"\nsleep 1\n`);
  chmodSync(join(bin, "kj"), 0o755);
  writeFileSync(join(dir, "post-merge"), `${SHEBANG}\n${hookBody("post-merge")}\n`);
  chmodSync(join(dir, "post-merge"), 0o755);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const runHook = () => {
  const start = Date.now();
  spawnSync(join(dir, "post-merge"), ["0"], { cwd: dir, env: { ...process.env, PATH: `${join(dir, "bin")}:${process.env.PATH}` } });
  return Date.now() - start;
};

describe("post-merge hook", () => {
  it("returns at once and the reindex still runs, detached", async () => {
    expect(runHook()).toBeLessThan(700);
    expect(await waitFor(() => existsSync(join(dir, "runs")))).toBe(true);
  });

  it("does not start a second reindex while one is running", async () => {
    runHook();
    runHook();
    await waitFor(() => existsSync(join(dir, "runs")));
    await new Promise((r) => setTimeout(r, 1500));
    expect(readFileSync(join(dir, "runs"), "utf8").trim().split("\n")).toHaveLength(1);
  });

  it("frees a lock whose run has died, and keeps one whose run is alive", async () => {
    const lock = join(dir, ".git", "kj-rag-index.lock");
    mkdirSync(lock);
    writeFileSync(join(lock, "pid"), String(process.pid)); // alive: this test runner
    runHook();
    await new Promise((r) => setTimeout(r, 500));
    expect(existsSync(join(dir, "runs"))).toBe(false);
    writeFileSync(join(lock, "pid"), "999999"); // no such process
    runHook();
    expect(await waitFor(() => existsSync(join(dir, "runs")))).toBe(true);
  });
});

// HU-3936 (KJC-BUG-0553, #3910 points 3 and 4): the hook runs under set -e; an expected miss must not end it
// before the repo's own post-merge is chained.
describe("post-merge hook under set -e", () => {
  const shells = ["sh", ...(spawnSync("dash", ["-c", "true"]).status === 0 ? ["dash"] : [])];
  const marker = () => join(dir, "chained");
  const repoHook = () => {
    mkdirSync(join(dir, ".git", "hooks"), { recursive: true });
    writeFileSync(join(dir, ".git", "hooks", "post-merge"), `#!/bin/sh\ntouch "${marker()}"\n`, { mode: 0o755 });
  };
  const runE = (shell, kjBody) => {
    const bin = join(dir, "bin");
    if (kjBody) writeFileSync(join(bin, "kj"), `#!/bin/sh\n${kjBody}\n`, { mode: 0o755 });
    return spawnSync(shell, ["-e", join(dir, "post-merge")], {
      cwd: dir, encoding: "utf8",
      env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", PATH: `${bin}:${process.env.PATH}` },
    });
  };

  for (const shell of shells) {
    it(`${shell}: a lock dir with no pid file does not end the hook`, () => {
      repoHook();
      mkdirSync(join(dir, ".git", "kj-rag-index.lock"));
      const res = runE(shell);
      expect(res.status).toBe(0);
      expect(existsSync(marker())).toBe(true);
    });

    it(`${shell}: the indexer removing the lock before the pid write does not end the hook`, () => {
      repoHook();
      // kj ends at once: the subshell's rm -rf of the lock can beat the parent's pid write.
      for (let i = 0; i < 20; i++) {
        rmSync(marker(), { force: true });
        const res = runE(shell, "exit 0");
        expect(res.status).toBe(0);
        expect(existsSync(marker())).toBe(true);
      }
    });
  }
});
