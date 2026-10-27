// ADR 0021, decision 13 and plan step 12c: `atril init` offers the recommended set's available
// entries, from the flags or asked one by one, and hands the answers to applyRecommended.
import { describe, expect, it } from "vitest";
import { answersFor, askAnswers } from "../src/init.js";

const entries = [
  { kind: "command", name: "plan", description: "plan things", state: "available" },
  { kind: "skill", name: "lint", description: "lint code", state: "available" },
  { kind: "command", name: "ship", description: "ship things", state: "persistent" },
  { kind: "command", name: "test", description: "test things", state: "changed" },
];

describe("answersFor", () => {
  it("is null when the flags decide nothing, so init asks", () => {
    expect(answersFor(entries, {})).toBeNull();
  });

  it("--yes answers on-demand for the available entries only", () => {
    expect(answersFor(entries, { yes: true })).toEqual({ "command:plan": "on-demand", "skill:lint": "on-demand" });
  });

  it("--recommended answers its value, none being skip, and wins over --yes", () => {
    expect(answersFor(entries, { recommended: "persistent", yes: true })).toEqual({ "command:plan": "persistent", "skill:lint": "persistent" });
    expect(answersFor(entries, { recommended: "on-demand" })["command:plan"]).toBe("on-demand");
    expect(answersFor(entries, { recommended: "none" })).toEqual({ "command:plan": "skip", "skill:lint": "skip" });
  });

  it("an unknown --recommended fails", () => {
    for (const value of ["all", "toString", ""]) expect(() => answersFor(entries, { recommended: value })).toThrow(/--recommended must be one of on-demand, persistent, none/);
  });
});

describe("askAnswers", () => {
  const replying = (...replies) => {
    const asked = [];
    return { asked, ask: async (question) => { asked.push(question); return replies.shift(); } };
  };

  it("asks each available entry; Enter is on demand, o, p and s choose", async () => {
    const { asked, ask } = replying("", "P");
    expect(await askAnswers(entries, ask)).toEqual({ "command:plan": "on-demand", "skill:lint": "persistent" });
    expect(asked).toEqual([
      "command:plan — plan things [o]n demand (default) / [p]ersistent / [s]kip?",
      "skill:lint — lint code [o]n demand (default) / [p]ersistent / [s]kip?",
    ]);
    expect(await askAnswers(entries, replying(" s ", "o").ask)).toEqual({ "command:plan": "skip", "skill:lint": "on-demand" });
  });

  it("an answer it does not know asks again", async () => {
    const { asked, ask } = replying("x", "constructor", "s", "");
    expect(await askAnswers(entries, ask)).toEqual({ "command:plan": "skip", "skill:lint": "on-demand" });
    expect(asked).toHaveLength(4);
  });

  it("a question that fails (EOF) fails the whole, with no partial answers", async () => {
    await expect(askAnswers(entries, async () => { throw new Error("closed"); })).rejects.toThrow("closed");
  });
});
