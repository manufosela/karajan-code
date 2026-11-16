// KJC-TSK-1654 (ADR 0060): at critical the seal asks the phone only when it changes who governs.
import { describe, expect, it } from "vitest";
import { basePinOf, sealGoverns } from "../../src/harden/critical-seal.js";

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
