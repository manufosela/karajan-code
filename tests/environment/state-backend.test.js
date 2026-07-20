// ENV-D1 (KJC-TSK-0642): state_backend is a first-class choice — the schema
// only admits the two real backends, defaults to hu-board, and the installed
// playbook orders the host to track work in the CHOSEN backend, not a vague
// "board or PG".
import { describe, it, expect } from "vitest";
import * as v from "valibot";
import { ConfigSchema } from "../../src/config/schema.js";
import { DEFAULTS } from "../../src/config/defaults.js";
import { renderPlaybook } from "../../src/environment/playbook.js";

describe("state_backend config", () => {
  it("defaults to hu-board", () => {
    expect(DEFAULTS.state_backend).toBe("hu-board");
  });

  it("schema accepts both backends and rejects anything else", () => {
    for (const ok of ["hu-board", "planning-game"]) {
      expect(() => v.parse(ConfigSchema, { state_backend: ok })).not.toThrow();
    }
    expect(() => v.parse(ConfigSchema, { state_backend: "jira" })).toThrow(/hu-board|planning-game/);
  });
});

describe("playbook renders the chosen backend", () => {
  it("hu-board: orders tracking in the HU Board", () => {
    const text = renderPlaybook({ stateBackend: "hu-board" });
    expect(text).toMatch(/HU Board/);
    expect(text).not.toMatch(/Planning Game MCP/);
  });

  it("planning-game: orders tracking in the Planning Game MCP", () => {
    const text = renderPlaybook({ stateBackend: "planning-game" });
    expect(text).toMatch(/Planning Game MCP/);
    expect(text).not.toMatch(/HU Board/);
  });

  it("default render matches the shipped default backend", () => {
    expect(renderPlaybook({})).toMatch(/HU Board/);
  });
});
