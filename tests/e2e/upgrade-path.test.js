// KJC-TSK-1619 (HU-4311): a repo hardened with the previous published kj re-hardens with this
// checkout and its seal PR passes every judge, run with the base's pinned kj as CI runs it and
// with this checkout's. 14-nov: a seal PR could not pass `secrets` because the base's older kj
// lacked what the new workflow used, and the only way out was a manual merge.
// Needs the network (npm): KJ_UPGRADE_PATH=1 npx vitest run tests/e2e/upgrade-path.test.js
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { generateKeyPairSync, sign } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { commitSupervisorRegeneration } from "../../src/harden/supervisor-commit.js";
import { addSigner, canonicalPayload } from "../../src/harden/phone-sign.js";
import { CHALLENGE } from "../_fixtures/passkey.js";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const { name: PKG, version: CURRENT } = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
const below = (a, b) => {
  const [x, y] = [a, b].map((v) => v.split(".").map(Number));
  const i = x.findIndex((n, k) => n !== y[k]);
  return i >= 0 && x[i] < y[i];
};

// A TEST key signs the seal, as the seal tests do (tests/harden/supervisor-commit.test.js): never a real one.
const phoneKey = generateKeyPairSync("ed25519");
const KEY = phoneKey.publicKey.export({ type: "spki", format: "der" }).subarray(-32).toString("base64");
const keySigned = (files) => ({ ...CHALLENGE, signer: KEY, signature: sign(null, Buffer.from(canonicalPayload({ ...CHALLENGE, files }), "utf8"), phoneKey.privateKey).toString("base64") });
const humanChain = { 100: { ppid: 50, cmd: "bash" }, 50: { ppid: 1, cmd: "sshd: dev@pts/0" } };
const HUMAN = { env: {}, tty: true, logger: { info() {}, warn() {} }, deps: {
  confirm: (n) => n,
  ancestry: { pid: 100, readProc: (p) => humanChain[p] ?? { ppid: 1, cmd: "init" } },
  phone: { enrolled: () => true, request: async ({ files }) => ({ ok: true, block: keySigned(files) }) },
} };

const GIT_ID = { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.com", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.com" };
let work, repo, home, prevVersion, prevRoot;
const git = (...args) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", ...args], { cwd: repo, encoding: "utf8" });
const kjRun = (root, args) => {
  const r = spawnSync(process.execPath, [join(root, "bin", "kj.js"), ...args], {
    cwd: repo, encoding: "utf8", timeout: 240000,
    env: { ...process.env, CLAUDECODE: undefined, HOME: home, KARAJAN_HOME: join(home, ".karajan"), CI: "1", ...GIT_ID },
  });
  return { ok: r.status === 0, output: `exit ${r.status}\n${r.stdout}${r.stderr}` };
};
/** kj harden with the given kj, its generated files on main, then the seal signed by the test key. */
const hardenAndSeal = async (root, kjVersion) => {
  git("checkout", "-q", "-B", `harden-${kjVersion}`, "main");
  const h = kjRun(root, ["harden", "--json"]);
  // The seal records the generation harden used: the judges render the canonical hooks from it.
  const line = h.output.split("\n").find((l) => l.includes('{"ok"')) ?? "{}";
  const { generation } = JSON.parse(line.slice(line.indexOf("{")));
  if (!h.ok || !generation) throw new Error(`kj harden with kj ${kjVersion} failed:\n${h.output}`);
  addSigner(KEY, { projectDir: repo });
  // What kj's own contract commit leaves out on a regeneration: the supervisor, the seal's (contract-commit.js).
  git("add", "-A", "--", ".", ":!.karajan/hooks", ":!.karajan/supervisor-provenance.json");
  git("commit", "-q", "--no-verify", "--allow-empty", "-m", `chore: kj ${kjVersion} harden contract`);
  git("branch", "-f", "main", "HEAD"); // the contract PR, merged: the seal PR brings the seal alone
  const sealed = await commitSupervisorRegeneration({ ...HUMAN, projectDir: repo, kjVersion, generation, gitFn: (args) => git(...args) });
  if (!sealed.committed) throw new Error(`the seal with kj ${kjVersion} committed nothing: ${sealed.reason}`);
};

