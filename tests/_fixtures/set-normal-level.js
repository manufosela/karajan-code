// KJC-TSK-0997 (HUM-D4, ADR 0018): max is the default level. A test that exercises
// the four layers alone lowers its project to `normal` the only valid way: a record
// signed by a phone of the roster (a fresh key, in the ROSTER so the home stays
// without a phone and `isPhoneEnrolled` keeps answering false).
import { generateKeyPairSync, sign } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { canonicalPayload } from "../../src/harden/phone-sign.js";
import { SECURITY_LEVEL_FILE, signedFilesOf } from "../../src/harden/security-level.js";

export function setNormalLevel(projectDir) {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const signer = publicKey.export({ type: "spki", format: "der" }).subarray(-32).toString("base64");
  mkdirSync(join(projectDir, ".karajan"), { recursive: true });
  writeFileSync(join(projectDir, ".karajan", "supervisor-signers.json"), JSON.stringify({ signers: [{ publicKey: signer }] }));
  const record = { level: "normal", since: "2026-10-10T00:00:00.000Z" };
  const challenge = { cid: "c", nonce: "n", project: "p", v: 2, kjVersion: "test", issuedMs: 1, expiresMs: 2 };
  const signature = sign(null, Buffer.from(canonicalPayload({ ...challenge, files: signedFilesOf(record) }), "utf8"), privateKey).toString("base64");
  writeFileSync(join(projectDir, SECURITY_LEVEL_FILE), `${JSON.stringify({ ...record, signature: { ...challenge, signer, signature } }, null, 2)}\n`);
}
