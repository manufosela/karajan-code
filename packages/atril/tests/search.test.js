// HU-0015 (ADR 0021, decision 5): search ranks the store lexically over
// name, description, atril.keywords and body.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { search } from "../src/search.js";
import * as atril from "../src/index.js";

// KJC-TSK-1138 (review): search reaches library consumers through the package entry point.
it("the package entry point exports search", () => {
  expect(atril.search).toBe(search);
});

const BIN = fileURLToPath(new URL("../bin/atril.js", import.meta.url));
let dir;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "atril-search-")); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const put = (root, rel, front, body = "body\n") => {
  const file = join(dir, root, rel);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `---\n${front}\n---\n${body}`);
};
const find = (query, opts = {}) => search(query, { projectDir: dir, root: "proj", userRoot: join(dir, "user"), ...opts });

describe("search", () => {
  beforeEach(() => {
    put("proj", "skills/tdd/SKILL.md", "name: tdd\ndescription: Red green refactor\nkind: skill");
    put("proj", "commands/review.md", "name: review\ndescription: Review a diff\nkind: command", "Run the tdd checks.\n");
    put("user", "agents/tester.md",
      "name: tester\ndescription: Writes tests\nkind: agent\natril:\n  keywords: [tdd, coverage]");
  });

  it("returns the contract shape, with source and installed", () => {
    expect(find("coverage")).toEqual([
      { name: "tester", kind: "agent", description: "Writes tests", source: "user", installed: true, score: expect.any(Number) },
    ]);
  });

  it("a name match beats a keyword match, which beats a body match", () => {
    expect(find("tdd").map((hit) => hit.name)).toEqual(["tdd", "tester", "review"]);
  });

  it("ranks the same way on every call and drops what does not match", () => {
    expect(find("TDD refactor")).toEqual(find("tdd refactor"));
    expect(find("nothing-matches")).toEqual([]);
  });

  it("the kind filters the hits", () => {
    expect(find("tdd", { kind: "command" }).map((hit) => hit.name)).toEqual(["review"]);
  });

  it("an empty query or an unknown kind fails loudly", () => {
    expect(() => find("")).toThrow(/query/);
    expect(() => find("   ")).toThrow(/query/);
    expect(() => find(undefined)).toThrow(/query/);
    expect(() => find(42)).toThrow(/query/);
    expect(() => find("tdd", { kind: "bogus" })).toThrow(/kind/);
  });

  it("keywords that are not a list fail loudly, naming the file", () => {
    put("proj", "agents/bad.md", "name: bad\ndescription: d\nkind: agent\natril:\n  keywords: tdd");
    expect(() => find("tdd")).toThrow(/bad\.md: atril\.keywords must be a list/);
    put("proj", "agents/bad.md", "name: bad\ndescription: d\nkind: agent\natril:\n  keywords: [{ a: 1 }]");
    expect(() => find("tdd")).toThrow(/bad\.md: atril\.keywords must be a list of strings/);
  });
  it("matches accented and non-Latin terms whole", () => {
    put("proj", "skills/es/SKILL.md", "name: es\ndescription: Búsqueda テスト\nkind: skill");
    expect(find("búsqueda").map((hit) => hit.name)).toEqual(["es"]);
    expect(find("テスト").map((hit) => hit.name)).toEqual(["es"]);
    expect(find("squeda")).toEqual([]);
  });
});

describe("atril search", () => {
  const run = (...args) => spawnSync(process.execPath, [BIN, "search", ...args, "--root", "proj"], {
    cwd: dir, encoding: "utf8", env: { ...process.env, ATRIL_USER_ROOT: join(dir, "user") },
  });
  beforeEach(() => {
    put("proj", "skills/tdd/SKILL.md", "name: tdd\ndescription: Red green refactor\nkind: skill");
    put("user", "agents/tester.md", "name: tester\ndescription: Writes tests\nkind: agent", "tdd\n");
  });

  it("--json prints the mode and the ranked hits", () => {
    const res = run("tdd", "--json");
    expect(res.status).toBe(0);
    const out = JSON.parse(res.stdout);
    expect(out.mode).toBe("lexical");
    expect(out.hits.map((hit) => hit.name)).toEqual(["tdd", "tester"]);
  });

  it("--kind filters, and the text output reports the mode on stderr", () => {
    const res = run("tdd", "--kind", "agent");
    expect(res.status).toBe(0);
    expect(res.stderr).toBe("atril: search mode lexical\n");
    expect(res.stdout).toMatch(/^\d+\tagent\ttester\tuser\tWrites tests\n$/);
  });

  it("no hits exits 0 with an explicit no results message", () => {
    const res = run("nothing-matches");
    expect(res.status).toBe(0);
    expect(res.stdout).toBe('no results for "nothing-matches"\n');
    expect(JSON.parse(run("nothing-matches", "--json").stdout)).toEqual({ mode: "lexical", hits: [] });
  });

  it("a missing query fails loudly", () => {
    const res = run();
    expect(res.status).toBe(1);
    expect(res.stderr).toMatch(/^atril: search needs a non-empty query/);
  });
  it("an unknown --kind fails loudly", () => {
    const res = run("tdd", "--kind", "bogus");
    expect(res.status).toBe(1);
    expect(res.stderr).toMatch(/kind "bogus" is not one of/);
  });
  // KJC-TSK-1139 (review): a description is the artifact author's text; it may not drive the terminal.
  it("text output strips control characters from descriptions", () => {
    put("proj", "commands/red.md", 'name: red\ndescription: "Turns \\e[31mred\\e[0m now"\nkind: command');
    const out = run("red").stdout;
    expect(out).not.toContain(String.fromCodePoint(27));
    expect(out).toMatch(/^\d+\tcommand\tred\tproject\tTurns \[31mred \[0m now$/m);
  });
  it("text output keeps one hit per line for multi-line descriptions", () => {
    put("proj", "commands/plan.md", "name: plan\ndescription: |\n  Plans\n  \tthe work\nkind: command");
    expect(run("plan").stdout).toMatch(/^\d+\tcommand\tplan\tproject\tPlans the work\n$/);
  });
});
