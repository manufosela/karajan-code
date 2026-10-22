// HU-0015 (ADR 0021, decision 5): search ranks the store lexically over
// name, description, atril.keywords and body.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { search } from "../src/search.js";

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
    expect(() => find("tdd", { kind: "plugin" })).toThrow(/kind/);
  });

  it("keywords that are not a list fail loudly, naming the file", () => {
    put("proj", "agents/bad.md", "name: bad\ndescription: d\nkind: agent\natril:\n  keywords: tdd");
    expect(() => find("tdd")).toThrow(/bad\.md: atril\.keywords must be a list/);
  });
});
