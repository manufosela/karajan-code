// HU-4668 (#4661): the seal of every repo shape passes its own CI. The agent runs kj harden with a gh
// that reads the base protection; the person's kj harden --commit runs it again where gh may not, and
// seals with no roster, a roster on the base, or a phone enrolled on this same branch. Two invariants:
// the person's pass leaves the agent's tree as it was, and every judge of the seal PR passes.
import { describe, expect, it, afterAll } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { generateKeyPairSync, sign } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { commitSupervisorRegeneration } from "../../src/harden/supervisor-commit.js";
import { addSigner, canonicalPayload } from "../../src/harden/phone-sign.js";
import { verifyPrReview } from "../../src/review/verify-pr.js";
import { runCommand } from "../../src/utils/process.js";
import { CHALLENGE } from "../_fixtures/passkey.js";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const { version: CURRENT } = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
const phoneKey = generateKeyPairSync("ed25519"); // a TEST key, as the seal tests use
const KEY = phoneKey.publicKey.export({ type: "spki", format: "der" }).subarray(-32).toString("base64");
const keySigned = (files) => ({ ...CHALLENGE, signer: KEY, signature: sign(null, Buffer.from(canonicalPayload({ ...CHALLENGE, files }), "utf8"), phoneKey.privateKey).toString("base64") });
const humanChain = { 100: { ppid: 50, cmd: "bash" }, 50: { ppid: 1, cmd: "sshd: dev@pts/0" } };
const human = (enrolled) => ({ env: {}, tty: true, logger: { info() {}, warn() {} }, deps: {
  confirm: (n) => n,
  ancestry: { pid: 100, readProc: (p) => humanChain[p] ?? { ppid: 1, cmd: "init" } },
  phone: { enrolled: () => enrolled, request: async ({ files }) => ({ ok: true, block: keySigned(files) }) },
} });

// gh as the agent's or the person's: the base protection read (its required checks) or refused.
const FAKE_GH = `#!/bin/sh
case "$*" in
  *protection*) [ "$KJ_FAKE_PROTECTION" = unreadable ] && { echo "HTTP 403: Resource not accessible" >&2; exit 1; }
    echo "{\\"required_status_checks\\":{\\"contexts\\":[$KJ_FAKE_PROTECTION]}}" ;;
  *rules*) echo "[]" ;;
  *) exit 1 ;;
esac
`;
const OWN_CI = "name: CI\non: pull_request\njobs:\n  ci:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npm test\n";
const work = mkdtempSync(join(tmpdir(), "kj-seal-matrix-"));
const bin = join(work, "bin");
mkdirSync(bin);
writeFileSync(join(bin, "gh"), FAKE_GH);
chmodSync(join(bin, "gh"), 0o755);
afterAll(() => rmSync(work, { recursive: true, force: true }));

function makeRepo(name, ownCi) {
  const repo = join(work, name);
  mkdirSync(join(repo, ".github", "workflows"), { recursive: true });
  const git = (...args) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", ...args], { cwd: repo, encoding: "utf8" });
  const kj = (args, protection) => {
    const r = spawnSync(process.execPath, [join(ROOT, "bin", "kj.js"), ...args], { cwd: repo, encoding: "utf8", timeout: 240000,
      env: { ...process.env, CLAUDECODE: undefined, HOME: join(work, "home"), KARAJAN_HOME: join(work, "home", ".karajan"), CI: "1",
        PATH: `${bin}:${process.env.PATH}`, KJ_FAKE_PROTECTION: protection } });
    return { ok: r.status === 0, output: `exit ${r.status}\n${r.stdout}${r.stderr}` };
  };
  git("init", "-q", "-b", "main");
  git("remote", "add", "origin", "https://github.com/demo/seal-matrix.git");
  writeFileSync(join(repo, "package.json"), '{"name":"seal-matrix","version":"1.0.0","type":"module","scripts":{"test":"node -e 0","lint":"node -e 0"}}\n');
  if (ownCi) writeFileSync(join(repo, ".github", "workflows", "ci.yml"), OWN_CI);
  git("add", "-A");
  git("commit", "-q", "--no-verify", "-m", "chore: init");
  return { repo, git, kj };
}

