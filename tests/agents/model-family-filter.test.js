// KJC-BUG-0144 (campo, issue #1465): kj start pasaba el modelo "haiku"
// (familia Claude) a agy — el default del rol start es haiku pero el
// provider cae al coder, y getRoleModel devolvía el modelo crudo sin
// comprobar a qué familia pertenece. El modelo por defecto se resuelve
// POR PROVIDER: un modelo de otra familia se descarta (con aviso) y el
// agente usa su default.

import { describe, it, expect, vi } from "vitest";
import { BaseAgent } from "../../src/agents/base-agent.js";
import { isModelCompatible } from "../../src/config/role-resolver.js";

const mkLogger = () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() });
const agentWith = (name, config, logger = mkLogger()) => new BaseAgent(name, config, logger);

describe("isModelCompatible — familias por provider", () => {
  it.each([
    ["agy", "haiku", false],
    ["agy", "claude-haiku-4.5", false],
    ["agy", "gemini-2.5-pro", true], // agy = Antigravity, familia gemini
    ["codex", "haiku", false],
    ["codex", "gpt-5-mini", true],
    ["claude", "haiku", true],
    ["claude", "gemini-2.5-pro", false],
    // Hosts multi-modelo (BYOM): enrutan a modelos de cualquier familia.
    ["aider", "gpt-4o", true],
    ["copilot", "haiku", true],
    ["opencode", "gemma-local/coder", true],
  ])("%s + %s → %s", (agent, model, expected) => {
    expect(isModelCompatible(agent, model)).toBe(expected);
  });
});

describe("BaseAgent.getRoleModel — el caso de Pedro (start con haiku sobre agy)", () => {
  it("descarta el modelo de otra familia y avisa (agy + haiku → null)", () => {
    const logger = mkLogger();
    const agent = agentWith("agy", { roles: { start: { model: "haiku" } } }, logger);
    expect(agent.getRoleModel("start")).toBeNull();
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("haiku"));
  });

  it("mantiene el modelo cuando la familia coincide (claude + haiku)", () => {
    const agent = agentWith("claude", { roles: { start: { model: "haiku" } } });
    expect(agent.getRoleModel("start")).toBe("haiku");
  });

  it("mantiene modelos de familia indeterminada (local/custom)", () => {
    const agent = agentWith("opencode", { roles: { coder: { model: "coder" } } });
    expect(agent.getRoleModel("coder")).toBe("coder");
  });

  it("tambien filtra los modelos heredados de coder_options", () => {
    const logger = mkLogger();
    const agent = agentWith("codex", { coder_options: { model: "sonnet" } }, logger);
    expect(agent.getRoleModel("coder")).toBeNull();
  });
});
