// KJC-TSK-1033 (owner's decision, 13-oct): a policy change is authorized where it
// is used. The agent cannot write it; if it lands anyway, CI refuses it until the
// human seals it from the phone (kj harden --commit), and then it passes.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { generateKeyPairSync, sign } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { canonicalPayload } from "../../src/harden/phone-sign.js";
import { commitSupervisorRegeneration } from "../../src/harden/supervisor-commit.js";
import { makeScenarioProject } from "./helpers/scenario-project.js";

const LOOSE = "version: 1\ninvariants:\n  - id: loc-budget\n    kind: diff-threshold\n    metric: net_lines_added\n    max: 500\n    enforcement: deny\n";
// A human process chain and a phone of the roster that signs what it is shown.
const humanChain = { 100: { ppid: 50, cmd: "bash" }, 50: { ppid: 1, cmd: "sshd: dev@pts/0" } };
let p;
let phone;
let policyFile;
const check = () => p.kj("policy", "check", "--range", "chore/kj-setup...HEAD", "--strict");

beforeAll(() => {
  p = makeScenarioProject();
  p.kj("harden");
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const signer = publicKey.export({ type: "spki", format: "der" }).subarray(-32).toString("base64");
  fs.writeFileSync(path.join(p.dir, ".karajan", "supervisor-signers.json"), JSON.stringify({ signers: [{ publicKey: signer }] }));
  phone = {
    enrolled: () => true,
    request: async (req) => {
      const challenge = { cid: "c", nonce: "n", project: "p", v: 2, kjVersion: req.kjVersion, issuedMs: 1, expiresMs: 2 };
      const signature = sign(null, Buffer.from(canonicalPayload({ ...challenge, files: req.files }), "utf8"), privateKey).toString("base64");
      return { ok: true, signer, signature, challenge, block: { ...challenge, signer, signature } };
    },
  };
  policyFile = path.join(p.dir, ".karajan", "policy.yml");
  fs.writeFileSync(policyFile, LOOSE.replace("max: 500", "max: 200"));
  p.git("checkout", "-q", "-b", "chore/kj-setup");
  p.git("add", "-A");
  p.git("commit", "-q", "--no-verify", "-m", "chore(kj): setup");
}, 300_000);
afterAll(() => p?.cleanup());

describe("scenario: loosening the PR size policy from 200 to 500 lines", () => {
  it("the agent cannot write it: the Sentinel names it governance config", () => {
    const r = p.hook("pretooluse-sentinel.mjs", { tool_name: "Edit", tool_input: { file_path: policyFile, old_string: "max: 200", new_string: "max: 500" } });
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/configuraci[oó]n de gobierno/);
  });

  it("written and committed anyway, CI refuses it as an unsealed governance change", () => {
    p.git("checkout", "-q", "-b", "feat/HU-0001-bigger-prs");
    fs.writeFileSync(policyFile, LOOSE);
    p.git("add", ".karajan/policy.yml");
    p.git("commit", "-q", "--no-verify", "-m", "chore: bigger prs");
    const r = check();
    expect(r.status).not.toBe(0);
    expect(`${r.stdout}${r.stderr}`).toMatch(/defaults\.governance\.write[\s\S]*kj harden --commit/);
  });

  it("sealed by the human from the phone, the same change passes", async () => {
    fs.writeFileSync(policyFile, `${LOOSE}# sealed\n`);
    const res = await commitSupervisorRegeneration({
      projectDir: p.dir, kjVersion: "scenario", generation: {}, env: {}, tty: true, logger: { info() {}, warn() {} },
      deps: { confirm: (n) => n, phone, ancestry: { pid: 100, readProc: (pid) => humanChain[pid] ?? { ppid: 1, cmd: "init" } } },
    });
    expect(res.committed).toBe(true);
    const r = check();
    expect(r.status, `${r.stdout}${r.stderr}`).toBe(0);
  });
});
