// KJC-TSK-1384 (ADR 0045): one registry of rules. Fixed ones change for no one; each
// adjustable one has a value and says who set it; a skill may only tighten it.
import { describe, it, expect } from "vitest";
import { FIXED_RULES, ADJUSTABLE_RULES, resolveRules, formatRules } from "../../src/gates/registry.js";
import { DEFAULTS } from "../../src/config/defaults.js";
import { gatesCommand } from "../../src/commands/gates.js";

const byId = (resolved, id) => resolved.adjustable.find((r) => r.id === id);

describe("rules registry", () => {
  it("names the fixed rules and maps every adjustable one to a real method_gates key", () => {
    expect(FIXED_RULES.map((r) => r.id)).toEqual(["card-first", "cross-ai-review", "security", "no-ai-attribution", "privacy"]);
    for (const r of ADJUSTABLE_RULES) {
      expect(r.key in DEFAULTS.method_gates || r.default !== undefined, r.id).toBe(true);
    }
  });

  it("an untouched config reads every adjustable rule at its default", () => {
    const resolved = resolveRules({ method_gates: { ...DEFAULTS.method_gates } });
    expect(byId(resolved, "pr-size-max")).toMatchObject({ value: 200, origin: "default" });
    expect(byId(resolved, "mutation")).toMatchObject({ value: "off", origin: "default" });
  });

  it("a value set in kj.config.yml says so", () => {
    const resolved = resolveRules({ method_gates: { ...DEFAULTS.method_gates, tests_with_code: "block" } });
    expect(byId(resolved, "tests-with-code")).toMatchObject({ value: "block", origin: "kj.config.yml" });
  });

  it("a skill tightens, and its attempt to loosen is ignored and named", () => {
    const config = { method_gates: { ...DEFAULTS.method_gates } };
    const tighten = [
      { rule: "mutation", value: "block", by: "security-review" },
      { rule: "pr-size-max", value: 400, by: "big-bang" },
      { rule: "card-first", value: "off", by: "sneaky" },
    ];
    const resolved = resolveRules(config, { tighten });
    expect(byId(resolved, "mutation")).toMatchObject({ value: "block", origin: "skill:security-review" });
    expect(byId(resolved, "pr-size-max")).toMatchObject({ value: 200, origin: "default" });
    expect(resolved.ignored.map((i) => i.by)).toEqual(["big-bang", "sneaky"]);
  });

  it("formats the fixed rules with a lock and each adjustable one with value and origin", () => {
    const text = formatRules(resolveRules({ method_gates: { ...DEFAULTS.method_gates } }));
    expect(text).toMatch(/🔒 card-first/);
    expect(text).toMatch(/pr-size-max\s+200\s+\(default\)/);
    expect(text).toMatch(/kj gates/);
  });

  it("kj gates prints the list, or the resolved rules as JSON with --json", () => {
    const out = [];
    const config = { method_gates: { ...DEFAULTS.method_gates } };
    gatesCommand({ config, print: (t) => out.push(t) });
    gatesCommand({ config, flags: { json: true }, print: (t) => out.push(t) });
    expect(out[0]).toMatch(/Fixed rules/);
    expect(JSON.parse(out[1]).adjustable.some((r) => r.id === "steward")).toBe(true);
  });
});
