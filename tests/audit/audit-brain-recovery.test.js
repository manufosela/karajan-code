/**
 * KJC-BUG-0194: audit era el UNICO rol que se saltaba el brain. Llamaba a
 * agent.runTask() directamente, asi que un muro de cuota no se clasificaba
 * (el MCP lo servia como category 'unknown') y roles.audit.fallback se
 * ignoraba, incluso despues de conectar la cadena en la KJC-TSK-0859.
 *
 * Y la politica importa: un comando no puede hibernar horas. Ante cuota toma
 * el siguiente candidato EN EL ACTO.
 */
import { describe, expect, it, vi } from "vitest";

import { AuditRole } from "../../src/roles/audit-role.js";

const quotaWall = () => {
  const at = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();
  return { ok: false, error: `monthly usage limit, resets at ${at}`, exitCode: 1 };
};
const deadModel = () => ({ ok: false, error: "model claude-fable-5 is not supported", exitCode: 1 });
const goodAudit = () => ({ ok: true, output: JSON.stringify({ summary: "ok", dimensions: {}, topRecommendations: [] }), exitCode: 0 });

const ctx = { projectDir: "/repo", basalCost: null, growthDelta: null, stack: null, sonarFindings: null, webperf: null, osvFindings: null, semgrepFindings: null, circularDeps: null, deadExports: null, envKeys: null };

/** A role whose agents come from a map of provider::model, so the chain is observable. */
const roleWith = (config, agents) => {
  const created = [];
  const role = new AuditRole({
    config,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    createAgentFn: (provider, cfg) => {
      const key = `${provider}::${cfg?.roles?.audit?.model ?? ""}`;
      created.push(key);
      return { runTask: agents[key] || (() => { throw new Error(`no agent for ${key}`); }) };
    },
  });
  return { role, created };
};

describe("AuditRole y el brain", () => {
  it("una cuota agotada toma el siguiente eslabon declarado, sin hibernar", async () => {
    const config = {
      projectDir: "/repo",
      roles: { audit: { provider: "claude", model: "claude-fable-5", fallback: { provider: "codex", model: "gpt-5.6-terra" } } },
    };
    const primary = vi.fn(async () => quotaWall());
    const next = vi.fn(async () => goodAudit());
    const { role } = roleWith(config, { "claude::claude-fable-5": primary, "codex::gpt-5.6-terra": next });

    const res = await role.executeWithDeterministic({ task: "audita" }, ctx);

    expect(res.ok).toBe(true);
    // El eslabon declarado es quien acaba respondiendo, que es lo que el bug pedia.
    expect(primary).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("un modelo retirado tambien: es el caso que se reporto con fable", async () => {
    const config = {
      projectDir: "/repo",
      roles: { audit: { provider: "claude", model: "claude-fable-5", fallback: { provider: "claude", model: "sonnet" } } },
    };
    const { role } = roleWith(config, {
      "claude::claude-fable-5": vi.fn(async () => deadModel()),
      "claude::sonnet": vi.fn(async () => goodAudit()),
    });

    expect((await role.executeWithDeterministic({ task: "audita" }, ctx)).ok).toBe(true);
  });

  it("agotada la cadena, el fallo lleva la CLASE y el itinerario, no un error generico", async () => {
    const config = { projectDir: "/repo", roles: { audit: { provider: "claude", model: "claude-fable-5" } } };
    const { role } = roleWith(config, {
      "claude::claude-fable-5": vi.fn(async () => quotaWall()),
      "claude::": vi.fn(async () => quotaWall()), // la cola: default del proveedor
    });

    const res = await role.executeWithDeterministic({ task: "audita" }, ctx);

    expect(res.ok).toBe(false);
    // Esto es lo que el MCP servia como category 'unknown'.
    expect(res.result.recovery.class).toBe("QUOTA_EXHAUSTED_MONTHLY");
    expect(res.summary).toContain("QUOTA_EXHAUSTED_MONTHLY");
    expect(res.result.tried.length).toBeGreaterThan(0);
  });

  it("el camino feliz no cambia: un agente que responde bien se usa y punto", async () => {
    const config = { projectDir: "/repo", roles: { audit: { provider: "claude" } } };
    const runTask = vi.fn(async () => goodAudit());
    const { role } = roleWith(config, { "claude::": runTask });

    const res = await role.executeWithDeterministic({ task: "audita" }, ctx);

    expect(res.ok).toBe(true);
    expect(runTask).toHaveBeenCalledTimes(1);
  });
});
