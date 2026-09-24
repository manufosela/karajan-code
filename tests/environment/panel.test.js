/**
 * KJC-TSK-0865: the panel is the user's choice, so it is said out loud.
 * The line informs and never blocks, and a project with no panel gets no
 * line at all (attention spent to say nothing is attention wasted).
 */
import { describe, expect, it } from "vitest";

import { panelLine, panelSummary, resolvePanel } from "../../src/environment/panel.js";
import { renderPlaybook } from "../../src/environment/playbook.js";

describe("resolvePanel", () => {
  it("reads the legacy coder/reviewer keys and lets solomon inherit the coder", () => {
    expect(resolvePanel({ coder: "codex", reviewer: "claude" })).toEqual({
      coder: "codex",
      reviewer: "claude",
      solomon: "codex",
    });
  });

  it("an explicit roles block wins over the legacy keys", () => {
    const config = { coder: "claude", reviewer: "codex", roles: { solomon: { provider: "agy" } } };
    expect(resolvePanel(config)).toMatchObject({ coder: "claude", reviewer: "codex", solomon: "agy" });
  });

  it("an empty config declares nobody", () => {
    expect(resolvePanel({})).toEqual({ coder: null, reviewer: null, solomon: null });
  });
});

describe("panelLine", () => {
  it("names who writes and who reviews, and who says it when the host writes", () => {
    const line = panelLine({ coder: "codex", reviewer: "claude" });
    expect(line).toContain("coder=codex");
    expect(line).toContain("reviewer=claude");
    expect(line).toMatch(/say so/i);
    // It announces: nothing in it forbids or blocks the host from writing.
    expect(line).not.toMatch(/blocked|forbidden|you may not/i);
  });

  it("only names solomon when it differs from the coder (no noise)", () => {
    expect(panelLine({ coder: "codex", reviewer: "claude" })).not.toContain("solomon");
    const arbitrated = panelLine({ coder: "codex", reviewer: "claude", roles: { solomon: { provider: "agy" } } });
    expect(arbitrated).toContain("solomon=agy");
  });

  it("no panel declared, no line", () => {
    expect(panelLine({})).toBeNull();
    expect(panelLine(null)).toBeNull();
  });

  it("a half-declared panel still says what it knows", () => {
    expect(panelLine({ reviewer: "codex" })).toContain("coder=unset");
  });
});

describe("panelSummary", () => {
  it("reads as a human line, and says so when nobody is declared", () => {
    expect(panelSummary({ coder: "codex", reviewer: "claude" })).toBe("panel: coder codex · reviewer claude");
    expect(panelSummary({})).toMatch(/not declared/);
  });
});

describe("the playbook carries the panel", () => {
  it("the invariant appears when there is a panel and the budget still holds", () => {
    const text = renderPlaybook({ config: { coder: "codex", reviewer: "claude" } });
    expect(text).toContain("coder=codex");
    expect(text.split("\n").length).toBeLessThanOrEqual(60);
  });

  it("no panel, no invariant — the playbook is unchanged", () => {
    expect(renderPlaybook({})).not.toMatch(/The panel is your user/);
  });
});
