// HU-3533 (KJC-TSK-1445): kj code writes a card with the model of the tier it was planned with,
// as kj run's coder stage did; a model the user chose always wins.
import { describe, it, expect } from "vitest";
import { routedCoderConfig } from "../../src/hu/coder-routing.js";

const config = { coder: "claude", roles: { coder: { provider: "claude" }, reviewer: { provider: "codex" } } };

describe("routedCoderConfig", () => {
  it("runs a trivial card on the cheap model with low effort, and a standard one on the middle model", () => {
    const trivial = routedCoderConfig({ config, card: { tier: "trivial" } });
    expect(trivial.config.roles.coder).toMatchObject({ provider: "claude", model: "haiku", effort: "low" });
    expect(trivial.config.roles.reviewer).toEqual({ provider: "codex" });
    expect(trivial.reason).toMatch(/trivial HU -> haiku/);
    expect(routedCoderConfig({ config, card: { tier: "standard" } }).config.roles.coder).toMatchObject({ model: "sonnet", effort: "medium" });
  });

  it("leaves the config as it is for a deep card, a card with no tier, or a model the user chose, and says why", () => {
    expect(routedCoderConfig({ config, card: { tier: "deep" } })).toMatchObject({ config, reason: expect.stringMatching(/deep/) });
    expect(routedCoderConfig({ config, card: { tier: null } })).toMatchObject({ config, reason: expect.stringMatching(/no tier/) });
    const chosen = { ...config, roles: { ...config.roles, coder: { provider: "claude", model: "opus" } } };
    expect(routedCoderConfig({ config: chosen, card: { tier: "trivial" } })).toMatchObject({ config: chosen, reason: expect.stringMatching(/chosen/) });
    expect(routedCoderConfig({ config, card: null })).toMatchObject({ config });
  });

  it("takes the model set on the card's board over its tier", () => {
    expect(routedCoderConfig({ config, card: { tier: "trivial", coderModel: "sonnet" } }).config.roles.coder.model).toBe("sonnet");
  });
});
