// KJC-TSK-0945 (MDR-B3, ADR 0016): kj rules test — a compiled rule proves its
// own compilation with its deny/allow examples, or it does not ship.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { rulesTest } from "../../src/commands/rules.js";

const SPRINT_TOOL = "mcp__planning-game-personal__create_sprint";
const rulesYml = (examples) => `
version: 1
rules:
  - id: R-0000000001
    kind: deterministic
    when:
      tool: "mcp__planning-game*__create_sprint"
      any:
        - { arg: allowLongSprint, equals: true }
        - { arg: endDate, days_from: startDate, gt: 0 }
${examples}
  - { id: R-0000000002, kind: judgment, when: { tool: AskUserQuestion } }
`;

let dir;
const write = (text) => {
  fs.mkdirSync(path.join(dir, ".karajan"), { recursive: true });
  fs.writeFileSync(path.join(dir, ".karajan", "rules.yml"), text);
};
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-rules-test-")); });
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("kj rules test", () => {
  it("passes when every deny example is denied and every allow example allowed; judgment rules are not run", () => {
    write(rulesYml(`    examples:
      deny:
        - { tool: ${SPRINT_TOOL}, input: { startDate: "2026-10-05", endDate: "2026-10-11" } }
      allow:
        - { tool: ${SPRINT_TOOL}, input: { startDate: "2026-10-05", endDate: "2026-10-05" } }`));
    expect(rulesTest({ projectDir: dir })).toEqual({ code: 0, lines: ["✓ 1 rule(s), 2 example(s)"] });
  });

  it("fails naming the rule when an example contradicts it", () => {
    write(rulesYml(`    examples:
      deny:
        - { tool: ${SPRINT_TOOL}, input: { startDate: "2026-10-05", endDate: "2026-10-05" } }
      allow:
        - { tool: ${SPRINT_TOOL}, input: { allowLongSprint: true } }`));
    expect(rulesTest({ projectDir: dir })).toEqual({
      code: 1,
      lines: ["✗ R-0000000001: deny example #1 was allowed", "✗ R-0000000001: allow example #1 was denied"],
    });
  });

  it("a deterministic rule without well-formed deny and allow examples is untested: it fails", () => {
    write(rulesYml(""));
    expect(rulesTest({ projectDir: dir }).lines[0]).toMatch(/R-0000000001: needs examples/);
    write(rulesYml("    examples: { deny: [{ input: {} }], allow: [{ tool: X }] }"));
    expect(rulesTest({ projectDir: dir }).code).toBe(1);
    write(rulesYml("    examples: { deny: [{ tool: X, input: [1] }], allow: [{ tool: X }] }"));
    expect(rulesTest({ projectDir: dir }).code).toBe(1);
  });

  it("an invalid file fails with its errors; no file has nothing to test", () => {
    write("version: 2");
    expect(rulesTest({ projectDir: dir })).toEqual({ code: 1, lines: ["✗ .karajan/rules.yml: version must be 1"] });
    fs.rmSync(path.join(dir, ".karajan", "rules.yml"));
    expect(rulesTest({ projectDir: dir }).code).toBe(0);
  });
});
