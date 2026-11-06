// KJC-TSK-0964 (HUM-A, ADR 0018): the phone's signature is a guarantee only if
// something OUTSIDE the machine checks it. CI verifies the seal's signature
// against the roster that travels with the repo; a local wipe changes nothing.
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, beforeEach, afterEach } from "vitest";

import { renderCanonicalHook } from "../../src/harden/harden-engine.js";
import { canonicalPayload } from "../../src/harden/phone-sign.js";
import { PROVENANCE_FILE } from "../../src/harden/supervisor-commit.js";
import { liftSealedSupervisorViolations, verifiedSupervisorFiles } from "../../src/policy/supervisor-verify.js";

const KJ_VERSION = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")).version;

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

// KJC-BUG-0502: a deletion is signed as a file with no hash. The verifier believed the
// `deleted` mark on any entry, so marking a signed file deleted and removing it passed.
describe("a deletion is only what the phone signed as one", () => {
  const POLICY = ".karajan/policy.yml";
  it("marking a signed, hashed entry deleted and removing its file verifies nothing", () => {
    const mine = phone();
    roster(mine.publicKey);
    writeFileSync(join(repo, POLICY), "version: 1\n");
    files = [...files, { file: POLICY, sha256: sha("version: 1\n") }];
    seal(mine);
    expect(verified()).toMatchObject({ complete: true });
    const signedFiles = files;
    for (const target of [POLICY, HOOK]) {
      files = signedFiles.map((e) => (e.file === target ? { ...e, deleted: true } : e));
      seal(mine, { signedFiles });
      rmSync(join(repo, target), { force: true });
      expect(verified().files.size, target).toBe(0);
      expect(verified().reason, target).toMatch(/firma que no corresponde/);
    }
  });

  it("a deletion the phone signed (no hash) still verifies once the file is gone", () => {
    const mine = phone();
    roster(mine.publicKey);
    files = [...files, { file: POLICY, deleted: true }];
    // As kj harden --commit signs it: every entry as {file, sha256}, a deletion with no hash.
    seal(mine, { signedFiles: files.map(({ file, sha256 }) => ({ file, sha256: sha256 ?? "" })) });
    expect(verified()).toMatchObject({ complete: true });
    expect(verified().files.has(POLICY)).toBe(true);
  });
});

// KJC-TSK-0877: the Sentinel guards live only on the user's machine, so CI never has
// them. With the roster's signature verified, the signature over their hashes vouches
// for them; without a roster, only a guard whose hash kj knows is accepted (KJC-BUG-0212).
describe("guards absent from the checkout", () => {
  const GUARD = ".karajan/harness/pretooluse-sentinel.mjs";
  const withGuard = () => { files = [...files, { file: GUARD, sha256: sha("a guard this kj does not render") }]; };

  it("signed by a phone of the roster: vouched by the signature, and the lift says so", () => {
    const mine = phone();
    roster(mine.publicKey);
    withGuard();
    seal(mine);
    expect(verified()).toMatchObject({ complete: true });
    expect(verified().unjudgeable.size).toBe(0);
    const lift = liftSealedSupervisorViolations({ projectDir: repo, violations: [{ rule_id: "defaults.supervisor.write", file: PROVENANCE_FILE }] });
    expect(lift).toMatchObject({ lifted: 1, note: expect.stringMatching(/1 guardia\(s\) .*respaldados por la firma del padrón/) });
  });

  it("without a roster: an unknown guard hash is not accepted", () => {
    withGuard();
    seal(null);
    expect(verified().complete).toBe(false);
  });
});

// KJC-BUG-0311 (#2052): a hook sealed by a human with an older kj, whose template
// has changed since, cannot be re-rendered by this kj. The phone's signature over
// its bytes is what vouches for it; without a signature it stays denied, saying why.
describe("a seal made with another kj version", () => {
  const sealOld = (who, kjVersion) => {
    writeFileSync(join(repo, HOOK), "#!/bin/sh\n# the pre-commit of an older kj\n");
    files = [{ file: HOOK, sha256: sha("#!/bin/sh\n# the pre-commit of an older kj\n") }];
    seal(who);
    const prov = JSON.parse(readFileSync(join(repo, PROVENANCE_FILE), "utf8"));
    writeFileSync(join(repo, PROVENANCE_FILE), JSON.stringify({ ...prov, kj_version: kjVersion }));
  };

  it("signed by a phone of the roster over those bytes: it verifies, and the lift says it was not re-rendered", () => {
    const mine = phone();
    roster(mine.publicKey);
    sealOld(mine, "0.0.1");
    expect(verified().files.has(HOOK)).toBe(true);
    const lift = liftSealedSupervisorViolations({ projectDir: repo, violations: [{ rule_id: "defaults.supervisor.write", file: HOOK }] });
    expect(lift).toMatchObject({ lifted: 1, note: expect.stringMatching(/sellado con kj 0\.0\.1.*firma del padrón/) });
  });

  it("unsigned, or claiming this very kj version: it stays denied, and names the remedy", () => {
    sealOld(null, "0.0.1");
    expect(verified()).toMatchObject({ reason: expect.stringMatching(/sellado con kj 0\.0\.1.*kj harden --commit/) });
    expect(verified().files.size).toBe(0);
    const mine = phone();
    roster(mine.publicKey);
    sealOld(mine, KJ_VERSION); // same version: the template must match, signature or not
    expect(verified().files.size).toBe(0);
  });
});
