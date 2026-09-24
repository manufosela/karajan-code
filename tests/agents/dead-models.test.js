/**
 * KJC-TSK-0827: kj remembers the models a provider retired, so the next run
 * does not pay for the same corpse. It never rewrites the user's pin, and the
 * memory expires so a wrong verdict heals by itself.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DEAD_MODEL_TTL_MS, deadModelRecord, listDeadModels, recordDeadModel } from "../../src/agents/dead-models.js";
import * as paths from "../../src/utils/paths.js";

let home;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "kj-dead-"));
  vi.spyOn(paths, "getKarajanHome").mockReturnValue(home);
});
afterEach(() => {
  vi.restoreAllMocks();
  rmSync(home, { recursive: true, force: true });
});

describe("recordDeadModel / deadModelRecord", () => {
  it("remembers a retired model with its reason, per provider", () => {
    expect(recordDeadModel({ provider: "codex", model: "gpt-5.4", reason: "is not supported" })).toBe(true);
    expect(deadModelRecord("codex", "gpt-5.4")).toMatchObject({ provider: "codex", model: "gpt-5.4", reason: "is not supported" });
    // Another provider's model of the same name is a different fact.
    expect(deadModelRecord("claude", "gpt-5.4")).toBeNull();
  });

  it("a model nobody watched die is not dead", () => {
    expect(deadModelRecord("codex", "gpt-5.6-terra")).toBeNull();
  });

  it("needs both provider and model — it never records half a fact", () => {
    expect(recordDeadModel({ provider: "codex", model: null })).toBe(false);
    expect(recordDeadModel({ provider: null, model: "gpt-5.4" })).toBe(false);
    expect(listDeadModels()).toEqual([]);
  });

  it("the memory expires, so a wrong verdict heals by itself", () => {
    const now = Date.now();
    recordDeadModel({ provider: "codex", model: "gpt-5.4", now });
    expect(deadModelRecord("codex", "gpt-5.4", now + DEAD_MODEL_TTL_MS - 1)).not.toBeNull();
    expect(deadModelRecord("codex", "gpt-5.4", now + DEAD_MODEL_TTL_MS + 1)).toBeNull();
    expect(listDeadModels(now + DEAD_MODEL_TTL_MS + 1)).toEqual([]);
  });

  it("a corrupt store is forgotten, not fatal: a run never dies over a cache", () => {
    writeFileSync(join(home, "dead-models.json"), "{ this is not json");
    expect(deadModelRecord("codex", "gpt-5.4")).toBeNull();
    expect(recordDeadModel({ provider: "codex", model: "gpt-5.4" })).toBe(true);
    expect(JSON.parse(readFileSync(join(home, "dead-models.json"), "utf8"))).toHaveProperty("codex::gpt-5.4");
  });

  it("lists the live entries, newest first", () => {
    const now = Date.now();
    recordDeadModel({ provider: "codex", model: "old", now: now - 1000 });
    recordDeadModel({ provider: "codex", model: "new", now });
    expect(listDeadModels(now).map((e) => e.model)).toEqual(["new", "old"]);
  });
});

describe("los dos extremos del cable", () => {
  it("el brain apunta el modelo cuando lo ve morir", async () => {
    const { withBrainRecovery } = await import("../../src/brain/with-brain-recovery.js");
    const agent = {
      provider: "codex", model: "gpt-5.4",
      runTask: vi.fn().mockResolvedValue({ ok: false, error: "model gpt-5.4 is not supported", exitCode: 1 }),
    };
    await withBrainRecovery({ agent, taskArgs: {}, role: "coder", sleepFn: () => Promise.resolve() });
    expect(deadModelRecord("codex", "gpt-5.4")).toMatchObject({ provider: "codex", model: "gpt-5.4" });
  });

  it("una cuota agotada NO marca el modelo: el modelo esta vivo, la cuota no", async () => {
    const { withBrainRecovery } = await import("../../src/brain/with-brain-recovery.js");
    const at = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();
    const agent = {
      provider: "claude", model: "opus",
      runTask: vi.fn().mockResolvedValue({ ok: false, error: `monthly usage limit, resets at ${at}`, exitCode: 1 }),
    };
    await withBrainRecovery({ agent, taskArgs: {}, role: "coder", sleepFn: () => Promise.resolve() });
    expect(deadModelRecord("claude", "opus")).toBeNull();
  });

  it("el agente deja de pedir un modelo muerto y dice qué linea cambiar", async () => {
    const { BaseAgent } = await import("../../src/agents/base-agent.js");
    recordDeadModel({ provider: "codex", model: "gpt-5.4", reason: "is not supported" });
    const warn = vi.fn();
    const agent = new BaseAgent("codex", { roles: { reviewer: { model: "gpt-5.4" } } }, { warn });
    expect(agent.getRoleModel("reviewer")).toBeNull();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("roles.reviewer.model"));
  });

  it("un modelo vivo sigue pasando intacto", async () => {
    const { BaseAgent } = await import("../../src/agents/base-agent.js");
    const agent = new BaseAgent("claude", { roles: { coder: { model: "opus" } } }, { warn: vi.fn() });
    expect(agent.getRoleModel("coder")).toBe("opus");
  });
});
