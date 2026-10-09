// KJC-TSK-1000 (HUM-B3, ADR 0018): kj policy check judges a roster change against the base's roster.
import { generateKeyPairSync } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { policyCommand } from "../../src/commands/policy.js";
import { issueRecoveryCode, SIGNERS_FILE } from "../../src/harden/roster.js";
import { ROSTER_RULE, rosterViolation } from "../../src/policy/roster-check.js";

const key = () => generateKeyPairSync("ed25519").publicKey.export({ type: "spki", format: "der" }).subarray(-32).toString("base64");
const a = key();
const b = key();
const first = { signers: [{ publicKey: a }], recovery: { fingerprint: issueRecoveryCode().fingerprint } };
const unsigned = { ...first, signers: [...first.signers, { publicKey: b }] };

let dir;
const cwd0 = process.cwd();
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-roster-ci-")); fs.mkdirSync(path.join(dir, ".karajan")); process.chdir(dir); });
afterEach(() => { process.chdir(cwd0); fs.rmSync(dir, { recursive: true, force: true }); });
const writeRoster = (doc) => fs.writeFileSync(path.join(dir, SIGNERS_FILE), JSON.stringify(doc));
/** A git that answers `show <spec>` from `blobs` (a missing spec throws, as git does) and records the specs asked. */
const gitOf = (blobs, files = [SIGNERS_FILE]) => {
  const asked = [];
  const run = async (args) => {
    if (args[0] === "show") { asked.push(args[1]); if (!(args[1] in blobs)) throw new Error("fatal: path does not exist"); return JSON.stringify(blobs[args[1]]); }
    if (args.includes("--name-only")) return files.join("\n");
    return files.map((f) => `1\t0\t${f}`).join("\n");
  };
  return { asked, run };
};

describe("rosterViolation", () => {
  it("leaves a diff that does not touch the roster alone, without asking git", async () => {
    const git = gitOf({}, ["src/x.js"]);
    expect(await rosterViolation({ projectDir: dir, files: ["src/x.js"], range: "main...HEAD", run: git.run })).toBeNull();
    expect(git.asked).toEqual([]);
  });

  it("with --range: the base's roster comes from the range's start, the landing one from the checkout", async () => {
    writeRoster(first);
    const git = gitOf({});
    expect(await rosterViolation({ projectDir: dir, files: [SIGNERS_FILE], range: "origin/main...HEAD", run: git.run })).toBeNull();
    expect(git.asked).toEqual([`origin/main:${SIGNERS_FILE}`]);
    writeRoster(unsigned);
    const v = await rosterViolation({ projectDir: dir, files: [SIGNERS_FILE], range: "origin/main...HEAD", run: gitOf({ [`origin/main:${SIGNERS_FILE}`]: first }).run });
    expect(v).toMatchObject({ rule_id: ROSTER_RULE, enforcement: "deny", file: SIGNERS_FILE, reason: /sin respaldo \(ADR 0018\): la clave .* entra sin admisión válida/ });
  });

  it("staged: HEAD's roster against the staged blob; a deleted roster loses its keys", async () => {
    const git = gitOf({ [`HEAD:${SIGNERS_FILE}`]: first, [`:${SIGNERS_FILE}`]: first });
    expect(await rosterViolation({ projectDir: dir, files: [SIGNERS_FILE], range: null, run: git.run })).toBeNull();
    expect(git.asked).toEqual([`HEAD:${SIGNERS_FILE}`, `:${SIGNERS_FILE}`]);
    const gone = await rosterViolation({ projectDir: dir, files: [SIGNERS_FILE], range: null, run: gitOf({ [`HEAD:${SIGNERS_FILE}`]: first }).run });
    expect(gone).toMatchObject({ enforcement: "deny", reason: /pierde la clave/ });
  });
});

describe("kj policy check", () => {
  it("--range --strict: an unbacked roster change is a deny violation, exit 2, with its reason", async () => {
    fs.writeFileSync(path.join(dir, ".karajan", "policy.yml"), "version: 1\nroles:\n  coder:\n    write: { deny: ['**/*.secret'], enforcement: deny }\n");
    writeRoster(unsigned);
    const warned = [];
    const logger = { info: () => {}, warn: (l) => warned.push(l), error: () => {} };
    const run = gitOf({ [`origin/main:${SIGNERS_FILE}`]: first }).run;
    expect(await policyCommand({ action: "check", config: { projectDir: dir }, flags: { range: "origin/main...HEAD", strict: true }, logger, deps: { gitFn: run } })).toBe(2);
    expect(warned.join("\n")).toMatch(new RegExp(`✗ policy \\[${ROSTER_RULE}\\] el padrón de móviles cambia sin respaldo`));
    writeRoster(first);
    expect(await policyCommand({ action: "check", config: { projectDir: dir }, flags: { range: "origin/main...HEAD", strict: true }, logger, deps: { gitFn: run } })).toBe(0);
  });
});
