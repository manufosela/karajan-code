// KJC-TSK-0838 (ADR "Sonar es un gate de commit no evadible", 2026-09-13):
// a diff that touches source files does not enter without a Sonar analysis
// that PROVABLY covered those files. Docs-only diffs are exempt. The only
// other way through is a human grant on the rule — never an env var.
import { describe, it, expect } from "vitest";
import { checkSonarRequirement, SONAR_RULE_ID } from "../../src/review/sonar-requirement.js";

const ran = (extra = {}) => ({ ran: true, projectKey: "k", covered: ["src/a.js"], uncovered: [], blocking: 0, advisory: 0, ...extra });
const grant = (expiresAt) => ({ rule_id: SONAR_RULE_ID, scopeKind: "permanente", expiresAt, who: { git: "human" } });

describe("checkSonarRequirement", () => {
  it("a docs-only diff needs no analysis", () => {
    const r = checkSonarRequirement({ config: {}, stagedFiles: ["README.md", "docs/x.md"], sonar: null });
    expect(r).toMatchObject({ ok: true, mode: "docs-only" });
  });

  it("passes when the analysis ran and covered every staged source", () => {
    const r = checkSonarRequirement({ config: {}, stagedFiles: ["src/a.js", "README.md"], sonar: ran() });
    expect(r).toMatchObject({ ok: true, mode: "pass" });
  });

  it("blocks code without an analysis (or without any sonar block) and names the only way through: a human grant", () => {
    const r = checkSonarRequirement({ config: {}, stagedFiles: ["src/a.js"], sonar: { ran: false, reason: "disabled in config" } });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/Sonar is mandatory for code/);
    expect(r.reason).toContain("disabled in config");
    expect(r.reason).toContain(`kj policy grant --rule ${SONAR_RULE_ID}`);
    expect(checkSonarRequirement({ config: {}, stagedFiles: ["src/a.js"], sonar: undefined }).reason).toMatch(/no sonar block/);
  });

  it("blocks when the analysis never saw a staged source", () => {
    const r = checkSonarRequirement({ config: {}, stagedFiles: ["src/a.js", "packages/x/b.py"], sonar: ran({ uncovered: ["packages/x/b.py"] }) });
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("packages/x/b.py");
  });

  it("a live human grant on the rule lets code through, and says so", () => {
    const r = checkSonarRequirement({
      config: {}, stagedFiles: ["src/a.js"], sonar: { ran: false, reason: "server down" },
      standingExceptions: [grant("2999-01-01T00:00:00Z")], now: new Date("2026-09-14T00:00:00Z"),
    });
    expect(r).toMatchObject({ ok: true, mode: "granted" });
    expect(r.grant.who.git).toBe("human");
  });

  it("an expired grant, a grant on another rule, or any env var: none of them count", () => {
    const blocked = (extra) => checkSonarRequirement({ config: {}, stagedFiles: ["src/a.js"], sonar: { ran: false, reason: "x" }, ...extra }).ok;
    expect(blocked({ standingExceptions: [grant("2026-01-01T00:00:00Z")], now: new Date("2026-09-14T00:00:00Z") })).toBe(false);
    expect(blocked({ standingExceptions: [{ ...grant("2999-01-01T00:00:00Z"), rule_id: "pr_size" }] })).toBe(false);
    expect(blocked({ env: { KJ_ALLOW_SONAR: "1", KJ_ALLOW_POLICY: "1", KJ_ALLOW_NO_TESTS: "1" } })).toBe(false);
  });
});
