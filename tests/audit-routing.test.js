import { describe, it, expect } from "vitest";
import { classifyIntent } from "../src/guards/intent-guard.js";
import { applyPolicies, VALID_TASK_TYPES, DEFAULT_POLICIES } from "../src/guards/policy-resolver.js";

describe("audit-routing: policy resolver", () => {
  it("accepts 'audit' as a valid task type", () => {
    expect(VALID_TASK_TYPES.has("audit")).toBe(true);
  });

  it("accepts 'analysis' as a valid task type", () => {
    expect(VALID_TASK_TYPES.has("analysis")).toBe(true);
  });

  it("audit policy disables tdd, sonar, reviewer, tests, and coder", () => {
    const policies = applyPolicies({ taskType: "audit" });
    expect(policies.taskType).toBe("audit");
    expect(policies.tdd).toBe(false);
    expect(policies.sonar).toBe(false);
    expect(policies.reviewer).toBe(false);
    expect(policies.testsRequired).toBe(false);
    expect(policies.coderRequired).toBe(false);
  });

  it("analysis policy disables tdd, sonar, reviewer, tests, and coder", () => {
    const policies = applyPolicies({ taskType: "analysis" });
    expect(policies.taskType).toBe("analysis");
    expect(policies.tdd).toBe(false);
    expect(policies.sonar).toBe(false);
    expect(policies.reviewer).toBe(false);
    expect(policies.testsRequired).toBe(false);
    expect(policies.coderRequired).toBe(false);
  });

  it("sw policy does NOT set coderRequired to false", () => {
    const policies = applyPolicies({ taskType: "sw" });
    expect(policies.taskType).toBe("sw");
    expect(policies.coderRequired).toBeUndefined();
  });
});

describe("audit-routing: intent guard classifies audit tasks", () => {
  it("classifies 'Audit security OWASP' as audit", () => {
    const result = classifyIntent("Audit security OWASP top 10");
    expect(result.classified).toBe(true);
    expect(result.taskType).toBe("audit");
    expect(result.patternId).toBe("audit");
  });

  it("classifies 'Analizar seguridad' as audit (Spanish)", () => {
    const result = classifyIntent("Analizar seguridad del proyecto");
    expect(result.classified).toBe(true);
    expect(result.taskType).toBe("audit");
    expect(result.patternId).toBe("audit");
  });

  it("classifies 'Scan for vulnerabilities' as audit", () => {
    const result = classifyIntent("Scan for vulnerabilities in dependencies");
    expect(result.classified).toBe(true);
    expect(result.taskType).toBe("audit");
  });

  it("classifies 'Verificar cumplimiento' as audit (Spanish)", () => {
    const result = classifyIntent("Verificar cumplimiento de estandares");
    expect(result.classified).toBe(true);
    expect(result.taskType).toBe("audit");
  });

  it("does NOT classify 'Build a REST API' as audit", () => {
    const result = classifyIntent("Build a REST API for user management");
    expect(result.classified).toBe(false);
  });
});

describe("audit-routing: end-to-end policy chain", () => {
  it("audit intent -> audit policy -> coderRequired false", () => {
    const intent = classifyIntent("Audit security OWASP top 10");
    expect(intent.classified).toBe(true);
    expect(intent.taskType).toBe("audit");

    const policies = applyPolicies({ taskType: intent.taskType });
    expect(policies.coderRequired).toBe(false);
    expect(policies.reviewer).toBe(false);
  });

  it("normal task intent -> sw policy -> coder runs normally", () => {
    const intent = classifyIntent("Build a REST API for user management");
    expect(intent.classified).toBe(false);

    // Falls back to sw
    const policies = applyPolicies({ taskType: null });
    expect(policies.taskType).toBe("sw");
    expect(policies.coderRequired).toBeUndefined();
    expect(policies.reviewer).toBe(true);
  });
});
