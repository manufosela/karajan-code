// HU-4700 (issue #4661): a commit that only brings a roster change the roster verifies needs no
// AI verdict in CI either; the same change plus another file, or one that does not verify, does.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { generateKeyPairSync } from "node:crypto";
import { verifyPrReview } from "../../src/review/verify-pr.js";
import { admitSigner, SIGNERS_FILE } from "../../src/harden/roster.js";

let dir;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-verify-roster-")); });
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const newKey = () => generateKeyPairSync("ed25519").publicKey.export({ type: "spki", format: "der" }).subarray(-32).toString("base64");
const FIRST = (() => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "kj-roster-src-"));
  admitSigner({ projectDir: scratch, publicKey: newKey(), label: "a" });
  const text = fs.readFileSync(path.join(scratch, SIGNERS_FILE), "utf8");
  fs.rmSync(scratch, { recursive: true, force: true });
  return text;
})();
const withUnadmittedKey = (text) => {
  const roster = JSON.parse(text);
  roster.signers.push({ publicKey: newKey(), label: "b" });
  return JSON.stringify(roster);
};

const PR = { headRefOid: "aaa1111", commits: [{ oid: "aaa1111", messageHeadline: "chore: roster" }] };
function fakeRun({ names, shows }) {
  return async (cmd, args) => {
    if (cmd === "gh" && args[0] === "pr") return { exitCode: 0, stdout: JSON.stringify(PR) };
    if (cmd === "gh") return { exitCode: 0, stdout: "" };
    if (args.includes("--name-only")) return { exitCode: 0, stdout: names.join("\n") };
    const text = shows[args.at(-1)];
    return args[2] === "show" && text == null ? { exitCode: 128, stdout: "" } : { exitCode: 0, stdout: text ?? "" };
  };
}
const verify = (names, shows) => verifyPrReview({ projectDir: dir, pr: 7, sealed: { signed: false, files: new Set() }, run: fakeRun({ names, shows }) });
const ROSTER = [SIGNERS_FILE];
const NEW = `aaa1111:${SIGNERS_FILE}`;
const OLD = `aaa1111^:${SIGNERS_FILE}`;

describe("verifyPrReview on a roster-only commit", () => {
  it("accepts the first roster with no verdict and no published review, and names the commit", async () => {
    const r = await verify(ROSTER, { [NEW]: FIRST, [OLD]: null });
    expect(r).toMatchObject({ ok: true, problems: [], rosterCommits: ["aaa1111"] });
  });

  it("still needs a verdict when another file comes with the roster", async () => {
    const r = await verify([SIGNERS_FILE, "src/a.js"], { [NEW]: FIRST, [OLD]: null });
    expect(r.ok).toBe(false);
    expect(r.rosterCommits).toBeUndefined();
  });

  it("still needs a verdict when the change does not verify (a key with no admission)", async () => {
    const r = await verify(ROSTER, { [NEW]: withUnadmittedKey(FIRST), [OLD]: FIRST });
    expect(r).toMatchObject({ ok: false, problems: [expect.stringMatching(/no kj review published/)] });
    expect(r.rosterCommits).toBeUndefined();
  });
});
