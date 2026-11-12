// KJC-TSK-0962 (MDR-F3, ADR 0017): what the human reads before approving, in the
// order of what can hurt. The watched agent writes the proposal: a rule that
// loses force, or that watches nothing, must not hide among a hundred others.
import { describe, it, expect } from "vitest";
import { approvalView, isUnchanged } from "../../src/rules/approval-view.js";

const gate = (id, matches = "deploy") => ({ id, kind: "deterministic", text: `Regla ${id}.`, when: { tool: "Bash", all: [{ arg: "command", matches }] } });
const judged = (id) => ({ id, kind: "judgment", text: `Regla ${id}.`, when: { tool: "Bash" } });
const outside = (id) => ({ id, kind: "out-of-scope", text: `Regla ${id}.`, reason: "no es una acción" });
const FILES = { versioned: ".karajan/rules.yml", unversioned: ".karajan/rules.local.yml" };
// The full view (--all); KJC-TSK-1410's default, only what changes, is tested at the end.
const view = (proposed, current = [], local = new Set()) => approvalView(proposed, current, local, FILES, { all: true }).join("\n");
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

  it("KJC-TSK-0973: a judgment rule is read with the reason it takes no condition", () => {
    const text = view([{ ...judged("R-a"), reason: "lo que la rompe está en un fichero" }, judged("R-b")]);
    expect(text).toMatch(/when: \{"tool":"Bash"\} {2}\(lo que la rompe está en un fichero\)/);
    expect(text).toMatch(/Regla R-b\.\n {4}when: \{"tool":"Bash"\}\n/);
  });

  // KJC-TSK-1410: the human approves what changes; what they approved before and stays the same
  // is one line, so the changes and the confirmation code are not lost in hundreds of lines.
  it("by default lists only what changes, and counts the unchanged rules in one line", () => {
    const current = [gate("R-a"), judged("R-b"), outside("R-c"), gate("R-z")];
    const text = approvalView([gate("R-a"), judged("R-b"), outside("R-c", "x"), judged("R-n"), gate("R-a2")], current, new Set(), FILES).join("\n");
    expect(text).not.toMatch(/R-a {2}|R-b {2}|R-c {2}/);
    expect(text).toMatch(/R-n {2}judgment/);
    expect(text).toMatch(/R-a2 {2}deterministic/);
    expect(text).toMatch(/1 rule\(s\) LEAVE[\s\S]*R-z/);
    expect(text).toMatch(/3 rule\(s\) unchanged from what is approved today, not listed: kj rules approve --all shows them/);
    // a weakened rule is never hidden
    expect(approvalView([judged("R-a")], [gate("R-a")], new Set(), FILES).join("\n")).toMatch(/R-a {2}was deterministic, now judgment/);
  });

  // KJC-BUG-0568: the source decides versioned vs local; a source-only change is a change.
  it("a rule whose only change is its source is listed as changed, with where it moves", () => {
    const text = approvalView([{ ...gate("R-a"), source: "docs/rules.md" }], [{ ...gate("R-a"), source: "~/.claude/CLAUDE.md" }], new Set(), FILES).join("\n");
    expect(text).toMatch(/R-a {2}deterministic/);
    expect(text).toMatch(/source: ~\/\.claude\/CLAUDE\.md → docs\/rules\.md/);
    expect(text).not.toMatch(/unchanged/);
  });

  it("an identical rule, same shape and source, stays unchanged", () => {
    const rule = { ...gate("R-a"), source: "docs/rules.md" };
    const text = approvalView([rule], [{ ...rule }], new Set(), FILES).join("\n");
    expect(text).not.toMatch(/R-a {2}/);
    expect(text).toMatch(/1 rule\(s\) unchanged/);
    expect(isUnchanged(rule, { ...rule })).toBe(true);
    expect(isUnchanged(rule, { ...rule, source: "x.md" })).toBe(false);
  });

  it("a first approval shows every rule, all of them new", () => {
    const text = approvalView([gate("R-a"), judged("R-b")], [], new Set(), FILES).join("\n");
    expect(text).toMatch(/R-a {2}deterministic/);
    expect(text).toMatch(/R-b {2}judgment/);
    expect(text).not.toMatch(/unchanged/);
  });
});
