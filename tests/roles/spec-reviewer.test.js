// Tests for the spec-reviewer role (KJC-PCS-0048 PR 1).

import { describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { SpecReviewerRole } from "../../src/roles/spec-reviewer-role.js";
import { buildSpecReviewerPrompt, VALID_CATEGORIES } from "../../src/prompts/spec-reviewer.js";

const TEMPLATE = path.resolve(import.meta.dirname, "..", "..", "templates", "roles", "spec-reviewer.md");
const noopLog = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), setContext: vi.fn() };

function role({ output }) {
  return new SpecReviewerRole({
    config: { roles: { coder: { provider: "claude" } } },
    logger: noopLog,
    createAgentFn: () => ({ async runTask() { return { ok: true, output, usage: {} }; } }),
  });
}

describe("spec-reviewer (KJC-PCS-0048 PR 1)", () => {
  it("template + prompt embed every category, severities and the spec verbatim", async () => {
    const tpl = await fs.readFile(TEMPLATE, "utf8");
    expect(tpl.length).toBeGreaterThan(200);
    for (const cat of VALID_CATEGORIES) expect(tpl).toContain(cat);
    for (const sev of ["info", "warn", "fail", "ok"]) expect(tpl).toContain(sev);
    const p = buildSpecReviewerPrompt({ spec: "haz algo bonito", instructions: "EXTRA-Z" });
    expect(p).toContain("Karajan sub-agent");
    expect(p).toContain("haz algo bonito");
    expect(p).toContain("EXTRA-Z");
  });

  it("parses a clean OK response", async () => {
    const res = await role({ output: JSON.stringify({ severity: "ok", findings: [] }) }).execute({ spec: "good" });
    expect(res.ok).toBe(true);
    expect(res.result.severity).toBe("ok");
    expect(res.summary).toMatch(/no findings/i);
  });

  it("derives top-level severity from the worst finding + clamps unknowns", async () => {
    const res = await role({
      output: JSON.stringify({
        severity: "info", // agent under-reports
        findings: [
          { severity: "warn", category: "ambiguity", message: "vague" }, // missing id
          { severity: "nonsense", category: "made-up", message: "x" }, // both invalid → clamped warn/ambiguity
          { severity: "fail", category: "missing_ac", message: "no AC" },
        ],
      }),
    }).execute({ spec: "x" });
    expect(res.result.severity).toBe("fail");
    expect(res.result.findings[0].id).toBe("F-001"); // auto-generated
    expect(res.result.findings[1].severity).toBe("warn");
    expect(res.result.findings[1].category).toBe("ambiguity");
  });

  it("degrades non-JSON output to a single soft warning instead of failing", async () => {
    const res = await role({ output: "garbage prose, no JSON" }).execute({ spec: "x" });
    expect(res.ok).toBe(true);
    expect(res.result.degraded).toBe(true);
    expect(res.result.severity).toBe("warn");
    expect(res.result.findings[0].id).toBe("F-DEG");
  });
});
