// HU-4833 (KJC-TSK-1729, épica KJC-PCS-0113): the reviewer's answer is checked against the schema the
// prompt promises (src/prompts/reviewer.js) before any finding reaches the coder or blocks a commit.
import { describe, expect, it } from "vitest";

import { verdictSchemaProblems } from "../../src/review/verdict-schema.js";

const issue = (over = {}) => ({
  id: "R-1",
  severity: "high",
  category: "correctness",
  file: "src/a.js",
  line: 12,
  description: "off by one",
  suggested_fix: "use <=",
  ...over,
});
const verdict = (over = {}) => ({ approved: false, blocking_issues: [issue()], non_blocking_suggestions: [], summary: "s", confidence: 0.8, ...over });

describe("verdictSchemaProblems", () => {
  it("a verdict that keeps the promised shape has no problems", () => {
    expect(verdictSchemaProblems(verdict())).toEqual([]);
    expect(verdictSchemaProblems(verdict({ approved: true, blocking_issues: [] }))).toEqual([]);
  });

  it("a finding about the whole diff (file and line null) is valid, as the prompt allows", () => {
    expect(verdictSchemaProblems(verdict({ blocking_issues: [issue({ file: null, line: null })] }))).toEqual([]);
  });

  it.each([
    ["approved not a boolean", verdict({ approved: "false" }), "approved"],
    ["blocking_issues not a list", verdict({ blocking_issues: "none" }), "blocking_issues"],
    ["no description", verdict({ blocking_issues: [issue({ description: undefined })] }), "blocking_issues[0].description"],
    ["an empty description", verdict({ blocking_issues: [issue({ description: "  " })] }), "blocking_issues[0].description"],
    ["an unknown severity", verdict({ blocking_issues: [issue({ severity: "urgent" })] }), "blocking_issues[0].severity"],
    ["an unknown category", verdict({ blocking_issues: [issue({ category: "vibes" })] }), "blocking_issues[0].category"],
    ["a file that is not text", verdict({ blocking_issues: [issue({ file: 3 })] }), "blocking_issues[0].file"],
    ["a line that is not an integer", verdict({ blocking_issues: [issue({ line: "12" })] }), "blocking_issues[0].line"],
    ["a negative line", verdict({ blocking_issues: [issue({ line: -1 })] }), "blocking_issues[0].line"],
    ["a finding that is not an object", verdict({ blocking_issues: ["fix it"] }), "blocking_issues[0]"],
    // kj solomon --finding <id> and kj code --retry address a finding by its id and pass on its fix.
    ["no id", verdict({ blocking_issues: [issue({ id: undefined })] }), "blocking_issues[0].id"],
    ["an empty id", verdict({ blocking_issues: [issue({ id: "" })] }), "blocking_issues[0].id"],
    ["an id that is not text", verdict({ blocking_issues: [issue({ id: 7 })] }), "blocking_issues[0].id"],
    ["no suggested_fix", verdict({ blocking_issues: [issue({ suggested_fix: undefined })] }), "blocking_issues[0].suggested_fix"],
    ["an empty suggested_fix", verdict({ blocking_issues: [issue({ suggested_fix: " " })] }), "blocking_issues[0].suggested_fix"],
    ["a suggested_fix that is not text", verdict({ blocking_issues: [issue({ suggested_fix: 4 })] }), "blocking_issues[0].suggested_fix"],
  ])("names the field when there is %s", (_case, input, field) => {
    const problems = verdictSchemaProblems(input);
    expect(problems.length).toBeGreaterThan(0);
    expect(problems.some((p) => p.startsWith(`${field}:`) || p === field || p.startsWith(`${field} `))).toBe(true);
  });

  it("names every broken finding, not only the first", () => {
    const problems = verdictSchemaProblems(verdict({ blocking_issues: [issue({ severity: "x" }), issue(), issue({ description: "" })] }));
    expect(problems.some((p) => p.startsWith("blocking_issues[0].severity"))).toBe(true);
    expect(problems.some((p) => p.startsWith("blocking_issues[2].description"))).toBe(true);
    expect(problems.some((p) => p.startsWith("blocking_issues[1]"))).toBe(false);
  });
});
