// HU-0005 (ADR 0022, decision 6): kj declares the rulesync range it was tested
// with, and kj doctor says when the project's rulesync falls outside it.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getRulesyncChecks, inTestedRange, RULESYNC_TESTED_RANGE } from "../../src/checks/rulesync.js";

let dir;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "kj-rs-range-")); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const detect = (run) => getRulesyncChecks({ projectDir: dir, run })[0].detect();
const withRulesync = () => mkdirSync(join(dir, ".rulesync"));
const reporting = (stdout) => vi.fn(async () => ({ exitCode: 0, stdout }));

describe("inTestedRange", () => {
  it("accepts the tested minimum and later versions of the same major", () => {
    expect(inTestedRange(RULESYNC_TESTED_RANGE.min)).toBe(true);
    expect(inTestedRange("16.20.3")).toBe(true);
  });
  it("rejects an older version and the next major", () => {
    expect(inTestedRange("16.13.9")).toBe(false);
    expect(inTestedRange("15.99.0")).toBe(false);
    expect(inTestedRange(`${RULESYNC_TESTED_RANGE.nextMajor}.0.0`)).toBe(false);
  });
  it("rejects what is not a version, and an untested prerelease", () => {
    expect(inTestedRange("garbage")).toBe(false);
    expect(inTestedRange("16.15.0-rc.1")).toBe(false);
  });
});

describe("rulesync doctor check", () => {
  it("a project without rulesync is informational, never a failure", async () => {
    const run = vi.fn();
    const res = await detect(run);
    expect(res).toMatchObject({ ok: true, severity: "info" });
    expect(res.detail).toMatch(/not used/);
    expect(run).not.toHaveBeenCalled();
  });

  it("a version inside the range is ok and names it", async () => {
    withRulesync();
    const res = await detect(reporting("16.14.0\n"));
    expect(res).toMatchObject({ ok: true, severity: "info" });
    expect(res.detail).toMatch(/16\.14\.0/);
  });

  it("a version outside the range warns, naming installed and expected", async () => {
    withRulesync();
    const res = await detect(reporting("rulesync 17.1.0"));
    expect(res).toMatchObject({ ok: false, severity: "warn" });
    expect(res.detail).toMatch(/17\.1\.0/);
    expect(res.detail).toMatch(/>=16\.14\.0 <17/);
  });

  it("uses the project's local binary when there is one, never a fetched package", async () => {
    withRulesync();
    const bin = join(dir, "node_modules", ".bin");
    mkdirSync(bin, { recursive: true });
    writeFileSync(join(bin, "rulesync"), "");
    const run = reporting("16.14.0");
    await detect(run);
    expect(run).toHaveBeenCalledWith(join(bin, "rulesync"), ["--version"], expect.anything());
  });

  it("without a local binary asks npx not to install anything", async () => {
    writeFileSync(join(dir, "rulesync.jsonc"), "{}");
    const run = reporting("16.14.0");
    await detect(run);
    expect(run).toHaveBeenCalledWith("npx", ["--no-install", "rulesync", "--version"], expect.anything());
  });

  it("rulesync declared but not runnable warns with the cause and the install to run", async () => {
    withRulesync();
    const res = await detect(vi.fn(async () => { throw new Error("spawn npx ENOENT"); }));
    expect(res).toMatchObject({ ok: false, severity: "warn" });
    expect(res.detail).toMatch(/spawn npx ENOENT/);
    expect(res.fix).toMatch(/install rulesync@/);
  });

  it("a failing binary warns with its stderr", async () => {
    withRulesync();
    const res = await detect(vi.fn(async () => ({ exitCode: 1, stdout: "", stderr: "npm ERR! missing rulesync" })));
    expect(res).toMatchObject({ ok: false, severity: "warn" });
    expect(res.detail).toMatch(/npm ERR! missing rulesync/);
  });

  it("output that is not a version warns, quoting it", async () => {
    withRulesync();
    const res = await detect(reporting("hello"));
    expect(res).toMatchObject({ ok: false, severity: "warn" });
    expect(res.detail).toMatch(/hello/);
  });

  it("the next major warns through the check too", async () => {
    withRulesync();
    expect(await detect(reporting(`${RULESYNC_TESTED_RANGE.nextMajor}.0.0`))).toMatchObject({ ok: false, severity: "warn" });
  });

  it("gives a cold npx time: its own detect timeout and a bounded subprocess", async () => {
    withRulesync();
    const [check] = getRulesyncChecks({ projectDir: dir, run: reporting("16.14.0") });
    expect(check.detectTimeoutMs).toBeGreaterThan(5000);
    await check.detect();
  });

  it("passes a timeout to the subprocess", async () => {
    withRulesync();
    const run = reporting("16.14.0");
    await detect(run);
    expect(run.mock.calls[0][2]).toMatchObject({ cwd: dir, timeout: expect.any(Number) });
  });
});
