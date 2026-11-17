// HU-4536 (KJC-TSK-1665): a role pinned off the declared panel is said, so a substitution made
// for lack of quota does not stay once the panel's agent can act again.
import { describe, expect, it } from "vitest";

import { getPanelPinChecks, pinnedOffPanel, pinnedRoleNotice } from "../../src/checks/panel-pin.js";

const config = (roles) => ({ coder: "claude", reviewer: "codex", roles });

describe("a role pinned off the declared panel", () => {
  it("is found for the coder and the reviewer, and not for a pin that matches the panel", () => {
    expect(pinnedOffPanel(config({ reviewer: { provider: "agy" }, coder: { provider: "claude" } }))).toEqual([{ role: "reviewer", declared: "codex", pinned: "agy" }]);
    expect(pinnedOffPanel(config({ reviewer: { provider: null } }))).toEqual([]);
  });

  it("kj doctor warns with the exact change to go back", async () => {
    const [check] = getPanelPinChecks(config({ reviewer: { provider: "agy" } }));
    const result = await check.detect();
    expect(result).toMatchObject({ ok: false, severity: "warn" });
    expect(result.detail).toMatch(/roles\.reviewer\.provider pins agy; the panel says codex/);
    expect(result.fix).toMatch(/roles\.reviewer\.provider: null/);
    expect((await getPanelPinChecks(config({}))[0].detect()).ok).toBe(true);
  });

  it("kj review says it, or nothing when the panel is followed", () => {
    expect(pinnedRoleNotice(config({ reviewer: { provider: "agy" } }))).toMatch(/roles\.reviewer\.provider pins agy.*roles\.reviewer\.provider: null/);
    expect(pinnedRoleNotice(config({}))).toBeNull();
  });
});
