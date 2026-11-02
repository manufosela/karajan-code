// KJC-TSK-1391 (ADR 0045): a setting taken from the project's CONTRIBUTING applies only with
// the exact sentence that justifies it found in the file; a sentence against a fixed rule
// changes nothing and shows as a conflict.
import { describe, it, expect } from "vitest";
import { findQuote, contributingLayer } from "../../src/gates/contributing.js";
import { resolveRules, formatRules } from "../../src/gates/registry.js";
import { DEFAULTS } from "../../src/config/defaults.js";
import { gatesFromContributingCommand, projectSignals } from "../../src/commands/gates.js";

const TEXT = "# Contributing\n\nPull requests should stay\nunder 400 lines of code.\nWe commit straight to main for hotfixes.\n";
const reader = (files) => (rel) => { if (rel in files) return files[rel]; throw new Error("ENOENT"); };
const base = () => ({ method_gates: { ...DEFAULTS.method_gates } });

describe("CONTRIBUTING quotes", () => {
  it("finds a sentence across line breaks and extra blanks, and names the file", () => {
    const readFile = reader({ ".github/CONTRIBUTING.md": TEXT });
    expect(findQuote("Pull requests should stay   under 400 lines of code.", readFile)).toBe(".github/CONTRIBUTING.md");
    expect(findQuote("Pull requests may be any size at all.", readFile)).toBeNull();
    expect(findQuote("main", readFile)).toBeNull(); // too short to justify anything
  });

  it("a verified setting enters the project layer with its quote as the origin", () => {
    const readFile = reader({ "CONTRIBUTING.md": TEXT });
    const entries = [{ rule: "pr-size-max", value: 400, quote: "Pull requests should stay under 400 lines of code." }];
    const layer = contributingLayer(entries, readFile);
    const rule = resolveRules(base(), { project: layer.project }).adjustable.find((r) => r.id === "pr-size-max");
    expect(rule).toMatchObject({ value: 400, origin: 'project: CONTRIBUTING.md: "Pull requests should stay under 400 lines of code."' });
  });

  it("a setting whose sentence is gone stops applying and is named", () => {
    const entries = [{ rule: "pr-size-max", value: 400, quote: "Pull requests should stay under 400 lines of code." }];
    const layer = contributingLayer(entries, reader({ "CONTRIBUTING.md": "# Contributing\n" }));
    expect(layer.project).toEqual({});
    expect(layer.stale.map((s) => s.rule)).toEqual(["pr-size-max"]);
  });

  it("kj gates set --from-contributing keeps the setting with its sentence, and refuses one not in the file", async () => {
    const written = [];
    const deps = { projectDir: "/p", readFile: reader({ "CONTRIBUTING.md": TEXT }), load: async () => ({ contributing_rules: [{ rule: "pr-size-max", value: 300, quote: "old" }] }), write: async (_p, cfg) => written.push(cfg), print: () => {} };
    const res = await gatesFromContributingCommand({ ...deps, rule: "pr-size-max", value: "400", quote: "Pull requests should stay under 400 lines of code." });
    expect(res).toMatchObject({ value: 400, file: "CONTRIBUTING.md", conflict: false });
    expect(written[0].contributing_rules).toEqual([{ rule: "pr-size-max", value: 400, quote: "Pull requests should stay under 400 lines of code." }]);
    await expect(gatesFromContributingCommand({ ...deps, rule: "pr-size-max", value: "900", quote: "Pull requests can be as large as you like." })).rejects.toThrow(/not in the project's CONTRIBUTING/);
    const conflict = await gatesFromContributingCommand({ ...deps, rule: "card-first", value: "off", quote: "We commit straight to main for hotfixes." });
    expect(conflict.conflict).toBe(true);
  });

  it("what the CONTRIBUTING says goes over what the history suggests", () => {
    const config = { contributing_rules: [{ rule: "commit-convention", value: "conventional", quote: "Pull requests should stay under 400 lines of code." }] };
    const detect = () => ({ "commit-convention": { value: "free", evidence: "git history" } });
    const signals = projectSignals({ projectDir: "/p", config, detect, readFile: reader({ "CONTRIBUTING.md": TEXT }) });
    expect(signals.project["commit-convention"].value).toBe("conventional");
  });

  it("a sentence against a fixed rule changes nothing and is shown as a conflict", () => {
    const entries = [{ rule: "card-first", value: "off", quote: "We commit straight to main for hotfixes." }];
    const layer = contributingLayer(entries, reader({ "CONTRIBUTING.md": TEXT }));
    expect(layer.project).toEqual({});
    expect(layer.conflicts).toEqual([{ rule: "card-first", file: "CONTRIBUTING.md", quote: "We commit straight to main for hotfixes." }]);
    const text = formatRules({ ...resolveRules(base()), conflicts: layer.conflicts, stale: layer.stale });
    expect(text).toMatch(/conflict with the fixed rule card-first.*CONTRIBUTING\.md.*straight to main/);
  });
});
