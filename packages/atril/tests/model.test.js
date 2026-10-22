// HU-0007 (ADR 0021, decisions 4 and 9): a skill, command or agent is Markdown
// with frontmatter. The author's fields are kept apart from what atril adds
// under `atril:`, and the content hash ignores that block.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseArtifact } from "../src/model.js";

let dir;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "atril-model-")); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const write = (name, text) => {
  const file = join(dir, name);
  writeFileSync(file, text);
  return file;
};
const doc = (front, body = "Do the thing.\n") => `---\n${front}\n---\n${body}`;

describe("parseArtifact", () => {
  it.each(["skill", "command", "agent"])("parses a %s", (kind) => {
    const file = write(`${kind}.md`, doc(`name: tdd\ndescription: Write the failing test first\nkind: ${kind}`));
    expect(parseArtifact(file)).toMatchObject({
      path: file, name: "tdd", kind, description: "Write the failing test first",
      roles: [], servers: [], uses: [], delegates: [], related: [], atril: {}, body: "Do the thing.\n",
    });
  });

  it("keeps the author's fields apart from the atril: block", () => {
    const file = write("a.md", doc([
      "name: review", "description: Review a diff", "kind: command",
      "roles: [reviewer]", "uses: [skill:tdd]",
      "atril:", "  keywords: [review]", "  uses: [skill:lint]",
    ].join("\n")));
    const art = parseArtifact(file);
    expect(art.roles).toEqual(["reviewer"]);
    expect(art.uses).toEqual(["skill:tdd"]);
    expect(art.atril).toEqual({ keywords: ["review"], uses: ["skill:lint"] });
  });

  it.each([
    ["name", "description: d\nkind: skill"],
    ["description", "name: n\nkind: skill"],
    ["kind", "name: n\ndescription: d"],
  ])("a missing %s fails naming the file and the field", (field, front) => {
    const file = write("bad.md", doc(front));
    expect(() => parseArtifact(file)).toThrow(new RegExp(`bad\\.md.*${field}`));
  });

  it("an unknown kind fails naming the valid ones", () => {
    const file = write("bad.md", doc("name: n\ndescription: d\nkind: rule"));
    expect(() => parseArtifact(file)).toThrow(/bad\.md.*kind "rule".*skill, command, agent/);
  });

  it("a relation that is not a list fails loudly", () => {
    const file = write("bad.md", doc("name: n\ndescription: d\nkind: skill\nuses: skill:x"));
    expect(() => parseArtifact(file)).toThrow(/bad\.md.*uses/);
  });

  it("a file without frontmatter fails loudly", () => {
    const file = write("bad.md", "# just markdown\n");
    expect(() => parseArtifact(file)).toThrow(/bad\.md.*frontmatter/);
  });

  it("editing only the atril: block leaves the hash unchanged; editing the body changes it", () => {
    const front = "name: n\ndescription: d\nkind: skill";
    const base = parseArtifact(write("a.md", doc(front))).hash;
    expect(parseArtifact(write("b.md", doc(`${front}\natril:\n  keywords: [x]`))).hash).toBe(base);
    expect(parseArtifact(write("c.md", doc(front, "Something else.\n"))).hash).not.toBe(base);
    expect(base).toMatch(/^sha256:[0-9a-f]{64}$/);
  });
});
