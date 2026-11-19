// KJC-TSK-1645 (HU-4379): kj's governance flow run as a person runs it, on a repo shaped like a
// real one (prettier --check in the hooks, kj's review gate). 15-nov: three bugs in a row
// (#4355, #4358, #4373) lived between pieces that only unit tests with fakes covered, and the
// upgrade-path e2e committed the contract by hand with --no-verify, so none of them showed.
// Here nothing is a shortcut: every commit goes through the repo's real hooks. It runs in the
// default suite, so every PR's CI and every release run it (plan KJC-PCS-0111). Without the
// network the workflows' pin falls back as kj harden does for a person.
import { generateKeyPairSync, sign } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { commitSupervisorRegeneration } from "../../src/harden/supervisor-commit.js";
import { publishPrReview } from "../../src/review/publish-pr.js";
import { verifyPrReview } from "../../src/review/verify-pr.js";
import { runCommand } from "../../src/utils/process.js";
import { canonicalPayload } from "../../src/harden/phone-sign.js";
import { identityCommand } from "../../src/commands/identity.js";
import { SECURITY_LEVEL_FILE, signedFilesOf } from "../../src/harden/security-level.js";
import { basePinOf, predatesCritical } from "../../src/harden/critical-seal.js";
import { CHALLENGE } from "../_fixtures/passkey.js";
import { makeGovernedRepo } from "./helpers/governed-repo.js";

const { version: KJ_VERSION } = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
// The seal is the person's act; here a TEST key signs it, as tests/e2e/upgrade-path.test.js does.
const phoneKey = generateKeyPairSync("ed25519");
const KEY = phoneKey.publicKey.export({ type: "spki", format: "der" }).subarray(-32).toString("base64");
const keySigned = (files) => ({ ...CHALLENGE, signer: KEY, signature: sign(null, Buffer.from(canonicalPayload({ ...CHALLENGE, files }), "utf8"), phoneKey.privateKey).toString("base64") });
const humanChain = { 100: { ppid: 50, cmd: "bash" }, 50: { ppid: 1, cmd: "sshd: dev@pts/0" } };
const HUMAN = { env: {}, tty: true, logger: { info() {}, warn() {} }, deps: {
  confirm: (n) => n,
  ancestry: { pid: 100, readProc: (p) => humanChain[p] ?? { ppid: 1, cmd: "init" } },
  phone: { enrolled: () => true, request: async ({ files }) => ({ ok: true, block: keySigned(files) }) },
} };

const lastSubject = (r) => r.git("log", "-1", "--format=%s").trim();
const committedFiles = (r) => r.git("show", "--name-only", "--format=", "HEAD").split("\n").filter(Boolean);
const dirty = (r) => r.git("status", "--porcelain", "--untracked-files=all").split("\n").filter(Boolean);
const merge = (r, branch) => { r.git("checkout", "-q", "main"); r.git("merge", "-q", "--ff-only", branch); };
/** A change reviewed by the gate's reviewer and committed through the hooks, then merged into main. */
const reviewedCommit = (r, branch, message, stage) => {
  r.git("checkout", "-q", "-B", branch, "main");
  stage();
  const review = r.kj("review", "--staged");
  if (!review.ok) throw new Error(`kj review --staged failed:\n${review.output}`);
  r.git("commit", "-q", "-m", message);
  merge(r, branch);
};

