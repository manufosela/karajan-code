// KJC-TSK-1386 (ADR 0045): what the project says wins over kj's defaults. Its commit
// convention comes from its own commitlint config or from its git history, with evidence.
import { describe, it, expect } from "vitest";
import { detectProjectConventions } from "../../src/gates/project-conventions.js";
import { resolveRules } from "../../src/gates/registry.js";
import { gatesValueCommand } from "../../src/commands/gates.js";
import { DEFAULTS } from "../../src/config/defaults.js";

const conv = (n) => Array.from({ length: n }, (_, i) => `feat: thing ${i}`);
const free = (n) => Array.from({ length: n }, (_, i) => `Add thing ${i}`);
const deps = ({ files = {}, subjects = [] } = {}) => ({
  readFile: (rel) => { if (rel in files) return files[rel]; throw new Error("ENOENT"); },
  gitSubjects: () => subjects,
});

describe("project conventions", () => {
  it("a commitlint config of the project's own says the project decides", () => {
    const found = detectProjectConventions("/p", deps({ files: { ".commitlintrc.json": '{"extends":["@acme/lint"]}' } }));
    expect(found["commit-convention"]).toEqual({ value: "project", evidence: ".commitlintrc.json" });
  });

  it("the commitlint config kj itself manages is not the project's word", () => {
    const files = { "commitlint.config.js": "// >>> kj:managed:commitlint\nexport default {};" };
    expect(detectProjectConventions("/p", deps({ files, subjects: conv(20) }))).toEqual({});
  });

  it("a history that mostly ignores Conventional Commits makes the convention free, with the count", () => {
    const found = detectProjectConventions("/p", deps({ subjects: [...free(30), ...conv(10)] }));
    expect(found["commit-convention"]).toEqual({ value: "free", evidence: "git history: 10 of the last 40 commits follow Conventional Commits" });
    expect(detectProjectConventions("/p", deps({ subjects: free(5) }))).toEqual({}); // too few to judge
  });

  it("the registry puts the project between the defaults and kj.config.yml", () => {
    const project = { "commit-convention": { value: "free", evidence: "git history" } };
    const base = { method_gates: { ...DEFAULTS.method_gates } };
    const r = resolveRules(base, { project }).adjustable.find((x) => x.id === "commit-convention");
    expect(r).toMatchObject({ value: "free", origin: "project: git history" });
    const user = resolveRules({ method_gates: { ...DEFAULTS.method_gates, commit_convention: "project" } }, { project });
    expect(user.adjustable.find((x) => x.id === "commit-convention")).toMatchObject({ value: "project", origin: "kj.config.yml" });
  });

  it("moving away from free tightens; any other change between conventions loosens", async () => {
    const { stricter, ADJUSTABLE_RULES } = await import("../../src/gates/registry.js");
    const rule = ADJUSTABLE_RULES.find((r) => r.id === "commit-convention");
    expect(stricter(rule, "free", "conventional")).toBe(true);
    expect(stricter(rule, "project", "conventional")).toBe(false);
    expect(stricter(rule, "conventional", "project")).toBe(false);
  });

  it("kj gates value prints only the resolved value, for a hook to read", () => {
    const out = [];
    gatesValueCommand({ rule: "commit-convention", config: { method_gates: {} }, project: {}, print: (t) => out.push(t) });
    expect(out).toEqual(["conventional"]);
    expect(() => gatesValueCommand({ rule: "nope", config: {}, project: {}, print: () => {} })).toThrow(/no adjustable rule/);
  });
});
