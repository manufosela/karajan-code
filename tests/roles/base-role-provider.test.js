import { describe, expect, it, vi, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { BaseRole } from "../../src/roles/base-role.js";
import { AgentRole } from "../../src/roles/agent-role.js";
import { createNoopLoggerWithContext } from "../_fixtures/loggers.js";

const silentLogger = createNoopLoggerWithContext();

async function mkTmpProject() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "kj-role-prov-"));
  await fs.mkdir(path.join(dir, ".karajan", "roles"), { recursive: true });
  return dir;
}

describe("Role instantiation resolves per-provider templates", () => {
  const cleanups = [];

  afterEach(async () => {
    for (const p of cleanups) {
      await fs.rm(p, { recursive: true, force: true }).catch(() => {});
    }
    cleanups.length = 0;
  });

  it("BaseRole (no resolveProvider) uses default.md if present, else legacy built-in", async () => {
    const dir = await mkTmpProject();
    cleanups.push(dir);
    const roleDir = path.join(dir, ".karajan", "roles", "coder");
    await fs.mkdir(roleDir, { recursive: true });
    await fs.writeFile(path.join(roleDir, "default.md"), "MY_DEFAULT");

    const role = new BaseRole({ name: "coder", config: { projectDir: dir }, logger: silentLogger });
    await role.init();

    expect(role.instructions).toBe("MY_DEFAULT");
    expect(role._templatePath).toMatch(/coder\/default\.md$/);
    expect(role._resolvedProvider).toBeNull();
    expect(role._promptFellBack).toBe(false);
  });

  it("AgentRole picks up per-provider template when provider is configured", async () => {
    const dir = await mkTmpProject();
    cleanups.push(dir);
    const roleDir = path.join(dir, ".karajan", "roles", "coder");
    await fs.mkdir(roleDir, { recursive: true });
    await fs.writeFile(path.join(roleDir, "default.md"), "DEFAULT");
    await fs.writeFile(path.join(roleDir, "anthropic.md"), "FOR_CLAUDE");

    const role = new AgentRole({
      name: "coder",
      config: { projectDir: dir, roles: { coder: { provider: "claude" } } },
      logger: silentLogger,
    });
    await role.init();

    expect(role.instructions).toBe("FOR_CLAUDE");
    expect(role._resolvedProvider).toBe("anthropic");
    expect(role._promptFellBack).toBe(false);
  });

  it("AgentRole falls back to default when no per-provider variant exists and logs the fallback", async () => {
    const dir = await mkTmpProject();
    cleanups.push(dir);
    const roleDir = path.join(dir, ".karajan", "roles", "coder");
    await fs.mkdir(roleDir, { recursive: true });
    await fs.writeFile(path.join(roleDir, "default.md"), "DEFAULT");

    const logger = createNoopLoggerWithContext();
    const role = new AgentRole({
      name: "coder",
      config: { projectDir: dir, roles: { coder: { provider: "gemini" } } },
      logger,
    });
    await role.init();

    expect(role.instructions).toBe("DEFAULT");
    expect(role._resolvedProvider).toBe("google");
    expect(role._promptFellBack).toBe(true);
    expect(logger.debug).toHaveBeenCalled();
  });

  it("AgentRole falls back to legacy flat .md when no subdirectory exists (backwards compat)", async () => {
    const dir = await mkTmpProject();
    cleanups.push(dir);
    await fs.writeFile(path.join(dir, ".karajan", "roles", "coder.md"), "LEGACY");

    const role = new AgentRole({
      name: "coder",
      config: { projectDir: dir, roles: { coder: { provider: "claude" } } },
      logger: silentLogger,
    });
    await role.init();

    expect(role.instructions).toBe("LEGACY");
    expect(role._promptFellBack).toBe(true);
  });

  it("still works for roles without any override and any provider — built-in legacy template loads", async () => {
    const dir = await mkTmpProject();
    cleanups.push(dir);
    const role = new AgentRole({
      name: "reviewer",
      config: { projectDir: dir, roles: { reviewer: { provider: "claude" } } },
      logger: silentLogger,
    });
    await role.init();
    expect(role.instructions).toBeTruthy();
  });
});
