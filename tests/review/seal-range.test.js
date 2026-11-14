// KJC-BUG-0590: a PR that only brings the roster-signed seal passes the judges of its PR
// (privacy scan, policy check), as verify-pr already accepts it.
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderCanonicalHook } from "../../src/harden/harden-engine.js";
import { canonicalPayload } from "../../src/harden/phone-sign.js";
import { PROVENANCE_FILE } from "../../src/harden/supervisor-commit.js";
import { rangeIsOnlySeals } from "../../src/review/seal-commit.js";
import { privacyScanCommand } from "../../src/commands/privacy.js";
import { policyCommand } from "../../src/commands/policy.js";
import { runCommand } from "../../src/utils/process.js";

const HOOK = ".karajan/hooks/pre-commit";
const KEY = `sk_live_${"a1B2c3D4".repeat(3)}`;
const generation = { profile: "standard", cmds: {}, baseBranch: "main", globalHooksDir: "$HOME/.git-hooks" };
let repo;
const git = (...args) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", ...args], { cwd: repo, stdio: "pipe" });
const commit = (msg, entries) => {
  for (const [file, text] of Object.entries(entries)) writeFileSync(join(repo, file), text);
  git("add", ...Object.keys(entries));
  git("commit", "-qm", msg);
};
/** The seal act: the canonical hook plus the provenance, signed by `phone` (unsigned when null). */
const sealCommit = (phone) => {
  const hook = renderCanonicalHook("pre-commit", generation);
  const files = [{ file: HOOK, sha256: createHash("sha256").update(hook).digest("hex") }];
  const challenge = { cid: "c1", nonce: "n1", project: "demo", v: 2, kjVersion: "9.9.9", issuedMs: 1, expiresMs: 2 };
  const signature = phone && { ...challenge, signer: phone.publicKey, signature: sign(null, Buffer.from(canonicalPayload({ ...challenge, files })), phone.privateKey).toString("base64") };
  commit("chore(harden): sealed", { [HOOK]: hook, [PROVENANCE_FILE]: JSON.stringify({ kj_version: "9.9.9", generation, files, ...(signature ? { signature } : {}) }) });
};
const newPhone = () => {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return { privateKey, publicKey: publicKey.export({ format: "der", type: "spki" }).subarray(-32).toString("base64") };
};
const roster = (p) => JSON.stringify({ signers: [{ publicKey: p.publicKey }] });
const quiet = (out) => { const log = (m) => out.push(m); return { error: log, warn: log, info: log }; };
const scan = async (range) => {
  const out = [];
  await privacyScanCommand({ flags: { range }, cwd: repo, loadKjConfig: async () => ({}), logger: quiet(out) });
  const code = process.exitCode;
  process.exitCode = undefined;
  return { code, text: out.join("\n") };
};

let phone;
beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "kj-seal-range-"));
  process.env.KJ_PRIVACY_CONFIG = join(repo, "no-privacy.yml");
  git("init", "-q");
  mkdirSync(join(repo, ".karajan", "hooks"), { recursive: true });
  phone = newPhone();
  commit("chore: base", { "README.md": "base\n", [PROVENANCE_FILE]: '{"kj_version":"1.0.0","files":[]}', ".karajan/supervisor-signers.json": roster(phone) });
  git("tag", "base");
});
afterEach(() => {
  delete process.env.KJ_PRIVACY_CONFIG;
  process.exitCode = undefined;
  rmSync(repo, { recursive: true, force: true });
});

const only = (range) => rangeIsOnlySeals({ projectDir: repo, range, run: runCommand });
describe("rangeIsOnlySeals", () => {
  it("is false for an empty range, a mixed range, an unsigned seal or no range", async () => {
    expect(await only("base...HEAD")).toBe(false);
    sealCommit(null);
    expect(await only("base...HEAD")).toBe(false);
    sealCommit(phone);
    commit("feat: more", { "src.js": "export const a = 1;\n" });
    expect(await only("base...HEAD")).toBe(false);
    expect(await only("HEAD")).toBe(false);
    expect(await only("--all...HEAD")).toBe(false);
  });
});

// In CI (pull_request_target) the tree is the base and the PR head is only data: never checked out.
describe("the judges of a PR over the signed seal (--range)", () => {
  it("kj privacy scan scans an unsigned seal as today", async () => {
    sealCommit(null);
    expect(await scan("base...HEAD")).toEqual({ code: 0, text: expect.not.stringMatching(/nothing to scan/) });
  });
  it("kj policy check --range already passes a seal-only range under --strict", async () => {
    sealCommit(phone);
    const out = [];
    const code = await policyCommand({ action: "check", config: { projectDir: repo }, flags: { range: "base...HEAD", strict: true }, logger: quiet(out) });
    expect(code, out.join("\n")).toBe(0);
  });
  it("passes the signed seal at the head from the base's tree, and blocks a credential beside it", async () => {
    sealCommit(phone);
    git("tag", "head");
    commit("feat: pay", { "pay.js": `const apiKey = "${KEY}";\n` });
    git("tag", "dirty");
    git("checkout", "-q", "base");
    expect([await only("base...head"), await only("base..head")]).toEqual([true, true]);
    const note = /only brings the signed seal \(kj harden --commit\), verified against the roster; nothing to scan/;
    expect(await scan("base...head")).toEqual({ code: 0, text: expect.stringMatching(note) });
    const { code, text } = await scan("base...dirty");
    expect([code, text]).toEqual([1, expect.stringMatching(/stripe-key/)]);
  });
  it("a key only in the head's roster vouches for nothing: the roster is the base's", async () => {
    const intruder = newPhone();
    commit("chore: roster", { ".karajan/supervisor-signers.json": roster(intruder) });
    git("tag", "other");
    sealCommit(intruder);
    git("tag", "seal");
    expect(await only("other...seal")).toBe(true);
    git("checkout", "-q", "base");
    expect(await only("other...seal")).toBe(false);
  });
});
