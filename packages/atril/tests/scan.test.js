// HU-0008 (ADR 0021, decision 8): the store has one directory per kind, the
// same layout the CLIs use; its root is an input, never a hard-coded path.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveRoot, scan } from "../src/scan.js";

const BIN = fileURLToPath(new URL("../bin/atril.js", import.meta.url));
let dir;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "atril-scan-")); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const put = (root, rel, kind, name = rel.split("/")[1].replace(/\.md$/, "")) => {
  const file = join(dir, root, rel);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `---\nname: ${name}\ndescription: ${root} ${name}\nkind: ${kind}\n---\nbody\n`);
  return file;
};
const store = (root) => {
  put(root, "skills/tdd/SKILL.md", "skill", "tdd");
  put(root, "commands/review.md", "command");
  put(root, "agents/tester.md", "agent");
};
const names = (res) => res.artifacts.map((a) => `${a.kind}:${a.name}`).toSorted();

describe("resolveRoot", () => {
  it("the option wins, then a non-empty ATRIL_ROOT, then .atril/", () => {
    expect(resolveRoot({ root: "x", env: { ATRIL_ROOT: "y" } })).toBe("x");
    expect(resolveRoot({ env: { ATRIL_ROOT: "y" } })).toBe("y");
    expect(resolveRoot({ env: {} })).toBe(".atril");
    expect(resolveRoot({ env: { ATRIL_ROOT: "" } })).toBe(".atril");
  });
});

describe("scan", () => {
  const scanProj = () => scan({ projectDir: dir, root: "proj", userRoot: join(dir, "none") });
  it("finds the three kinds in the store and skips dotfiles like .DS_Store", () => {
    store("proj");
    for (const kindDir of ["skills", "commands", "agents"]) writeFileSync(join(dir, "proj", kindDir, ".DS_Store"), "");
    const res = scanProj();
    expect(names(res)).toEqual(["agent:tester", "command:review", "skill:tdd"]);
    expect(res.shadowed).toEqual([]);
  });

  it("a missing store is empty, not an error", () => {
    expect(scanProj().artifacts).toEqual([]);
  });

  it("scans the user store too; the project wins a clash and the shadowing is reported", () => {
    put("proj", "commands/review.md", "command");
    put("user", "commands/review.md", "command");
    put("user", "agents/helper.md", "agent");
    const res = scan({ projectDir: dir, root: "proj", userRoot: join(dir, "user") });
    expect(names(res)).toEqual(["agent:helper", "command:review"]);
    expect(res.artifacts.find((a) => a.name === "review").description).toBe("proj review");
    expect(res.shadowed).toEqual([{ kind: "command", name: "review", path: join(dir, "user", "commands", "review.md") }]);
  });

  it.each([
    ["its kind contradicts its directory", () => put("proj", "commands/odd.md", "skill"), /odd\.md.*kind skill.*commands/],
    ["a skill folder has no SKILL.md", () => mkdirSync(join(dir, "proj", "skills", "typo"), { recursive: true }), /typo.*SKILL\.md/],
    ["a command file is not Markdown", () => put("proj", "commands/x.txt", "command", "x"), /x\.txt.*\.md/],
    ["its name differs from its file", () => put("proj", "commands/a.md", "command", "b"), /a\.md.*name "b"/],
    ["a command is a folder", () => mkdirSync(join(dir, "proj", "commands", "foo.md"), { recursive: true }), /foo\.md: a command must be a file/],
    ["a skill is a file", () => put("proj", "skills/x.md", "skill", "x"), /x\.md: a skill must be a folder/],
  ])("fails loudly when %s", (_label, arrange, why) => {
    arrange();
    expect(scanProj).toThrow(why);
  });

  it("a relative user store resolves against the project, not the process cwd", () => {
    put("user", "agents/helper.md", "agent");
    expect(names(scan({ projectDir: dir, root: "proj", userRoot: "user" }))).toEqual(["agent:helper"]);
  });

  it("never writes", () => {
    store("proj");
    const before = statSync(join(dir, "proj", "commands")).mtimeMs;
    scanProj();
    expect(statSync(join(dir, "proj", "commands")).mtimeMs).toBe(before);
  });
});

describe("atril scan", () => {
  const atril = (args = [], env = {}) => spawnSync(process.execPath, [BIN, "scan", "--root", "proj", ...args], {
    cwd: dir, encoding: "utf8", env: { ...process.env, ATRIL_USER_ROOT: join(dir, "none"), ...env },
  });
  it("--root and --json list the store", () => {
    store("proj");
    const res = atril(["--json"], { ATRIL_ROOT: "other" });
    expect(res.status).toBe(0);
    expect(names(JSON.parse(res.stdout))).toEqual(["agent:tester", "command:review", "skill:tdd"]);
  });

  it("an invalid store fails with a one-line message, no stack trace", () => {
    put("proj", "commands/odd.md", "skill");
    const res = atril();
    expect(res.status).toBe(1);
    expect(res.stderr).toMatch(/^atril: .*odd\.md/);
    expect(res.stderr).not.toMatch(/\n\s+at /);
  });
});
