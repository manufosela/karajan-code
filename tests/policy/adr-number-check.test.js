// HU-2792: a PR may not add an ADR number that the base already has.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { policyCommand } from "../../src/commands/policy.js";
import { ADR_RULE, adrNumberViolation } from "../../src/policy/adr-number-check.js";

const DIR = ".karajan/adrs";
const adr = (name) => `${DIR}/${name}`;
/** A git that answers the diff's name-status and the base's ls-tree, and records every call. */
const gitOf = ({ status = "", base = [] }) => {
  const asked = [];
  const run = async (args) => {
    asked.push(args);
    if (args.includes("--name-status")) return status;
    if (args[0] === "ls-tree") return base.map(adr).join("\n");
    return status.split("\n").map((l) => l.split("\t")[1]).filter(Boolean).join("\n");
  };
  return { asked, run };
};
const check = (git, files, range = "origin/main...HEAD") => adrNumberViolation({ files, range, run: git.run });

describe("adrNumberViolation", () => {
  it("the field case: 0037 added under another name names both files and the next free number", async () => {
    const git = gitOf({ status: `A\t${adr("0037-b.md")}`, base: ["0036-a.md", "0037-y.md", "0039-z.md"] });
    expect(await check(git, [adr("0037-b.md")])).toMatchObject({
      rule_id: ADR_RULE, enforcement: "deny", file: adr("0037-b.md"),
      reason: expect.stringMatching(/0037-b\.md.*0037-y\.md.*0040/),
    });
    expect(git.asked.find((a) => a[0] === "ls-tree")).toEqual(["ls-tree", "--name-only", "--end-of-options", "origin/main", `${DIR}/`]);
  });

  it("a range that starts with a dash never reaches git as an option", async () => {
    const git = gitOf({ status: `A\t${adr("0037-b.md")}`, base: [] });
    await check(git, [adr("0037-b.md")], "--output=/x...HEAD");
    const diff = git.asked.find((a) => a.includes("--name-status"));
    expect(diff.indexOf("--end-of-options")).toBeLessThan(diff.indexOf("--output=/x...HEAD"));
    expect(git.asked.find((a) => a[0] === "ls-tree").indexOf("--end-of-options")).toBeLessThan(git.asked.find((a) => a[0] === "ls-tree").indexOf("--output=/x"));
  });

  it("a renamed ADR (deletes y, adds x with the same number) is not a violation", async () => {
    const git = gitOf({ status: `D\t${adr("0037-y.md")}\nA\t${adr("0037-b.md")}`, base: ["0037-y.md"] });
    expect(await check(git, [adr("0037-y.md"), adr("0037-b.md")])).toBeNull();
    expect(git.asked.find((a) => a.includes("--name-status"))).toContain("--no-renames");
  });

  it("a modified ADR and a new number are not violations", async () => {
    expect(await check(gitOf({ status: `M\t${adr("0037-y.md")}`, base: ["0037-y.md"] }), [adr("0037-y.md")])).toBeNull();
    expect(await check(gitOf({ status: `A\t${adr("0038-n.md")}`, base: ["0037-y.md"] }), [adr("0038-n.md")])).toBeNull();
  });

  it("a diff with no ADRs is null and does not ask git", async () => {
    const git = gitOf({});
    expect(await check(git, ["src/x.js"])).toBeNull();
    expect(git.asked).toEqual([]);
  });

  it("staged: judges the cached diff against HEAD", async () => {
    const git = gitOf({ status: `A\t${adr("0037-b.md")}`, base: ["0037-y.md"] });
    expect(await adrNumberViolation({ files: [adr("0037-b.md")], range: null, run: git.run })).toMatchObject({ rule_id: ADR_RULE });
    expect(git.asked.find((a) => a.includes("--name-status"))).toContain("--cached");
    expect(git.asked.find((a) => a[0] === "ls-tree")).toContain("HEAD");
  });
});

describe("kj policy check", () => {
  let dir;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-adr-ci-")); fs.mkdirSync(path.join(dir, ".karajan")); });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("--range --strict: a duplicated ADR number is a deny violation, exit 2", async () => {
    fs.writeFileSync(path.join(dir, ".karajan", "policy.yml"), "version: 1\nroles:\n  coder:\n    write: { deny: ['**/*.secret'], enforcement: deny }\n");
    const warned = [];
    const logger = { info: () => {}, warn: (l) => warned.push(l), error: () => {} };
    const git = gitOf({ status: `A\t${adr("0037-b.md")}`, base: ["0037-y.md"] });
    expect(await policyCommand({ action: "check", config: { projectDir: dir }, flags: { range: "origin/main...HEAD", strict: true }, logger, deps: { gitFn: git.run } })).toBe(2);
    expect(warned.join("\n")).toMatch(new RegExp(`✗ policy \\[${ADR_RULE}\\]`));
  });
});
