// KJC-TSK-1387 (ADR 0045): every gate applies its rule's RESOLVED value. The config loader
// puts the resolved values in method_gates (which the gates already read) and keeps what was
// declared apart, so kj gates still tells where each value comes from.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { applyEffectiveGates } from "../../src/gates/effective.js";
import { resolveRules } from "../../src/gates/registry.js";
import { writeConfig } from "../../src/config/loader.js";
import { DEFAULTS } from "../../src/config/defaults.js";

const signals = (project) => () => ({ project, conflicts: [], stale: [] });
const declared = () => ({ method_gates: { ...DEFAULTS.method_gates, tests_with_code: "block" }, review_mode: "standard" });

describe("effective gates", () => {
  it("method_gates carries the resolved values; untouched rules keep their declared value", () => {
    const project = { "pr-size-max": { value: 400, evidence: 'CONTRIBUTING.md: "under 400 lines"' } };
    const config = applyEffectiveGates(declared(), "/p", signals(project));
    expect(config.method_gates.pr_size_max).toBe(400);
    expect(config.method_gates.tests_with_code).toBe("block");
    expect(config.method_gates.card_first).toBe(DEFAULTS.method_gates.card_first);
    // a synthetic default is not written: a gate reading `if (mode)` must still see nothing
    expect(config.method_gates.mutation).toBeUndefined();
  });

  it("kj gates still reads what was declared, so origins stay right", () => {
    const project = { "pr-size-max": { value: 400, evidence: "CONTRIBUTING.md" } };
    const config = applyEffectiveGates(declared(), "/p", signals(project));
    const byId = (id) => resolveRules(config, { project }).adjustable.find((r) => r.id === id);
    expect(byId("pr-size-max").origin).toBe("project: CONTRIBUTING.md");
    expect(byId("tests-with-code").origin).toBe("kj.config.yml");
  });

  it("writing the config back never persists a resolved value as if the user had set it", async () => {
    const config = applyEffectiveGates(declared(), "/p", signals({ "pr-size-max": { value: 400, evidence: "x" } }));
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-effective-"));
    const file = path.join(dir, "kj.config.yml");
    await writeConfig(file, config);
    const text = fs.readFileSync(file, "utf8");
    fs.rmSync(dir, { recursive: true, force: true });
    expect(text).not.toMatch(/pr_size_max: 400/);
    expect(text).not.toMatch(/method_gates_declared/);
    expect(text).toMatch(/tests_with_code: block/);
  });
});
