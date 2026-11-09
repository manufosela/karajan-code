// KJC-BUG-0506 (HU-3707): the seal signs the repo it was made for (owner/repo of origin), not the
// folder's name, and is checked against the repo it is verified in: another repo's seal backs nothing.
import { execFileSync } from "node:child_process";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { renderCanonicalHook } from "../../src/harden/harden-engine.js";
import { canonicalPayload } from "../../src/harden/phone-sign.js";
import { sealRepoOf } from "../../src/harden/seal-repo.js";
import { PROVENANCE_FILE } from "../../src/harden/supervisor-commit.js";
import { verifiedSupervisorFiles } from "../../src/policy/supervisor-verify.js";

const HOOK = ".karajan/hooks/pre-commit";
const generation = { profile: "standard", cmds: {}, baseBranch: "main", globalHooksDir: "$HOME/.git-hooks" };
const sha = (s) => createHash("sha256").update(Buffer.from(s, "utf8")).digest("hex");
const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const signer = publicKey.export({ format: "der", type: "spki" }).subarray(-32).toString("base64");

let repo;
const git = (...args) => execFileSync("git", ["-C", repo, ...args], { stdio: "ignore" });
const sealFor = (project) => {
  const hook = renderCanonicalHook("pre-commit", generation);
  writeFileSync(join(repo, HOOK), hook);
  const files = [{ file: HOOK, sha256: sha(hook) }];
  const challenge = { cid: "c1", nonce: "n1", project, v: 2, kjVersion: "9.9.9", issuedMs: 1, expiresMs: 2 };
  const signature = sign(null, Buffer.from(canonicalPayload({ ...challenge, files })), privateKey).toString("base64");
  writeFileSync(join(repo, PROVENANCE_FILE), JSON.stringify({ kj_version: "9.9.9", generation, files, signature: { ...challenge, signer, signature } }));
};

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "kj-seal-repo-"));
  mkdirSync(join(repo, ".karajan", "hooks"), { recursive: true });
  writeFileSync(join(repo, ".karajan", "supervisor-signers.json"), JSON.stringify({ signers: [{ publicKey: signer }] }));
  git("init", "-q");
  git("remote", "add", "origin", "git@github.com:Acme/Widgets.git");
});
afterEach(() => rmSync(repo, { recursive: true, force: true }));

describe("sealRepoOf", () => {
  it("names owner/repo of origin, whatever the URL form, and null without origin", () => {
    expect(sealRepoOf(repo)).toBe("acme/widgets");
    git("remote", "set-url", "origin", "https://github.com/acme/widgets");
    expect(sealRepoOf(repo)).toBe("acme/widgets");
    git("remote", "set-url", "origin", "ssh://git@github.com-work:22/Acme/Widgets.git/");
    expect(sealRepoOf(repo)).toBe("acme/widgets");
    git("remote", "remove", "origin");
    expect(sealRepoOf(repo)).toBeNull();
  });
});

describe("a seal is checked against the repo it is verified in", () => {
  it("verifies when it names this repo", () => {
    sealFor("acme/widgets");
    expect(verifiedSupervisorFiles({ projectDir: repo }).files.has(HOOK)).toBe(true);
  });

  it("backs nothing when it names another repo, and says which", () => {
    sealFor("acme/other");
    const res = verifiedSupervisorFiles({ projectDir: repo });
    expect(res.files.size).toBe(0);
    expect(res.reason).toContain("se firmó para acme/other y esto es acme/widgets");
  });

  it("a seal made before 0506 names a folder: still verifies until it is sealed again", () => {
    sealFor("HU-3695-reharden-5-13-0");
    expect(verifiedSupervisorFiles({ projectDir: repo }).files.has(HOOK)).toBe(true);
  });
});
