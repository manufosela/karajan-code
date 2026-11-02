// KJC-TSK-1388 (ADR 0045): kj doctor has a rules check, and kj init ends with the rules list.
// A CONTRIBUTING that contradicts a fixed rule, or a setting whose sentence is gone, is said.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRulesCheck } from "../../src/checks/rules-gates.js";
import { rulesAtClose } from "../../src/gates/summary.js";
import { DEFAULTS } from "../../src/config/defaults.js";

let dir;
beforeEach(() => {
  dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "kj-rulescheck-")));
  fs.writeFileSync(path.join(dir, "CONTRIBUTING.md"), "We commit straight to main for hotfixes.\n");
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const config = (contributing_rules = []) => ({ method_gates: { ...DEFAULTS.method_gates }, contributing_rules });

describe("rules check", () => {
  it("nothing odd: an info line with the count and where to look", async () => {
    const r = await createRulesCheck({ projectDir: dir }).detect({ config: config() });
    expect(r).toMatchObject({ ok: true, severity: "info" });
    expect(r.detail).toMatch(/5 fixed rules, \d+ adjustable.*kj gates/);
  });

  it("a CONTRIBUTING sentence against a fixed rule, or a setting gone stale, is a warning with the quote", async () => {
    const rules = [
      { rule: "card-first", value: "off", quote: "We commit straight to main for hotfixes." },
      { rule: "pr-size-max", value: 400, quote: "Pull requests should stay under 400 lines." },
    ];
    const r = await createRulesCheck({ projectDir: dir }).detect({ config: config(rules) });
    expect(r).toMatchObject({ ok: false, severity: "warn" });
    expect(r.detail).toMatch(/card-first.*straight to main/);
    expect(r.detail).toMatch(/pr-size-max.*no longer applies/);
    expect(r.fix).toMatch(/kj gates/);
  });

  it("kj init closes with the full list", () => {
    const lines = rulesAtClose({ config: config(), projectDir: dir });
    expect(lines.join("\n")).toMatch(/Fixed rules[\s\S]*Adjustable rules[\s\S]*kj gates/);
  });
});
