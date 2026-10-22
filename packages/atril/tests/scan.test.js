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
  it("the option wins, then ATRIL_ROOT, then .atril/", () => {
    expect(resolveRoot({ root: "x", env: { ATRIL_ROOT: "y" } })).toBe("x");
    expect(resolveRoot({ env: { ATRIL_ROOT: "y" } })).toBe("y");
    expect(resolveRoot({ env: {} })).toBe(".atril");
  });
});

describe("scan", () => {
  it("finds the three kinds in the store", () => {
    store("proj");
    const res = scan({ projectDir: dir, root: "proj", userRoot: join(dir, "none") });
    expect(names(res)).toEqual(["agent:tester", "command:review", "skill:tdd"]);
    expect(res.shadowed).toEqual([]);
  });

  it("a missing store is empty, not an error", () => {
    expect(scan({ projectDir: dir, root: "nope", userRoot: join(dir, "none") }).artifacts).toEqual([]);
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

  it("an artifact whose kind contradicts its directory fails loudly", () => {
    put("proj", "commands/odd.md", "skill");
    expect(() => scan({ projectDir: dir, root: "proj", userRoot: join(dir, "none") })).toThrow(/odd\.md.*kind skill.*commands/);
  });

  it("never writes", () => {
    store("proj");
    const before = statSync(join(dir, "proj", "commands")).mtimeMs;
    scan({ projectDir: dir, root: "proj", userRoot: join(dir, "none") });
    expect(statSync(join(dir, "proj", "commands")).mtimeMs).toBe(before);
  });
});

describe("atril scan", () => {
  it("--root and --json list the store", () => {
    store("proj");
    const res = spawnSync(process.execPath, [BIN, "scan", "--root", "proj", "--json"], {
      cwd: dir, encoding: "utf8", env: { ...process.env, ATRIL_ROOT: "other", ATRIL_USER_ROOT: join(dir, "none") },
    });
    expect(res.status).toBe(0);
    expect(names(JSON.parse(res.stdout))).toEqual(["agent:tester", "command:review", "skill:tdd"]);
  });
});
