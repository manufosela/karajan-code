// KJC-TSK-1234 (ADR 0032): the project's kj.config.yml travels with the repo, so the generated
// pre-commit hands its staged version to kj, which parses it and refuses a secret in it.
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { hookBody, SHEBANG } from "../../src/harden/hook-templates.js";

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..");
const lines = hookBody("pre-commit", {}).split("\n");
const start = lines.findIndex((l) => l.includes("KJC-TSK-1234"));
const block = lines.slice(start, lines.indexOf("fi", start) + 1).join("\n");
let repo;
let shim;
const git = (...args) => execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", ...args], { cwd: repo });
const stageConfig = (text) => {
  fs.mkdirSync(path.join(repo, ".karajan"), { recursive: true });
  fs.writeFileSync(path.join(repo, ".karajan", "kj.config.yml"), text);
  git("add", "-f", ".karajan/kj.config.yml");
};
// PATH holds only the kj shim and the system tools, so "no kj" can be tested too.
const check = (withKj = true) => spawnSync("sh", ["-c", block], {
  cwd: repo, encoding: "utf8",
  env: { ...process.env, PATH: `${withKj ? `${shim}:` : ""}/usr/bin:/bin`, KARAJAN_HOME: path.join(repo, "kj-home") },
});
beforeEach(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), "kj-config-secrets-"));
  shim = path.join(repo, "bin-shim");
  fs.mkdirSync(shim);
  fs.writeFileSync(path.join(shim, "kj"), `${SHEBANG}\nexec "${process.execPath}" "${path.join(REPO_ROOT, "bin", "kj.js")}" "$@"\n`, { mode: 0o755 });
  git("init", "-q", "-b", "main");
});
afterEach(() => fs.rmSync(repo, { recursive: true, force: true }));

describe("pre-commit: no secret in the shared kj.config.yml", () => {
  it("is part of the generated pre-commit", () => {
    expect(start).toBeGreaterThan(-1);
  });

  it("refuses a secret however the YAML spells the key, and says where it belongs", () => {
    stageConfig("sonarqube:\n  \"to\\u006ben\": sqp_escaped\n");
    const res = check();
    expect(res.status).toBe(1);
    expect(res.stderr).toMatch(/sonarqube\.token/);
    expect(res.stderr).toMatch(/kj\.config\.local\.yml or ~\/\.karajan/);
  });

  it("lets a config without secrets through, and does nothing when it is not staged", () => {
    stageConfig("sonarqube:\n  host: http://localhost:9000\n  token:\n");
    expect(check().status).toBe(0);
    git("rm", "-q", "--cached", ".karajan/kj.config.yml");
    expect(check().status).toBe(0);
  });

  it("does not let it in when kj is not installed to check it", () => {
    stageConfig("sonarqube:\n  host: h\n");
    const res = check(false);
    expect(res.status).toBe(1);
    expect(res.stdout).toMatch(/kj is not installed/);
  });
});
