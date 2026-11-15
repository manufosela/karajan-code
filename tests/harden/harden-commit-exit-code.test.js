// KJC-BUG-0601 (HU-4380): a kj harden --commit that commits nothing exits 1. 15-nov: the human
// confirmation failed, kj harden printed the error and still exited 0, so cli.js closed the
// seal's handoff as "harden --commit succeeded" and the agent waiting on it went on.
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const KJ = fileURLToPath(new URL("../../bin/kj.js", import.meta.url));
let work, repo;
const git = (...args) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", ...args], { cwd: repo, encoding: "utf8" });
// Not a terminal (spawnSync pipes stdio): the seal refuses before it commits anything.
const harden = (...args) => {
  const env = { ...process.env, HOME: work, KARAJAN_HOME: join(work, ".karajan"), GIT_CONFIG_GLOBAL: "/dev/null" };
  delete env.CLAUDECODE;
  return spawnSync(process.execPath, [KJ, "harden", "--profile", "minimal", "--no-ci", "--no-config", "--no-guidelines", ...args], { cwd: repo, env, encoding: "utf8", timeout: 120000 });
};

beforeEach(() => {
  work = realpathSync(mkdtempSync(join(tmpdir(), "kj-harden-exit-")));
  repo = join(work, "repo");
  execFileSync("git", ["init", "-q", "-b", "main", "--template=", repo]);
  writeFileSync(join(repo, "package.json"), '{"name":"exit-demo","version":"1.0.0"}\n');
  git("add", "package.json");
  git("commit", "-q", "--no-verify", "-m", "chore: init");
  git("checkout", "-q", "-b", "chore/harden");
});
afterEach(() => rmSync(work, { recursive: true, force: true }));

describe("kj harden exit code (KJC-BUG-0601)", () => {
  it("exits 1 when --commit does not seal", () => {
    const res = harden("--commit");
    expect(`${res.stdout}${res.stderr}`).toMatch(/acto humano/);
    expect(res.status).toBe(1);
  }, 150000);

  it("exits 0 when kj harden does what it was asked", () => {
    const res = harden();
    expect(res.status, `${res.stdout}${res.stderr}`).toBe(0);
  }, 150000);
});
