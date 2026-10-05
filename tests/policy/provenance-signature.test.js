// KJC-TSK-0964 (HUM-A, ADR 0018): the phone's signature is a guarantee only if
// something OUTSIDE the machine checks it. CI verifies the seal's signature
// against the roster that travels with the repo; a local wipe changes nothing.
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, beforeEach, afterEach } from "vitest";

import { renderCanonicalHook } from "../../src/harden/harden-engine.js";
import { canonicalPayload } from "../../src/harden/phone-sign.js";
import { PROVENANCE_FILE } from "../../src/harden/supervisor-commit.js";
import { liftSealedSupervisorViolations, verifiedSupervisorFiles } from "../../src/policy/supervisor-verify.js";

const HOOK = ".karajan/hooks/pre-commit";
const generation = { profile: "standard", cmds: {}, baseBranch: "main", globalHooksDir: "$HOME/.git-hooks" };
const sha = (s) => createHash("sha256").update(Buffer.from(s, "utf8")).digest("hex");
const phone = () => {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return { privateKey, publicKey: publicKey.export({ format: "der", type: "spki" }).subarray(-32).toString("base64") };
};

let repo, files;
/** A provenance sealed by `who`, signing `signedFiles` (the seal's own files unless a forger says otherwise). */
const seal = (who, { signedFiles = files, signer = who?.publicKey } = {}) => {
  const challenge = { cid: "c1", nonce: "n1", project: "demo", v: 2, kjVersion: "9.9.9", issuedMs: 1, expiresMs: 2 };
  const signature = who ? { ...challenge, signer, signature: sign(null, Buffer.from(canonicalPayload({ ...challenge, files: signedFiles })), who.privateKey).toString("base64") } : undefined;
  writeFileSync(join(repo, PROVENANCE_FILE), JSON.stringify({ kj_version: "9.9.9", generation, files, ...(signature ? { signature } : {}) }));
};
const roster = (...keys) => writeFileSync(join(repo, ".karajan", "supervisor-signers.json"), JSON.stringify({ signers: keys.map((publicKey) => ({ publicKey })) }));
const verified = () => verifiedSupervisorFiles({ projectDir: repo });

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "kj-provsig-"));
  mkdirSync(join(repo, ".karajan", "hooks"), { recursive: true });
  const canonical = renderCanonicalHook("pre-commit", generation);
  writeFileSync(join(repo, HOOK), canonical);
  files = [{ file: HOOK, sha256: sha(canonical) }];
});
afterEach(() => rmSync(repo, { recursive: true, force: true }));

describe("the seal's signature against the versioned roster", () => {
  it("a seal signed by a phone of the roster, over the files it declares, verifies", () => {
    const mine = phone();
    roster(mine.publicKey);
    seal(mine);
    expect(verified()).toMatchObject({ complete: true });
    expect(verified().files.has(HOOK)).toBe(true);
  });

  it("with a roster, an unsigned seal verifies nothing, and says so", () => {
    roster(phone().publicKey);
    seal(null);
    expect(verified()).toMatchObject({ reason: expect.stringMatching(/no lleva firma/) });
    expect(verified().files.size).toBe(0);
  });

  it("a key that is not in the roster does not seal, however valid its signature", () => {
    const stranger = phone();
    roster(phone().publicKey);
    seal(stranger);
    expect(verified()).toMatchObject({ reason: expect.stringMatching(/no está en el padrón/) });
    expect(verified().files.size).toBe(0);
  });

  it("a signature over other files, or a signer swapped for one of the roster, does not verify", () => {
    const mine = phone();
    const other = phone();
    roster(mine.publicKey, other.publicKey);
    seal(mine, { signedFiles: [{ file: HOOK, sha256: sha("otro contenido") }] });
    expect(verified()).toMatchObject({ reason: expect.stringMatching(/no corresponde/) });
    seal(mine, { signer: other.publicKey });
    expect(verified().files.size).toBe(0);
  });

  it("a malformed provenance is rejected, it does not crash the verification", () => {
    const mine = phone();
    roster(mine.publicKey);
    for (const broken of [[null], [{ sha256: "x" }], ["a string"]]) {
      writeFileSync(join(repo, PROVENANCE_FILE), JSON.stringify({ generation, files: broken, signature: { signer: mine.publicKey, signature: "AAAA" } }));
      expect(verified()).toMatchObject({ reason: expect.stringMatching(/mal formados/) });
    }
    writeFileSync(join(repo, PROVENANCE_FILE), JSON.stringify({ generation, files, signature: { signer: mine.publicKey, signature: "no es base64 de una firma" } }));
    expect(verified()).toMatchObject({ reason: expect.stringMatching(/no corresponde/) });
  });

  it("with no roster the guarantee is local only: nothing is asked, and the lift says so", () => {
    seal(null);
    expect(verified().files.has(HOOK)).toBe(true);
    const violations = [{ rule_id: "defaults.supervisor.write", file: HOOK }];
    expect(liftSealedSupervisorViolations({ projectDir: repo, violations })).toMatchObject({ lifted: 1, note: expect.stringMatching(/sin padrón.*solo local/) });
    roster(phone().publicKey);
    expect(liftSealedSupervisorViolations({ projectDir: repo, violations })).toMatchObject({ lifted: 0, note: expect.stringMatching(/no lleva firma/) });
  });
});
