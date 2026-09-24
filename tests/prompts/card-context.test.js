/**
 * KJC-TSK-0864: the coder reads the card, not just a sentence. A card kj
 * cannot read is passed through as a reference, never as silence.
 */
import { describe, expect, it, vi } from "vitest";

import { resolveCardContext, taskWithCard } from "../../src/prompts/card-context.js";

const hu = {
  id: "HU-42-0",
  title: "the panel is announced",
  description: "As a user I want the panel said out loud",
  status: "pending",
  acceptanceCriteria: "Given a declared panel\nWhen the session starts\nThen it is announced",
};

describe("resolveCardContext", () => {
  it("no reference, no context (nothing invented)", async () => {
    expect(await resolveCardContext({ projectDir: "/x", ref: null })).toBeNull();
    expect(await resolveCardContext({ projectDir: "/x", ref: "   " })).toBeNull();
  });

  it("a local HU brings its statement and its criteria as gherkin", async () => {
    const getHu = vi.fn(async () => hu);
    const card = await resolveCardContext({ projectDir: "/x", ref: hu.id, deps: { getHu } });
    expect(getHu).toHaveBeenCalledWith("/x", hu.id);
    expect(card).toMatchObject({ huId: hu.id, title: hu.title, external: false });
    expect(card.section).toContain("the panel is announced");
    expect(card.section).toContain("As a user I want the panel said out loud");
    expect(card.acceptanceTests).toEqual([{ type: "gherkin", content: hu.acceptanceCriteria }]);
  });

  it("a local HU without criteria passes none rather than an empty test", async () => {
    const getHu = vi.fn(async () => ({ ...hu, acceptanceCriteria: "  " }));
    const card = await resolveCardContext({ projectDir: "/x", ref: hu.id, deps: { getHu } });
    expect(card.acceptanceTests).toBeNull();
  });

  it("an id kj does not own travels as a reference, flagged external", async () => {
    const getHu = vi.fn();
    const card = await resolveCardContext({ projectDir: "/x", ref: "KJC-TSK-0864", deps: { getHu } });
    expect(getHu).not.toHaveBeenCalled();
    expect(card).toMatchObject({ huId: "KJC-TSK-0864", external: true, acceptanceTests: null });
    expect(card.section).toMatch(/kj cannot read/);
    expect(card.section).toMatch(/ASK instead of guessing/);
  });

  it("a local id that does not exist fails loudly", async () => {
    const getHu = vi.fn(async () => { throw new Error("HU HU-9 not found"); });
    await expect(resolveCardContext({ projectDir: "/x", ref: "HU-9", deps: { getHu } })).rejects.toThrow(/not found/);
  });
});

describe("taskWithCard", () => {
  it("puts the card before the task, and leaves the task alone without one", () => {
    const card = { section: "## Card HU-1 — x" };
    expect(taskWithCard("do the thing", card)).toBe("## Card HU-1 — x\n\n## Task\n\ndo the thing");
    expect(taskWithCard("do the thing", null)).toBe("do the thing");
  });
});
