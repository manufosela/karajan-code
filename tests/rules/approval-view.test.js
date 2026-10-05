// KJC-TSK-0962 (MDR-F3, ADR 0017): what the human reads before approving, in the
// order of what can hurt. The watched agent writes the proposal: a rule that
// loses force, or that watches nothing, must not hide among a hundred others.
import { describe, it, expect } from "vitest";
import { approvalView } from "../../src/rules/approval-view.js";

const gate = (id, matches = "deploy") => ({ id, kind: "deterministic", text: `Regla ${id}.`, when: { tool: "Bash", all: [{ arg: "command", matches }] } });
const judged = (id) => ({ id, kind: "judgment", text: `Regla ${id}.`, when: { tool: "Bash" } });
const outside = (id) => ({ id, kind: "out-of-scope", text: `Regla ${id}.`, reason: "no es una acción" });
const FILES = { versioned: ".karajan/rules.yml", unversioned: ".karajan/rules.local.yml" };
const view = (proposed, current = [], local = new Set()) => approvalView(proposed, current, local, FILES).join("\n");
const at = (text, needle) => { const i = text.indexOf(needle); expect(i, needle).toBeGreaterThan(-1); return i; };

describe("approvalView", () => {
  it("what loses force comes first: a gate turned into judgment or out of scope, or a changed condition", () => {
    const current = [gate("R-a"), gate("R-b"), gate("R-c"), gate("R-d")];
    const text = view([judged("R-a"), outside("R-b"), gate("R-c", "deploy --prod"), gate("R-d"), judged("R-e")], current);
    expect(text).toMatch(/3 rule\(s\) LOSE or CHANGE force/);
    expect(text).toMatch(/R-a {2}was deterministic, now judgment/);
    expect(text).toMatch(/R-b {2}was deterministic, now out-of-scope/);
    expect(text).toMatch(/R-c {2}condition changed[\s\S]*was:.*"deploy"[\s\S]*now:.*"deploy --prod"/);
    const [weak, ungated, gates] = ["LOSE or CHANGE", "NO effective gate", "deterministic gate(s)"].map((h) => at(text, h));
    expect(weak).toBeLessThan(ungated);
    expect(ungated).toBeLessThan(gates);
    // each rule is read once, in the block that matters most for it
    expect(text.split("R-a  ").length - 1).toBe(1);
    expect(at(text, "R-e  judgment")).toBeGreaterThan(ungated);
    expect(at(text, "R-d  deterministic")).toBeGreaterThan(gates);
  });

  it("with nothing weakened that block is not there; rules with no gate still come before the gates", () => {
    const text = view([gate("R-a"), outside("R-b")]);
    expect(text).not.toMatch(/LOSE or CHANGE/);
    expect(text).toMatch(/1 rule\(s\) with NO effective gate[^\n]*nothing is blocked/);
    expect(at(text, "R-b  out-of-scope")).toBeLessThan(at(text, "R-a  deterministic"));
  });

  it("says where each rule goes and which approved rules leave", () => {
    const text = view([gate("R-a"), gate("R-b")], [gate("R-a"), gate("R-z")], new Set(["R-b"]));
    expect(text).toMatch(/R-a {2}deterministic {2}→ \.karajan\/rules\.yml\n/);
    expect(text).toMatch(/R-b {2}deterministic {2}→ \.karajan\/rules\.local\.yml, not versioned/);
    expect(text).toMatch(/1 rule\(s\) LEAVE[\s\S]*R-z {2}Regla R-z\./);
  });
});
