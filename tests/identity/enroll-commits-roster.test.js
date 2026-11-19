// HU-4699 (KJC-BUG-0648, #4661): the roster enroll-phone writes is governance the agent session
// cannot commit and the seal does not carry, so the human act commits it itself, alone.
import { generateKeyPairSync } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { identityCommand } from "../../src/commands/identity.js";

const ES256 = generateKeyPairSync("ec", { namedCurve: "P-256" }).publicKey.export({ type: "spki", format: "der" }).toString("base64");
const human = { env: {}, ttyHuman: true, ancestry: { readProc: () => ({ ppid: 1, cmd: "bash" }) }, confirm: (nonce) => nonce };
const ROSTER = ".karajan/supervisor-signers.json";

let dir, home, lines;
const git = (...args) => execFileSync("git", ["-C", dir, "-c", "user.email=t@t", "-c", "user.name=t", ...args], { encoding: "utf8" });
const relayFetch = async (url, opts = {}) => {
  if (String(url).endsWith("/sign/relay.json")) return { ok: true, json: async () => ({ projectId: "p", apiKey: "k", collection: "c" }) };
  if (opts.method === "POST") return { ok: true, json: async () => ({}) };
  const fields = { state: { stringValue: "registered" }, credentialId: { stringValue: "cred-1" }, publicKey: { stringValue: ES256 }, alg: { integerValue: "-7" } };
  return { ok: true, json: async () => ({ fields }) };
};
const enroll = () => identityCommand({
  action: "enroll-phone", config: { projectDir: dir }, flags: { label: "mine" },
  deps: { log: (l) => lines.push(l), home, ...human, fetch: relayFetch, qr: () => {}, spinner: { tick() {}, stop() {} }, gitEnv: { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } },
});

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-enroll-commit-"));
  home = fs.mkdtempSync(path.join(os.tmpdir(), "kj-enroll-home-"));
  lines = [];
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(home, { recursive: true, force: true });
});

describe("kj identity enroll-phone commits the roster it writes", () => {
  beforeEach(() => {
    git("init", "-q", "-b", "chore/enroll");
    fs.writeFileSync(path.join(dir, "README.md"), "x\n");
    git("add", "README.md");
    git("commit", "-q", "-m", "base");
  });

  it("commits the roster alone, with a conventional header, and says to merge it before sealing", async () => {
    expect(await enroll()).toBe(0);
    expect(git("log", "-1", "--format=%s").trim()).toBe("chore(identity): enroll mine in the signer roster");
    expect(git("show", "--name-only", "--format=", "HEAD").trim()).toBe(ROSTER);
    expect(git("status", "--porcelain", "--", ROSTER).trim()).toBe("");
    expect(lines.join("\n")).toMatch(/commit .* del padrón.*su propia PR.*antes de sellar/is);
  });

  it("leaves whatever else was staged out of that commit, still staged", async () => {
    fs.writeFileSync(path.join(dir, "other.txt"), "other\n");
    git("add", "other.txt");
    expect(await enroll()).toBe(0);
    expect(git("show", "--name-only", "--format=", "HEAD").trim()).toBe(ROSTER);
    expect(git("diff", "--cached", "--name-only").trim()).toBe("other.txt");
  });
});

describe("kj identity enroll-phone outside a git repository", () => {
  it("keeps the enrollment and the recovery code, and says loudly it could not commit the roster", async () => {
    expect(await enroll()).toBe(1);
    expect(fs.existsSync(path.join(dir, ROSTER))).toBe(true);
    expect(lines.join("\n")).toMatch(/no se pudo commitear el padrón/);
  });
});
