// KJC-TSK-1253: kj audit (and --security) checks the registry signatures and provenance of the
// installed npm dependencies with npm audit signatures: a tampered package is a supply-chain hole.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const runMock = vi.fn();
vi.mock("../../src/utils/tool-governor.js", () => ({ runGoverned: (...args) => runMock(...args) }));

import { collectNpmSignatures } from "../../src/audit/npm-signatures.js";
import { formatDeterministicSummary } from "../../src/audit/deterministic-summary.js";

let dir;
const logger = { warn: vi.fn(), info: vi.fn() };
const npmProject = () => {
  writeFileSync(join(dir, "package-lock.json"), "{}");
  mkdirSync(join(dir, "node_modules"));
};
beforeEach(() => {
  vi.resetAllMocks();
  dir = mkdtempSync(join(tmpdir(), "kj-sigs-"));
  process.env.KJ_ALLOW_REAL_SCANS = "1";
});
afterEach(() => { rmSync(dir, { recursive: true, force: true }); delete process.env.KJ_ALLOW_REAL_SCANS; });

describe("collectNpmSignatures", () => {
  it("does not apply without a lockfile and installed modules, and says why", async () => {
    const r = await collectNpmSignatures(dir, logger);
    expect(r).toMatchObject({ available: false, reason: expect.stringMatching(/package-lock\.json/) });
    expect(runMock).not.toHaveBeenCalled();
  });

  it("refuses to run npm under the test runner without the opt-in", async () => {
    npmProject();
    delete process.env.KJ_ALLOW_REAL_SCANS;
    expect((await collectNpmSignatures(dir, logger)).reason).toMatch(/test runner/);
    expect(runMock).not.toHaveBeenCalled();
  });

  it("lists the dependencies with an invalid signature and those with none, even when npm exits non-zero", async () => {
    npmProject();
    const stdout = JSON.stringify({
      invalid: [{ name: "evil", version: "1.0.0", location: "node_modules/evil" }],
      missing: [{ name: "old", version: "0.1.0", location: "node_modules/old", registry: "https://registry.npmjs.org/" }],
    });
    runMock.mockRejectedValue(Object.assign(new Error("exit 1"), { code: 1, stdout }));
    const r = await collectNpmSignatures(dir, logger);
    expect(runMock).toHaveBeenCalledWith("npm", ["audit", "signatures", "--json"], expect.objectContaining({ cwd: dir }));
    expect(r).toEqual({ available: true, invalid: [{ name: "evil", version: "1.0.0" }], missing: [{ name: "old", version: "0.1.0" }] });
    const md = formatDeterministicSummary({ npmSignatures: r });
    expect(md).toMatch(/### npm signatures[\s\S]*Invalid signature \(1\)[\s\S]*evil@1\.0\.0[\s\S]*No signature \(1\)[\s\S]*old@0\.1\.0/);
  });

  it.each([
    ["npm is missing", Object.assign(new Error("nf"), { code: "ENOENT" }), /npm not found/],
    ["npm timed out", Object.assign(new Error("t"), { killed: true }), /timed out/],
    ["npm printed no JSON", Object.assign(new Error("boom"), { code: 1, stdout: "npm error" }), /not parseable/],
  ])("is not available when %s, and says why", async (_why, err, reason) => {
    npmProject();
    runMock.mockRejectedValue(err);
    const r = await collectNpmSignatures(dir, logger);
    expect(r).toMatchObject({ available: false, reason: expect.stringMatching(reason) });
    expect(formatDeterministicSummary({ npmSignatures: r })).toMatch(/### npm signatures\n- Status: not available/);
  });
});
