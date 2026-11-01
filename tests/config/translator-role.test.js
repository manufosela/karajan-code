// HU-2782 (ADR 0039, decision 2): the `translator` role inherits the coder unless configured.
import { describe, it, expect } from "vitest";
import { resolveRole } from "../../src/config/role-resolver.js";
import { safeParseConfig } from "../../src/config/schema.js";

describe("translator role", () => {
  const base = { roles: { coder: { provider: "claude" } }, coder_options: { model: "opus" } };

  it("inherits the coder's provider and model when unconfigured", () => {
    expect(resolveRole(base, "translator")).toEqual({ provider: "claude", model: "opus" });
  });

  it("honours its own provider and model", () => {
    const own = { ...base, roles: { ...base.roles, translator: { provider: "claude", model: "haiku" } } };
    expect(resolveRole(own, "translator")).toEqual({ provider: "claude", model: "haiku" });
  });

  it("is accepted by the config schema", () => {
    expect(safeParseConfig({ roles: { translator: { provider: "claude", model: "haiku" } } }).success).toBe(true);
  });
});
