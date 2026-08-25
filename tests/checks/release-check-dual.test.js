// MIG-B (KJC-TSK-0752, ADR 0004) — while a package dual-publishes under two npm
// names, their `latest` dist-tags must move in lockstep. A torn dual-publish is
// invisible from the repo: both installs "work", and every surface teaching one
// name silently diverges from the other. This check is the only thing that sees it.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { dualPublishCheck } from "../../src/checks/release-check.js";

let dir;
const pkg = { name: "karajan-code", version: "4.22.0" };
const script = 'export const LEGACY_NAME = "karajan-code";\nexport const SCOPED_NAME = "@karajan-family/code";\n';
const npmAnswering = (tags) => async (cmd, args) => {
  const name = args[1];
  if (!(name in tags)) return { exitCode: 1, stdout: "" };
  return { exitCode: 0, stdout: `${tags[name]}\n` };
};

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-dual-"));
  fs.mkdirSync(path.join(dir, "scripts"), { recursive: true });
  fs.writeFileSync(path.join(dir, "scripts", "dual-publish.mjs"), script);
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("dual-publish lockstep check", () => {
  it("both names on the same latest is ok, and the detail says the version", async () => {
    const run = npmAnswering({ "karajan-code": "4.21.0", "@karajan-family/code": "4.21.0" });
    const check = await dualPublishCheck(dir, pkg, run);
    expect(check).toMatchObject({ name: "dual-publish", ok: true });
    expect(check.detail).toContain("both at 4.21.0");
  });

  it("diverged dist-tags fail loudly: that is a torn dual-publish", async () => {
    const run = npmAnswering({ "karajan-code": "4.21.0", "@karajan-family/code": "4.20.1" });
    const check = await dualPublishCheck(dir, pkg, run);
    expect(check.ok).toBe(false);
    expect(check.detail).toContain("4.21.0");
    expect(check.detail).toContain("4.20.1");
    expect(check.detail).toMatch(/torn dual-publish/);
  });

  it("an unreadable registry is a failure, never an ok: unverified is not verified", async () => {
    const check = await dualPublishCheck(dir, pkg, npmAnswering({ "karajan-code": "4.21.0" }));
    expect(check.ok).toBe(false);
    expect(check.detail).toMatch(/could not read/);
  });

  it("without the dual script, or for another package, there is no check at all", async () => {
    expect(await dualPublishCheck(dir, { name: "something-else", version: "1.0.0" }, npmAnswering({}))).toBeNull();
    fs.rmSync(path.join(dir, "scripts", "dual-publish.mjs"));
    expect(await dualPublishCheck(dir, pkg, npmAnswering({}))).toBeNull();
  });
});
