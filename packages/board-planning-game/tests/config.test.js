// KJC-TSK-1417 step 1: the `planning-game` block of board.yml and the map between kj statuses and
// Planning Game states. The Planning Game is reached only through its MCP server (the owner's decision).
import { describe, expect, it } from "vitest";
import { kjStatusOf, validateConfig } from "../src/config.js";

const block = { server: "planning-game-personal", project: "KJC", epic: "KJC-PCS-0026", developer: "dev_016", validator: "stk_001" };

describe("planning-game config", () => {
  it("takes the server, the project and the card defaults, with the default state map", () => {
    expect(validateConfig(block)).toEqual({
      ...block,
      states: { pending: "To Do", running: "In Progress", done: "To Validate", failed: "Blocked", skipped: "Pausado" },
      users: {},
    });
  });

  it("a state map overrides only what it names, and users map kj identities to developers", () => {
    const config = validateConfig({ ...block, states: { done: "Done" }, users: { manu: "dev_001" } });
    expect(config.states).toMatchObject({ done: "Done", running: "In Progress" });
    expect(config.users).toEqual({ manu: "dev_001" });
  });

  it("refuses what is missing, unknown, malformed or a credential, naming it", () => {
    expect(() => validateConfig(undefined)).toThrow(/block is missing/);
    expect(() => validateConfig({ ...block, project: "" })).toThrow(/planning-game.project is required/);
    expect(() => validateConfig({ ...block, developer: "manu" })).toThrow(/developer.*dev_/);
    expect(() => validateConfig({ ...block, validator: "dev_001" })).toThrow(/validator.*stk_/);
    expect(() => validateConfig({ ...block, users: { manu: "x" } })).toThrow(/users.manu.*dev_/);
    expect(() => validateConfig({ ...block, colour: "red" })).toThrow(/unknown key "colour"/);
    expect(() => validateConfig({ ...block, apiKey: "x" })).toThrow(/credentials/);
    expect(() => validateConfig({ ...block, states: { done: "" } })).toThrow(/states.done/);
    expect(() => validateConfig({ ...block, states: { typo: "X" } })).toThrow(/states: unknown kj status "typo"/);
    expect(() => validateConfig({ ...block, states: "To Do" })).toThrow(/states must be a map/);
    // An empty `states:` or `users:` in YAML arrives as null: said, never read as the defaults.
    expect(() => validateConfig({ ...block, states: null })).toThrow(/states must be a map/);
    expect(() => validateConfig({ ...block, users: null })).toThrow(/users must be a map/);
    // Two kj statuses on one Planning Game state would make the read-back a guess.
    expect(() => validateConfig({ ...block, states: { running: "To Do" } })).toThrow(/pending and running.*"To Do"/);
    try { validateConfig({ ...block, project: "" }); } catch (err) { expect(err.name).toBe("BoardRejectedError"); }
  });

  it("reads a Planning Game state back as a kj status, and an unmapped one as nothing", () => {
    const { states } = validateConfig(block);
    expect(kjStatusOf("In Progress", states)).toBe("running");
    expect(kjStatusOf("Done&Validated", states)).toBe(null);
  });
});
