/**
 * KJC-TSK-0859: the declared chain, built from config. The schema
 * (roles.<role>.fallback) and the walker in withBrainRecovery both existed;
 * nothing ever built the thing in between, so every declared chain was dead
 * config.
 */
import { describe, expect, it, vi } from "vitest";

import { buildRoleFallbackChain, MAX_CHAIN_LINKS, withRoleModel } from "../../src/brain/role-fallback-chain.js";

const fakeAgent = (name) => ({ name, runTask: vi.fn(async () => ({ ok: true })), reviewTask: vi.fn(async () => ({ ok: true })) });
const logger = () => ({ info: vi.fn(), warn: vi.fn() });

describe("withRoleModel", () => {
  it("swaps provider and model for the role, leaving the rest of the config alone", () => {
    const config = { projectDir: "/r", roles: { coder: { provider: "codex", model: "gpt-5.4" } }, development: { methodology: "tdd" } };
    const next = withRoleModel(config, "coder", "claude", "opus");
    expect(next.roles.coder).toEqual({ provider: "claude", model: "opus" });
    expect(next.development).toBe(config.development);
    expect(config.roles.coder.provider).toBe("codex"); // the original is untouched
  });

  it("a link without a model asks for the provider default, not for null-as-a-model", () => {
    expect(withRoleModel({}, "coder", "claude", undefined).roles.coder.model).toBeNull();
  });
});

describe("buildRoleFallbackChain", () => {
  it("no declared chain, no chain built", () => {
    expect(buildRoleFallbackChain({ config: { roles: { coder: { provider: "codex" } } }, role: "coder" })).toBeNull();
  });

  it("builds one agent per link, in the declared order, each with its own model", () => {
    const createAgentFn = vi.fn((provider, config) => fakeAgent(`${provider}:${config.roles.coder.model}`));
    const config = {
      roles: {
        coder: {
          provider: "codex", model: "gpt-5.4",
          fallback: { provider: "codex", model: "gpt-5.6-terra", fallback: { provider: "claude", model: "opus" } },
        },
      },
    };
    const chain = buildRoleFallbackChain({ config, role: "coder", createAgentFn });

    expect(chain).toMatchObject({ provider: "codex", model: "gpt-5.6-terra" });
    expect(chain.fallback).toMatchObject({ provider: "claude", model: "opus" });
    // …and the provider-default tail closes it (see the tail suite below).
    expect(chain.fallback.fallback).toMatchObject({ provider: "codex", model: null });
    expect(createAgentFn.mock.calls.map((c) => c[0])).toEqual(["codex", "claude", "codex"]);
    // Each link runs with ITS model, not with the primary's.
    expect(createAgentFn.mock.calls[0][1].roles.coder.model).toBe("gpt-5.6-terra");
  });

  it("calls the role's own agent method, so the reviewer keeps reviewing", async () => {
    const agent = fakeAgent("codex");
    const chain = buildRoleFallbackChain({
      config: { roles: { reviewer: { provider: "codex", fallback: { provider: "claude" } } } },
      role: "reviewer", agentMethod: "reviewTask", createAgentFn: () => agent,
    });
    await chain.agent.runTask({ prompt: "p" });
    expect(agent.reviewTask).toHaveBeenCalled();
    expect(agent.runTask).not.toHaveBeenCalled();
  });

  it("a link repeating the primary is skipped: retrying the same thing is not progress", () => {
    const log = logger();
    const chain = buildRoleFallbackChain({
      config: { roles: { coder: { provider: "codex", model: "gpt-5.4", fallback: { provider: "codex", model: "gpt-5.4", fallback: { provider: "claude", model: "opus" } } } } },
      role: "coder", createAgentFn: (p) => fakeAgent(p), logger: log,
    });
    expect(chain).toMatchObject({ provider: "claude", model: "opus" });
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining("repeats one already in the chain"));
  });

  it("an unusable link is said out loud and skipped, without losing the links behind it", () => {
    const log = logger();
    const createAgentFn = vi.fn((provider) => {
      if (provider === "typo") throw new Error("unknown agent: typo");
      return fakeAgent(provider);
    });
    const chain = buildRoleFallbackChain({
      config: { roles: { coder: { provider: "codex", fallback: { provider: "typo", fallback: { provider: "claude", model: "opus" } } } } },
      role: "coder", createAgentFn, logger: log,
    });
    expect(chain).toMatchObject({ provider: "claude", model: "opus" });
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining("unusable"));
  });

  it("stops at the link cap and says so, instead of building forever", () => {
    const log = logger();
    let link = { provider: "claude", model: "m9" };
    for (let i = 8; i >= 0; i -= 1) link = { provider: "claude", model: `m${i}`, fallback: link };
    const chain = buildRoleFallbackChain({
      config: { roles: { coder: { provider: "codex", fallback: link } } },
      role: "coder", createAgentFn: (p) => fakeAgent(p), logger: log,
    });
    let depth = 0;
    for (let node = chain; node; node = node.fallback) depth += 1;
    expect(depth).toBe(MAX_CHAIN_LINKS);
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining("longer than"));
  });
});

// KJC-TSK-0859 rodaja D: cada agente guardaba un reintento privado que tiraba
// el modelo fijado y probaba con el default del proveedor. Ese paso pasa a ser
// la COLA de la cadena: se ve, y va despues de lo que el usuario declaro.
describe("buildRoleFallbackChain — la cola del default del proveedor", () => {
  it("con modelo fijado y sin cadena declarada, la cola es el default del proveedor", () => {
    const chain = buildRoleFallbackChain({
      config: { roles: { coder: { provider: "codex", model: "gpt-5.4" } } },
      role: "coder", createAgentFn: (p) => fakeAgent(p),
    });
    expect(chain).toMatchObject({ provider: "codex", model: null });
    expect(chain.fallback).toBeNull();
  });

  it("la cola va DESPUES de lo declarado, nunca antes", () => {
    const chain = buildRoleFallbackChain({
      config: { roles: { coder: { provider: "codex", model: "gpt-5.4", fallback: { provider: "claude", model: "opus" } } } },
      role: "coder", createAgentFn: (p) => fakeAgent(p),
    });
    expect(chain).toMatchObject({ provider: "claude", model: "opus" });
    expect(chain.fallback).toMatchObject({ provider: "codex", model: null });
    expect(chain.fallback.fallback).toBeNull();
  });

  it("sin modelo fijado no hay cola: el primario YA es el default del proveedor", () => {
    expect(buildRoleFallbackChain({
      config: { roles: { coder: { provider: "codex" } } },
      role: "coder", createAgentFn: (p) => fakeAgent(p),
    })).toBeNull();
  });

  it("si lo declarado ya incluye el default del proveedor, no se duplica", () => {
    const chain = buildRoleFallbackChain({
      config: { roles: { coder: { provider: "codex", model: "gpt-5.4", fallback: { provider: "codex" } } } },
      role: "coder", createAgentFn: (p) => fakeAgent(p),
    });
    expect(chain).toMatchObject({ provider: "codex", model: null });
    expect(chain.fallback).toBeNull();
  });
});
