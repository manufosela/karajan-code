// KJC-TSK-1112: the reviewed repo's own allow list for the privacy check of a
// third-party PR, read from the BASE of the range so the PR cannot exempt itself.
import { describe, it, expect } from "vitest";
import { repoPrivacyAllow, withRepoAllow } from "../../src/review/repo-privacy.js";

// A git that answers in Spanish, as a user's git may (KJC-BUG-0387): only exit codes are portable.
const BASES = new Set(["main", "abc123"]);
const gitShowing = (files) => {
  const calls = [];
  const run = async (cmd, args) => {
    calls.push([cmd, ...args]);
    const sub = args[2];
    const spec = args.at(-1);
    if (sub === "rev-parse") return BASES.has(spec.replace("^{commit}", "")) ? { exitCode: 0, stdout: "f00d" } : { exitCode: 128, stderr: "fatal: se necesitaba una sola revisión" };
    if (spec in files) return { exitCode: 0, stdout: sub === "show" ? files[spec] : "" };
    return { exitCode: 128, stderr: `fatal: ruta '.karajan/privacy.yml' no existe en '${spec.split(":")[0]}'` };
  };
  return { run, calls };
};

describe("repoPrivacyAllow", () => {
  it("reads the allow list of .karajan/privacy.yml at the base of the range", async () => {
    const { run, calls } = gitShowing({ "main:.karajan/privacy.yml": "allow:\n  - qa-bot@example.org\n  - ' known-value '\n" });
    expect(await repoPrivacyAllow({ projectDir: "/r", range: "main...feature", run })).toEqual(["qa-bot@example.org", "known-value"]);
    expect(calls).toContainEqual(["git", "-C", "/r", "show", "main:.karajan/privacy.yml"]);
  });

  it("takes the base of a two-dot range too", async () => {
    const { run } = gitShowing({ "abc123:.karajan/privacy.yml": "allow: [x1]\n" });
    expect(await repoPrivacyAllow({ projectDir: "/r", range: "abc123..def456", run })).toEqual(["x1"]);
  });

  it("is empty when the base has no such file", async () => {
    const { run } = gitShowing({});
    expect(await repoPrivacyAllow({ projectDir: "/r", range: "main...feature", run })).toEqual([]);
  });

  it("fails loudly when git cannot read the base", async () => {
    const { run } = gitShowing({});
    await expect(repoPrivacyAllow({ projectDir: "/r", range: "nope...feature", run })).rejects.toThrow(/base nope/);
  });

  it("never takes a personal list from a repo", async () => {
    const { run } = gitShowing({ "main:.karajan/privacy.yml": "personal: [secreto]\nallow: [ok]\n" });
    expect(await repoPrivacyAllow({ projectDir: "/r", range: "main...feature", run })).toEqual(["ok"]);
  });

  it("fails loudly on a file it cannot read as YAML", async () => {
    const { run } = gitShowing({ "main:.karajan/privacy.yml": "allow: [unclosed\n" });
    await expect(repoPrivacyAllow({ projectDir: "/r", range: "main...feature", run })).rejects.toThrow(/\.karajan\/privacy\.yml/);
  });

  it("fails loudly on a range with no base", async () => {
    const { run } = gitShowing({});
    await expect(repoPrivacyAllow({ projectDir: "/r", range: "feature", run })).rejects.toThrow(/base/);
  });
});

describe("withRepoAllow", () => {
  it("adds the repo allow to the user's list and keeps the personal one", () => {
    const list = { personal: ["me"], allow: ["a"], present: true };
    expect(withRepoAllow(list, ["b"])).toEqual({ personal: ["me"], allow: ["a", "b"], present: true });
    expect(list.allow).toEqual(["a"]);
  });
});
