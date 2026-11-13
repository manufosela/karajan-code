// KJC-TSK-1556 (HU-4013 step a) — `kj privacy scan --range` scans a commit range's
// added lines for credentials and personal data, naming file:line and rule, never the value.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { privacyScanCommand } from "../../src/commands/privacy.js";

const KEY = `sk_live_${"a1B2c3D4".repeat(3)}`;
let repo;
const git = (...args) => execFileSync("git", args, { cwd: repo, stdio: "pipe" });
const commit = (file, text) => {
  mkdirSync(join(repo, "src"), { recursive: true });
  writeFileSync(join(repo, file), text);
  git("add", file);
  git("-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-qm", `add ${file}`);
};

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "kj-priv-range-"));
  process.env.KJ_PRIVACY_CONFIG = join(repo, "no-privacy.yml");
  git("init", "-q");
  commit("README.md", "base\n");
  git("tag", "base");
});
afterEach(() => {
  delete process.env.KJ_PRIVACY_CONFIG;
  process.exitCode = undefined;
  rmSync(repo, { recursive: true, force: true });
});

const run = async (flags, config = {}) => {
  const out = [];
  const log = (m) => out.push(m);
  const res = await privacyScanCommand({ flags, cwd: repo, loadKjConfig: async () => config, logger: { error: log, warn: log, info: log } });
  const code = process.exitCode;
  process.exitCode = undefined;
  return { res, code, text: out.join("\n") };
};

describe("kj privacy scan --range", () => {
  it("a credential added in the range blocks naming file:line and rule, never the key", async () => {
    commit("src/pay.js", "export const x = 1;\nconst apiKey = \"" + KEY + "\";\n");
    const { code, text } = await run({ range: "base...HEAD" });
    expect(code).toBe(1);
    expect(text).toMatch(/src\/pay\.js:2/);
    expect(text).toMatch(/stripe-key/);
    expect(text).not.toContain(KEY);
  });

  it("--json carries the same findings, masked", async () => {
    commit("src/pay.js", "const apiKey = \"" + KEY + "\";\n");
    const writes = [];
    const orig = process.stdout.write;
    process.stdout.write = (s) => { writes.push(String(s)); return true; };
    try { await run({ range: "base...HEAD", json: true }); } finally { process.stdout.write = orig; }
    const doc = JSON.parse(writes.join(""));
    expect(doc.ok).toBe(false);
    expect(doc.findings.some((f) => f.type === "stripe-key" && f.source === "src/pay.js" && f.line === 1)).toBe(true);
    expect(JSON.stringify(doc)).not.toContain(KEY);
  });

  it("a clean range exits 0", async () => {
    commit("src/ok.js", "export const answer = 42;\n");
    const { code, res } = await run({ range: "base...HEAD" });
    expect(code).toBe(0);
    expect(res.findings).toHaveLength(0);
  });

  it("a declared non-secret assignment is not reported", async () => {
    commit("src/cache.js", "const cacheNamespaceKey = \"handoff-cache-namespace-v1\";\n");
    const config = { guards: { output: { non_secret_assignments: ["src/cache.js:cacheNamespaceKey"] } } };
    const { code, res } = await run({ range: "base...HEAD" }, config);
    expect(code).toBe(0);
    expect(res.findings).toHaveLength(0);
    expect((await run({ range: "base...HEAD" })).code).toBe(1);
  });

  it("--range with --staged, or with paths, is an error", async () => {
    expect((await run({ range: "base...HEAD", staged: true })).code).toBe(2);
    const out = [];
    await privacyScanCommand({ paths: ["src"], flags: { range: "base...HEAD" }, cwd: repo, logger: { error: (m) => out.push(m) } });
    expect(process.exitCode).toBe(2);
    expect(out.join("\n")).toMatch(/--range/);
  });

  it("a range git cannot read fails loud", async () => {
    expect((await run({ range: "nope...HEAD" })).code).toBe(2);
  });
});
