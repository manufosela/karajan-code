// KJC-TSK-1076: the requirements of a third-party PR, checked with no tokens:
// size against the repo's budget, Conventional Commits and no AI attribution
// in base..head, and tests next to the code. Each one is a check {id, ok, detail}.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it, expect } from "vitest";
import { sizeCheck, commitChecks, testsCheck, prRequirementChecks } from "../../src/review/pr-requirements.js";

describe("sizeCheck", () => {
  it("compares the budgeted lines added with the repo's limit", () => {
    expect(sizeCheck({ numstat: "40\t2\tsrc/a.js\n", limit: 200 })).toMatchObject({ id: "size", ok: true });
    const big = sizeCheck({ numstat: "250\t0\tsrc/a.js\n", limit: 200 });
    expect(big).toMatchObject({ id: "size", ok: false, detail: expect.stringMatching(/250 .*200/) });
    // human docs are exempt, as in the own-work gate
    expect(sizeCheck({ numstat: "900\t0\tdocs/guide.md\n", limit: 200 }).ok).toBe(true);
  });
});

describe("commitChecks", () => {
  it("wants Conventional Commits headers of at most 100 characters", () => {
    const [conv] = commitChecks([{ sha: "a1", subject: "feat: add x", body: "" }, { sha: "b2", subject: "Added stuff", body: "" }]);
    expect(conv).toMatchObject({ id: "conventional-commits", ok: false, detail: expect.stringMatching(/b2.*Added stuff/) });
    const [long] = commitChecks([{ sha: "c3", subject: `fix: ${"x".repeat(120)}`, body: "" }]);
    expect(long.ok).toBe(false);
    expect(commitChecks([{ sha: "d4", subject: "fix(api): handle null", body: "" }])[0].ok).toBe(true);
  });

  it("finds AI attribution in a commit message", () => {
    // Built in pieces so the repo's own attribution scan does not read the fixture as a real trailer.
    const trailer = `Co-Authored-By: ${"Cla" + "ude"}`;
    const [, attr] = commitChecks([{ sha: "e5", subject: "feat: x", body: trailer }]);
    expect(attr).toMatchObject({ id: "ai-attribution", ok: false, detail: expect.stringMatching(/e5/) });
    expect(commitChecks([{ sha: "f6", subject: "feat: x", body: "plain body" }])[1].ok).toBe(true);
  });
});

describe("prRequirementChecks", () => {
  it("reads the numstat of base...head and the commits of base..head", async () => {
    const calls = [];
    const run = async (_dir, args) => {
      calls.push(args.join(" "));
      return args[0] === "diff" ? "10\t0\tsrc/a.js\n4\t0\ttests/a.test.js\n" : "abc123\x1ffeat: add a\x1f\x1e";
    };
    const checks = await prRequirementChecks({ range: "main...pr", projectDir: "/nowhere", config: {}, run });
    expect(calls).toEqual(["diff --numstat main...pr", "log --format=%H%x1f%s%x1f%b%x1e main..pr"]);
    expect(checks.map((c) => [c.id, c.ok])).toEqual([["size", true], ["conventional-commits", null], ["ai-attribution", true], ["tests", true]]);
  });
});

// KJC-TSK-1238 (#2263): on someone else's PR kj's house rules are not imposed.
describe("prRequirementChecks on the reviewed repo's conventions (KJC-TSK-1238)", () => {
  const run = async (_dir, args) => (args[0] === "diff" ? "10\t0\tsrc/a.js\n" : "abc123\x1fAdd the index\x1f\x1e");
  let dir;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "kj-pr-req-")); });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));
  const conventional = async () => (await prRequirementChecks({ range: "main...pr", projectDir: dir, config: {}, run })).find((c) => c.id === "conventional-commits");

  it("does not check the commit format when the repo declares no convention", async () => {
    expect(await conventional()).toMatchObject({ ok: null, skipped: true, detail: expect.stringMatching(/declares no commit convention/) });
  });

  it.each([
    ["commitlint.config.js", "export default {};"],
    [".commitlintrc.json", "{}"],
    ["package.json", JSON.stringify({ commitlint: { extends: ["@commitlint/config-conventional"] } })],
    [".karajan/hooks/commit-msg", "#!/bin/sh"],
  ])("checks it when the repo declares one in %s", async (file, content) => {
    mkdirSync(join(dir, ".karajan/hooks"), { recursive: true });
    writeFileSync(join(dir, file), content);
    expect(await conventional()).toMatchObject({ ok: false, detail: expect.stringMatching(/Add the index/) });
  });
});

describe("testsCheck", () => {
  it("asks, never fails, when source changed with no test changed (KJC-TSK-1238)", () => {
    expect(testsCheck({ config: {}, numstat: "10\t0\tsrc/a.js\n" })).toMatchObject({ id: "tests", ok: null, question: expect.stringMatching(/business logic/) });
  });

  it("passes a delete-only or tested change", () => {
    expect(testsCheck({ config: {}, numstat: "10\t0\tsrc/a.js\n5\t0\ttests/a.test.js\n" }).ok).toBe(true);
    expect(testsCheck({ config: {}, numstat: "0\t9\tsrc/a.js\n" }).ok).toBe(true);
  });
});
