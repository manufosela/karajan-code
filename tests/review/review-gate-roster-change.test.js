// HU-4700 (issue #4661): a staged diff that only brings a roster change the roster verifies
// commits without an AI verdict; anything else still needs one.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { reviewGateCommand } from "../../src/commands/review-gate.js";
import { admitSigner, SIGNERS_FILE } from "../../src/harden/roster.js";

let dir, cwd0, exit0;
const git = (...args) => execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", ...args], { cwd: dir });
const newKey = () => generateKeyPairSync("ed25519").publicKey.export({ type: "spki", format: "der" }).subarray(-32).toString("base64");
const rosterPath = () => path.join(dir, SIGNERS_FILE);
const stage = (...files) => git("add", ...files);

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-gate-roster-"));
  cwd0 = process.cwd();
  exit0 = process.exitCode;
  process.chdir(dir);
  git("init", "-q", "-b", "main");
  fs.writeFileSync(path.join(dir, "a.txt"), "a\n");
  stage("a.txt");
  git("commit", "-qm", "base");
});
afterEach(() => {
  process.chdir(cwd0);
  process.exitCode = exit0;
  fs.rmSync(dir, { recursive: true, force: true });
});

const check = () => reviewGateCommand({ config: { projectDir: dir, roles: { reviewer: { provider: "codex" } } }, flags: { check: true } });
const firstRoster = () => admitSigner({ projectDir: dir, publicKey: newKey(), label: "a" });
const commitRoster = () => { stage(SIGNERS_FILE); git("commit", "-qm", "roster"); };
/** The roster with a key that enters without any admission. */
const withUnadmittedKey = () => {
  const roster = JSON.parse(fs.readFileSync(rosterPath(), "utf8"));
  roster.signers.push({ publicKey: newKey(), label: "b" });
  fs.writeFileSync(rosterPath(), `${JSON.stringify(roster, null, 2)}\n`);
};

describe("kj review --check on a roster-only change", () => {
  it("passes the first roster with a trail, no verdict needed", async () => {
    firstRoster();
    stage(SIGNERS_FILE);
    const res = await check();
    expect(res).toMatchObject({ ok: true, exempt: "roster-change", reason: "roster change verified by the roster" });
    expect(process.exitCode).toBe(0);
  });

  it("still demands a verdict when another file is staged with the roster", async () => {
    firstRoster();
    fs.writeFileSync(path.join(dir, "a.txt"), "b\n");
    stage(SIGNERS_FILE, "a.txt");
    const res = await check();
    expect(res.ok).toBe(false);
    expect(process.exitCode).toBe(1);
  });

  it("still demands a verdict when the change does not verify", async () => {
    firstRoster();
    commitRoster();
    withUnadmittedKey();
    stage(SIGNERS_FILE);
    const res = await check();
    expect(res.ok).toBe(false);
    expect(process.exitCode).toBe(1);
  });

  it("falls through to the verdict path on an unparsable roster", async () => {
    fs.mkdirSync(path.dirname(rosterPath()), { recursive: true });
    fs.writeFileSync(rosterPath(), "{nope");
    stage(SIGNERS_FILE);
    const res = await check();
    expect(res.ok).toBe(false);
    expect(process.exitCode).toBe(1);
  });
});