// The three judges of the seal PR, as kj-secrets, kj-policy and kj-verdicts run them.
async function judges({ repo, git, kj }) {
  const commits = git("log", "--format=%H%x09%s", "main..HEAD").split("\n").filter(Boolean).map((l) => ({ oid: l.split("\t")[0], messageHeadline: l.split("\t")[1] }));
  const gh = { pr: JSON.stringify({ headRefOid: commits[0]?.oid, commits }), api: "" };
  const run = (cmd, args, opts) => (cmd === "gh" ? { exitCode: 0, stdout: gh[args[0]], stderr: "" } : runCommand(cmd, args, opts));
  const verdict = await verifyPrReview({ projectDir: repo, pr: 1, run });
  return {
    privacy: kj(["privacy", "scan", "--range", "main...HEAD"], "unreadable"),
    policy: kj(["policy", "check", "--range", "main...HEAD", "--strict"], "unreadable"),
    verdicts: { ok: verdict.ok && verdict.sealCommits?.length === commits.length, output: JSON.stringify(verdict, null, 2) },
  };
}

const PROTECTIONS = { requiresQuality: '"quality"', readable: '"scan"', unreadable: "unreadable" };
const CASES = [true, false].flatMap((ownCi) => Object.keys(PROTECTIONS).flatMap((agent) =>
  ["same", "unreadable"].flatMap((person) => ["none", "base", "local"].map((roster) => ({ ownCi, agent, person, roster })))));

describe.each(CASES)("seal matrix: own CI $ownCi, agent's protection $agent, person's $person, roster $roster", ({ ownCi, agent, person, roster }) => {
  it("the person's pass changes nothing the agent left, and every judge passes the seal PR", async () => {
    const r = makeRepo(`r-${ownCi}-${agent}-${person}-${roster}`, ownCi);
    const agentProt = PROTECTIONS[agent];
    const h = r.kj(["harden", "--json"], agentProt);
    const line = h.output.split("\n").find((l) => l.includes('{"ok"')) ?? "{}";
    const { generation } = JSON.parse(line.slice(line.indexOf("{")));
    expect(h.ok && generation, h.output).toBeTruthy();
    if (roster === "base") addSigner(KEY, { projectDir: r.repo });
    r.git("add", "-A", "--", ".", ":!.karajan/hooks", ":!.karajan/supervisor-provenance.json");
    r.git("commit", "-q", "--no-verify", "--allow-empty", "-m", "chore: harden contract");
    r.git("checkout", "-q", "-b", "seal");
    if (roster === "local") addSigner(KEY, { projectDir: r.repo }); // enrolled on this branch, never committed
    // kj harden --commit runs kj harden first, with the person's gh.
    expect(r.kj(["harden", "--json"], person === "same" ? agentProt : "unreadable").ok).toBe(true);
    const drift = r.git("status", "--porcelain", "--untracked-files=all").split("\n").filter(Boolean)
      .filter((l) => !/\.karajan\/(hooks\/|supervisor-provenance\.json|supervisor-signers\.json)/.test(l));
    expect(drift, "the person's harden pass rewrote what the agent's left").toEqual([]);
    const seal = commitSupervisorRegeneration({ ...human(roster !== "none"), projectDir: r.repo, kjVersion: CURRENT, generation, gitFn: (args) => r.git(...args) });
    if (roster === "none") {
      // At critical (the default) a seal of the governance config is signed by a phone: with none
      // the person is refused up front, told how to enroll one, and nothing is committed.
      await expect(seal).rejects.toThrow(/enroll-phone/);
      expect(r.git("log", "--format=%s", "main..HEAD").trim()).toBe("");
      return;
    }
    const sealed = await seal;
    if (!sealed.committed) return; // nothing to seal: no seal PR, nobody blocked
    const results = await judges(r);
    const failed = Object.entries(results).filter(([, j]) => !j.ok);
    expect(failed.map(([n]) => n), failed.map(([n, j]) => `✗ ${n}\n${j.output}`).join("\n\n")).toEqual([]);
  }, 600000);
});