describe("governance flow on a real-shaped repo (KJC-TSK-1645)", () => {
  let r, card, generation;
  beforeAll(() => {
    r = makeGovernedRepo();
    // Card first, as a person adopting kj does: card-first judges every branch below.
    card = /HU-\d+/.exec(r.kj("hu", "add", "Adopt kj in this repo").output)?.[0];
  });
  afterAll(() => r?.cleanup());

  it("the first kj harden commits its contract through the repo's own hooks, prettier included", () => {
    expect(card).toBeTruthy();
    r.git("checkout", "-q", "-b", `chore/${card}-adopt-kj`);
    const h = r.kj("harden", "--json");
    expect(h.ok, h.output).toBe(true);
    expect(h.output).not.toMatch(/NOT committed/);
    generation = JSON.parse(h.output.slice(h.output.indexOf('{"ok"')).split("\n")[0]).generation;
    expect(lastSubject(r)).toMatch(/^chore\(kj\)/);
    expect(committedFiles(r)).toEqual(expect.arrayContaining(["AGENTS.md", ".gitignore"]));
    // What is left is the seal's alone: the hooks and the workflows.
    expect(dirty(r).filter((l) => !/^\?\? (\.karajan\/hooks\/|\.github\/)/.test(l)), h.output).toEqual([]);
  }, 300000);

  it("the person's seal commits the hooks and the workflows, and leaves the tree clean", async () => {
    // The phone's enrolment is its own human act, and it commits the roster itself through the
    // repo's hooks (HU-4699, #4661): no hand-made commit here, the person's own path is the test.
    const enrolled = await identityCommand({
      action: "enroll-phone", config: { projectDir: r.repo }, flags: { publicKeyBase64: KEY, label: "test phone" },
      deps: { log() {}, home: r.env.HOME, env: {}, ttyHuman: true, ancestry: HUMAN.deps.ancestry, confirm: (n) => n, gitEnv: r.env },
    });
    expect(enrolled).toBe(0);
    // The repo's commit-msg hook appends the branch's card, as it does to every commit.
    expect(lastSubject(r)).toMatch(/^chore\(identity\): enroll test phone in the signer roster \(HU-\d+\)$/);
    expect(committedFiles(r)).toEqual([".karajan/supervisor-signers.json"]);
    const sealed = await commitSupervisorRegeneration({ ...HUMAN, projectDir: r.repo, kjVersion: KJ_VERSION, generation, gitFn: (args) => r.git(...args) });
    expect(sealed.committed, sealed.reason).toBe(true);
    expect(committedFiles(r)).toEqual(expect.arrayContaining([".karajan/hooks/pre-commit", ".karajan/supervisor-provenance.json"]));
    expect(dirty(r)).toEqual([]);
    merge(r, `chore/${card}-adopt-kj`);
  }, 300000);

  it("a second kj harden with nothing new commits nothing and warns of nothing", () => {
    r.git("checkout", "-q", "-b", `chore/${card}-again`);
    const h = r.kj("harden");
    expect(h.ok, h.output).toBe(true);
    expect(h.output).not.toMatch(/NOT committed|MENOS reglas/);
    expect(dirty(r), h.output).toEqual([]);
    r.git("checkout", "-q", "main");
  }, 300000);

  it("with the review gate on, a regenerated contract is reviewed first and its commit passes the gate", () => {
    const gate = r.kj("review", "--install-gate");
    expect(gate.ok, gate.output).toBe(true);
    reviewedCommit(r, `chore/${card}-review-gate`, "chore: turn the review gate on", () => r.git("add", ".karajan/review-gate"));
    // The guidelines lost: kj harden writes them back, a contract the gate must judge.
    reviewedCommit(r, `chore/${card}-drop-agents`, "chore: drop the agent rules", () => r.git("rm", "-q", "AGENTS.md"));
    r.git("checkout", "-q", "-b", `chore/${card}-reharden`);
    const h = r.kj("harden");
    expect(h.ok, h.output).toBe(true);
    expect(h.output).toMatch(/the contract reviewed by fake: approved/);
    expect(lastSubject(r)).toMatch(/^chore\(kj\)/);
    expect(committedFiles(r)).toContain("AGENTS.md");
    expect(dirty(r), h.output).toEqual([]);
  }, 300000);

  // KJC-BUG-0601: a seal that did not happen kept its handoff "succeeded", and the agent went on.
  it("a kj harden --commit that does not seal exits 1 and leaves its handoff pending", () => {
    const add = r.kj("handoff", "add", "kj harden --commit", "--why", "seal the re-harden");
    const id = /handoff show ([0-9a-f]{8})/.exec(add.output)?.[1];
    expect(id, add.output).toBeTruthy();
    const seal = r.kj("harden", "--commit"); // no terminal here: the human act refuses
    expect(seal.status, seal.output).toBe(1);
    expect(JSON.parse(readFileSync(join(r.repo, ".karajan", "handoffs", `${id}.json`), "utf8")).status).toBe("pending");
  }, 300000);

  // KJC-BUG-0624 (#4486): a nested package gets its own commitlint config from kj harden; the
  // contract PR passes kj review --verify-pr as CI runs it, with no Sonar proof asked for kj's file.
  it("the contract of a nested package passes kj review --verify-pr", async () => {
    reviewedCommit(r, `chore/${card}-functions`, "chore: add the functions package", () => {
      mkdirSync(join(r.repo, "functions"));
      // Firebase functions in TypeScript: a root of its own beside the JavaScript one. As prettier
      // leaves the files: the repo's hooks check the format.
      writeFileSync(join(r.repo, "functions", "package.json"), `${JSON.stringify({ name: "functions", private: true, type: "module" }, null, 2)}\n`);
      writeFileSync(join(r.repo, "functions", "tsconfig.json"), `${JSON.stringify({ compilerOptions: { strict: true } }, null, 2)}\n`);
      r.git("add", "functions/package.json", "functions/tsconfig.json");
    });
    r.git("checkout", "-q", "-b", `chore/${card}-functions-contract`);
    const h = r.kj("harden");
    expect(h.ok, h.output).toBe(true);
    expect(h.output).not.toMatch(/NOT committed/);
    expect(committedFiles(r)).toContain("functions/commitlint.config.js");
    // GitHub, as the PR sees it: kj review --publish-pr posts the review, verify-pr reads it back.
    const commits = r.git("log", "--format=%H%x09%s", "main..HEAD").split("\n").filter(Boolean).map((l) => ({ oid: l.split("\t")[0], messageHeadline: l.split("\t")[1] }));
    const posted = [];
    const github = (reviews) => (cmd, args, opts) => {
      if (cmd !== "gh") return runCommand(cmd, args, opts);
      if (args[0] === "pr") return { exitCode: 0, stdout: JSON.stringify({ headRefOid: commits[0].oid, commits }), stderr: "" };
      if (args.includes("POST")) { posted.push(args.find((a) => a.startsWith("body=")).slice(5)); return { exitCode: 0, stdout: "{}", stderr: "" }; }
      return { exitCode: 0, stdout: reviews, stderr: "" }; // labels and the reviews list
    };
    expect(await publishPrReview({ projectDir: r.repo, pr: 1, run: github("[]") })).toMatchObject({ published: true });
    const published = `${JSON.stringify({ body: posted[0], author_association: "OWNER", user: { login: "owner" } })}\n`;
    const verdict = await verifyPrReview({ projectDir: r.repo, pr: 1, run: github(published) });
    expect(verdict.ok, JSON.stringify(verdict, null, 2)).toBe(true);
  }, 300000);

  // KJC-TSK-1654 (ADR 0060, step 3): at critical, a seal of what kj generates renews itself.
  it("at critical, kj harden renews the seal of the hooks it regenerates, and the PR passes policy check", async () => {
    reviewedCommit(r, `chore/${card}-critical`, "chore: the critical security level", () => {
      const record = { level: "critical", since: "2026-11-17T00:00:00.000Z" };
      writeFileSync(join(r.repo, SECURITY_LEVEL_FILE), `${JSON.stringify({ ...record, signature: keySigned(signedFilesOf(record)) }, null, 2)}\n`);
      r.git("add", SECURITY_LEVEL_FILE);
    });
    // What the cases above left to seal (the functions package changed kj-quality.yml): the person seals it.
    r.git("checkout", "-q", "-B", `chore/${card}-resealed`, "main");
    expect(r.kj("harden").ok).toBe(true);
    const sealed = await commitSupervisorRegeneration({ ...HUMAN, projectDir: r.repo, kjVersion: KJ_VERSION, generation, gitFn: (args) => r.git(...args) });
    expect(sealed.committed, sealed.reason).toBe(true);
    merge(r, `chore/${card}-resealed`);
    // A project choice that changes a hook kj generates: the tests run on push again.
    reviewedCommit(r, `chore/${card}-test-on-push`, "chore: run the tests on push", () => {
      const pkg = JSON.parse(readFileSync(join(r.repo, "package.json"), "utf8"));
      writeFileSync(join(r.repo, "package.json"), `${JSON.stringify({ ...pkg, kj: { harden: { test_on_push: true } } }, null, 2)}\n`);
      r.git("add", "package.json");
    });
    r.git("checkout", "-q", "-b", `chore/${card}-renewal`);
    const h = r.kj("harden");
    expect(h.ok, h.output).toBe(true);
    const said = h.output.split("\n").filter((l) => /seal/.test(l)).join("\n");
    // A base CI whose kj predates the critical level cannot read an unsigned seal: until then a person seals.
    const pin = basePinOf((args) => r.git(...args), "main");
    if (predatesCritical(pin)) {
      expect(said).toMatch(new RegExp(`base branch's CI runs kj ${pin.join("\\.")}, which reads no unsigned seal`));
      return;
    }
    expect(said).toMatch(/seal renewed by itself/);
    expect(lastSubject(r)).toMatch(/^chore\(harden\): supervisor regenerated and sealed/);
    const check = r.kj("policy", "check", "--range", "main...HEAD", "--strict");
    expect(check.ok, check.output).toBe(true);
  }, 300000);
});
