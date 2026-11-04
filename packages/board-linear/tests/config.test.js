// HU-3384 (epic #3332): validation of the `linear` block of board.yml.
import { describe, expect, it } from "vitest";
import { validateConfig } from "../src/config.js";

const states = { pending: "Todo", running: "In Progress", done: "Done", failed: "Failed", skipped: "Canceled" };

describe("validateConfig", () => {
  it("accepts a full block and defaults the label to kj:hu", () => {
    expect(validateConfig({ team: "TRI", states })).toEqual({ team: "TRI", label: "kj:hu", states, users: {} });
    expect(validateConfig({ team: "TRI", label: "board", states, users: { alice: "a@acme.test" } })).toMatchObject({ label: "board", users: { alice: "a@acme.test" } });
  });

  it.each([
    ["a missing team", { states }, /linear\.team/],
    ["a missing state", { team: "TRI", states: { pending: "Todo" } }, /running, done, failed, skipped/],
    ["an unknown key", { team: "TRI", states, colour: "red" }, /colour/],
    ["users as a string", { team: "TRI", states, users: "a@acme.test" }, /map/],
    ["users as an array", { team: "TRI", states, users: ["a@acme.test"] }, /map/],
  ])("fails loud on %s", (_name, block, message) => {
    expect(() => validateConfig(block)).toThrow(message);
  });

  it.each(["apiKey", "token", "password"])("refuses a credential key (%s) and points to LINEAR_API_KEY", (name) => {
    expect(() => validateConfig({ team: "TRI", states, [name]: "lin_api_x" })).toThrow(/LINEAR_API_KEY/);
  });
});
