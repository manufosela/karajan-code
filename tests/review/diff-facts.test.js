// KJC-TSK-1380 (#3207): the reviewer starts from facts computed without a model, each
// with its file:line, and leaves the judgement to the model.
import { describe, it, expect } from "vitest";
import { diffFacts, formatDiffFacts } from "../../src/review/diff-facts.js";

const file = (name, added, { removed = [], start = 1 } = {}) => [
  `diff --git a/${name} b/${name}`, `--- a/${name}`, `+++ b/${name}`,
  `@@ -${start},${removed.length} +${start},${added.length} @@`,
  ...removed.map((l) => `-${l}`), ...added.map((l) => `+${l}`),
].join("\n");
const noList = { list: { personal: [], allow: [] } };

describe("diffFacts", () => {
  it("counts the lines each file adds and removes", () => {
    const facts = diffFacts(file("src/a.js", ["const a = 1;", "const b = 2;"], { removed: ["const a = 0;"] }), noList);
    expect(facts).toContainEqual(expect.objectContaining({ kind: "size", file: "src/a.js", text: "+2 / -1" }));
  });

  it("says when code changes and no test file is touched, and stays quiet when one is", () => {
    const code = file("src/a.js", ["export const a = 1;"]);
    expect(diffFacts(code, noList).some((f) => f.kind === "no-tests")).toBe(true);
    const withTest = `${code}\n${file("tests/a.test.js", ["it('a', () => {});"])}`;
    expect(diffFacts(withTest, noList).some((f) => f.kind === "no-tests")).toBe(false);
  });

  it("names a dependency package.json adds", () => {
    const facts = diffFacts(file("package.json", ['    "left-pad": "^1.3.0",'], { start: 20 }), noList);
    expect(facts).toContainEqual(expect.objectContaining({ kind: "new-dependency", file: "package.json", line: 20, text: expect.stringMatching(/left-pad/) }));
  });

  it("flags an added dynamic import of a module the file already imports statically", () => {
    const readFile = () => 'import { x } from "./x.js";\nconst y = 1;\n';
    const diff = file("src/b.js", ['  const { x } = await import("./x.js");'], { start: 7 });
    const facts = diffFacts(diff, { ...noList, readFile });
    expect(facts).toContainEqual(expect.objectContaining({ kind: "redundant-dynamic-import", file: "src/b.js", line: 7 }));
  });

  it("flags a secret-shaped string on an added line, masked", () => {
    // Built at run time so the repo's own privacy gate never sees a key-shaped literal.
    const key = ["AKIA", "IOSFODNN7", "EXAMPLE"].join("");
    const facts = diffFacts(file("src/c.js", [`const key = "${key}";`]), noList);
    const secret = facts.find((f) => f.kind === "secret-shape");
    expect(secret).toMatchObject({ file: "src/c.js", line: 1 });
    expect(secret.text).not.toContain(key);
  });
});

describe("formatDiffFacts", () => {
  it("renders the facts with their location, and nothing when there are none", () => {
    const md = formatDiffFacts([{ kind: "new-dependency", file: "package.json", line: 20, text: "adds dependency left-pad" }]);
    expect(md).toMatch(/Verified facts \(computed without a model\)/);
    expect(md).toMatch(/package\.json:20 adds dependency left-pad/);
    expect(formatDiffFacts([])).toBe("");
  });
});