// verify-pr reads the PR from GitHub: gh answers with the seal PR and no published review.
const verifyPr = async (root, label) => {
  const { verifyPrReview } = await import(pathToFileURL(join(root, "src", "review", "verify-pr.js")).href);
  const { runCommand } = await import(pathToFileURL(join(root, "src", "utils", "process.js")).href);
  const commits = git("log", "--format=%H%x09%s", "main..HEAD").split("\n").filter(Boolean).map((l) => ({ oid: l.split("\t")[0], messageHeadline: l.split("\t")[1] }));
  const gh = { pr: JSON.stringify({ headRefOid: commits[0]?.oid, commits }), api: "" };
  const run = (cmd, args, opts) => (cmd === "gh" ? { exitCode: 0, stdout: gh[args[0]], stderr: "" } : runCommand(cmd, args, opts));
  try {
    const r = await verifyPrReview({ projectDir: repo, pr: 1, run });
    // Passing by the seal-only rule: every commit counted as the seal act, none by a verdict.
    return { ok: r.ok && r.sealCommits?.length === commits.length, output: JSON.stringify(r, null, 2) };
  } catch (err) { return { ok: false, output: `${label}: ${err.stack}` }; }
};

describe.skipIf(process.env.KJ_UPGRADE_PATH !== "1")("upgrade path: previous kj → this checkout (KJC-TSK-1619)", () => {
  beforeAll(async () => {
    const versions = JSON.parse(execFileSync("npm", ["view", PKG, "versions", "--json"], { encoding: "utf8" }));
    prevVersion = versions.findLast((v) => /^\d+\.\d+\.\d+$/.test(v) && below(v, CURRENT));
    if (!prevVersion) throw new Error(`no published ${PKG} below ${CURRENT}`);
    work = mkdtempSync(join(tmpdir(), "kj-upgrade-path-"));
    [repo, home] = [join(work, "repo"), join(work, "home")];
    for (const d of [repo, home, join(work, "prev")]) mkdirSync(d, { recursive: true });
    // Installed as the judge workflows install the base's pinned kj (src/harden/workflow-templates.js).
    writeFileSync(join(work, "prev", "package.json"), '{"private":true}');
    execFileSync("npm", ["install", "--no-save", "--ignore-scripts", "--no-audit", "--no-fund", `${PKG}@${prevVersion}`], { cwd: join(work, "prev"), stdio: "pipe" });
    prevRoot = join(work, "prev", "node_modules", PKG);
    git("init", "-q", "-b", "main");
    writeFileSync(join(repo, "package.json"), '{"name":"upgrade-demo","version":"1.0.0","type":"module","scripts":{"test":"node -e 0"}}\n');
    git("add", "package.json");
    git("commit", "-q", "--no-verify", "-m", "chore: init");
    await hardenAndSeal(prevRoot, prevVersion);
    git("branch", "-f", "main", "HEAD");
    await hardenAndSeal(ROOT, CURRENT);
  }, 900000);
  afterAll(() => { if (work) rmSync(work, { recursive: true, force: true }); });

  it("every judge of the seal PR passes, with the base's kj and with this checkout's", async () => {
    expect(git("log", "--format=%s", "main..HEAD").trim()).toMatch(/^chore\(harden\): supervisor regenerated and sealed/);
    const head = git("rev-parse", "--abbrev-ref", "HEAD").trim();
    const results = [];
    const judge = (name, version, r) => results.push({ name, version, ...r });
    for (const [version, root] of [[prevVersion, prevRoot], [CURRENT, ROOT]]) {
      git("checkout", "-q", "main"); // kj-secrets.yml: the base's checkout, the PR only as git objects
      judge("privacy scan --range", version, kjRun(root, ["privacy", "scan", "--range", `main...${head}`]));
      git("checkout", "-q", head); // kj-policy.yml and kj-verdicts.yml: the PR's tree, the base's kj
      judge("policy check --range --strict", version, kjRun(root, ["policy", "check", "--range", "main...HEAD", "--strict"]));
      judge("review --verify-pr (seal-only)", version, await verifyPr(root, version));
    }
    const failed = results.filter((r) => !r.ok);
    const onlyNewerFixes = failed.filter((f) => f.version === prevVersion && results.some((r) => r.name === f.name && r.version === CURRENT && r.ok));
    const report = [
      ...onlyNewerFixes.map((f) => `BLOCKS USERS: "${f.name}" fails with the base's kj ${prevVersion} and passes with ${CURRENT}: only a newer base fixes it, so releasing ${CURRENT} would leave a repo pinned to ${prevVersion} unable to merge its seal PR.`),
      ...failed.map((f) => `✗ ${f.name} with kj ${f.version}:\n${f.output}`),
    ].join("\n\n");
    expect(failed.map((f) => `${f.name} @ ${f.version}`), report).toEqual([]);
  }, 600000);
});
