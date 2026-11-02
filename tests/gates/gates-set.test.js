// KJC-TSK-1385 (ADR 0045): kj gates set changes an adjustable rule. The agent may tighten;
// loosening is a human act (ADR 0009); a fixed rule never changes.
import { describe, it, expect } from "vitest";
import { gatesSetCommand } from "../../src/commands/gates.js";
import { HUMAN_ACTS } from "../../src/harden/human-act.js";
import { DEFAULTS } from "../../src/config/defaults.js";

function harness({ project = {}, human = true } = {}) {
  const written = [];
  const acts = [];
  return {
    written, acts,
    deps: {
      config: { method_gates: { ...DEFAULTS.method_gates, ...(project.method_gates || {}) } },
      load: async () => structuredClone(project),
      write: async (path, cfg) => { written.push({ path, cfg }); },
      act: async ({ change }) => { acts.push(change); if (!human) throw new Error("kj gates set (aflojar) es un acto humano"); },
      projectDir: "/p",
      print: () => {},
    },
  };
}

describe("kj gates set", () => {
  it("tightens without a human act and writes the project config", async () => {
    const h = harness({ human: false });
    const res = await gatesSetCommand({ ...h.deps, rule: "tests-with-code", value: "block" });
    expect(res).toMatchObject({ rule: "tests-with-code", value: "block", loosened: false });
    expect(h.acts).toEqual([]);
    expect(h.written[0].path).toBe("/p/.karajan/kj.config.yml");
    expect(h.written[0].cfg.method_gates.tests_with_code).toBe("block");
  });

  it("loosening runs the human act, and an agent is refused", async () => {
    const human = harness({ project: { method_gates: { pr_size_max: 200 } } });
    await gatesSetCommand({ ...human.deps, rule: "pr-size-max", value: "400" });
    expect(human.acts).toEqual(["pr-size-max: 200 → 400"]);
    expect(human.written[0].cfg.method_gates.pr_size_max).toBe(400);

    const agent = harness({ human: false });
    await expect(gatesSetCommand({ ...agent.deps, rule: "mutation", value: "off" })).resolves.toMatchObject({ loosened: false });
    await expect(gatesSetCommand({ ...agent.deps, rule: "pr-size", value: "warn" })).resolves.toBeTruthy();
    const loosen = harness({ project: { method_gates: { tests_with_code: "block" } }, human: false });
    await expect(gatesSetCommand({ ...loosen.deps, rule: "tests-with-code", value: "warn" })).rejects.toThrow(/acto humano/);
    expect(loosen.written).toEqual([]);
  });

  it("refuses a fixed rule, an unknown one and a value the rule does not take", async () => {
    const h = harness();
    await expect(gatesSetCommand({ ...h.deps, rule: "card-first", value: "off" })).rejects.toThrow(/fixed/);
    await expect(gatesSetCommand({ ...h.deps, rule: "nope", value: "off" })).rejects.toThrow(/no adjustable rule/);
    await expect(gatesSetCommand({ ...h.deps, rule: "mutation", value: "loud" })).rejects.toThrow(/off, warn, block/);
    await expect(gatesSetCommand({ ...h.deps, rule: "pr-size-max", value: "-3" })).rejects.toThrow(/positive whole number/);
    expect(h.written).toEqual([]);
  });

  it("loosening is in the closed catalog of human acts, implemented by the gates command", () => {
    expect(HUMAN_ACTS["gates-loosen"]).toMatchObject({ module: "src/commands/gates.js" });
  });
});
