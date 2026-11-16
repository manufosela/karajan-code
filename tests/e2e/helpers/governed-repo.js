/**
 * KJC-TSK-1645 (HU-4379): a temp repo shaped like a real user repo, for the governance e2e.
 * prettier is installed in its node_modules and its pre-commit runs `prettier --check .` for real;
 * `kj` on PATH is THIS checkout, with the fake reviewer preloaded (tests/e2e/fixtures/fake-coder.js)
 * so the review gate gets a verdict bound to the staged diff without a model. HOME is a temp one:
 * neither the machine's kj, nor its global hooks, nor its git config reach the run. VITEST and
 * NODE_ENV are dropped too: kj relaxes some gates under a test runner, and a person has none.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const FAKE_AGENT = join(ROOT, "tests", "e2e", "fixtures", "fake-coder.js");
const IDENTITY = { GIT_AUTHOR_NAME: "e2e", GIT_AUTHOR_EMAIL: "e2e@test.local", GIT_COMMITTER_NAME: "e2e", GIT_COMMITTER_EMAIL: "e2e@test.local" };
// What would make kj think an agent or a test runner hosts the run, or reach the machine's own setup.
// KJ_NO_CONTRACT_REVIEW: tests/setup.js turns the contract review off for the unit suite; a person has it on.
const HOST_VARS = ["CLAUDECODE", "CLAUDE_CODE_ENTRYPOINT", "CODEX_HOME", "GEMINI_CLI", "GIT_INDEX_FILE", "GIT_DIR", "NODE_OPTIONS", "KARAJAN_HOME", "VITEST", "VITEST_WORKER_ID", "VITEST_POOL_ID", "NODE_ENV", "KJ_NO_CONTRACT_REVIEW"];

const PACKAGE = {
  name: "governed-demo",
  version: "1.0.0",
  type: "module",
  scripts: { test: "node -e 0", lint: "node -e 0", "format:check": "prettier --check ." },
  devDependencies: { prettier: "*" },
};
/** prettier "installed" in the repo: this checkout's own, linked where npm would put it. */
const installPrettier = (repo) => {
  mkdirSync(join(repo, "node_modules", ".bin"), { recursive: true });
  symlinkSync(join(ROOT, "node_modules", "prettier"), join(repo, "node_modules", "prettier"));
  symlinkSync(join("..", "prettier", "bin", "prettier.cjs"), join(repo, "node_modules", ".bin", "prettier"));
};
// The reviewer the review gate asks: the fake agent; Sonar needs a server the e2e does not have.
const KJ_CONFIG = "roles:\n  reviewer:\n    provider: fake\nsonarqube:\n  enabled: false\n";

/** @returns {{repo: string, env: object, git: (...args: string[]) => string, kj: (...args: string[]) => {ok: boolean, status: number, output: string}, cleanup: () => void}} */
export function makeGovernedRepo() {
  const work = realpathSync(mkdtempSync(join(tmpdir(), "kj-governed-")));
  const [repo, home, bin] = ["repo", "home", "bin"].map((d) => join(work, d));
  for (const d of [repo, join(home, ".karajan"), bin]) mkdirSync(d, { recursive: true });
  writeFileSync(join(home, ".karajan", "kj.config.yml"), KJ_CONFIG);
  writeFileSync(join(bin, "kj"), `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} --import ${JSON.stringify(FAKE_AGENT)} ${JSON.stringify(join(ROOT, "bin", "kj.js"))} "$@"\n`);
  chmodSync(join(bin, "kj"), 0o755);
  const base = Object.fromEntries(Object.entries(process.env).filter(([k]) => !HOST_VARS.includes(k)));
  const env = { ...base, ...IDENTITY, HOME: home, PATH: `${bin}${delimiter}${process.env.PATH}`, GIT_CONFIG_NOSYSTEM: "1" };
  const git = (...args) => execFileSync("git", args, { cwd: repo, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  const kj = (...args) => {
    const r = spawnSync(join(bin, "kj"), args, { cwd: repo, env, encoding: "utf8", timeout: 240000 });
    return { ok: r.status === 0, status: r.status, output: `exit ${r.status}\n${r.stdout}${r.stderr}` };
  };
  git("init", "-q", "-b", "main");
  installPrettier(repo);
  writeFileSync(join(repo, "package.json"), `${JSON.stringify(PACKAGE, null, 2)}\n`);
  writeFileSync(join(repo, ".gitignore"), "node_modules/\n");
  git("add", "package.json", ".gitignore");
  git("commit", "-q", "-m", "chore: init");
  return { repo, env, git, kj, cleanup: () => rmSync(work, { recursive: true, force: true }) };
}
