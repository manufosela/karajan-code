import { describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { BaseRole, resolveRoleMdPath, loadFirstExisting } from "../../src/roles/base-role.js";

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), setContext: vi.fn() };

describe("Impeccable role template", () => {
  const templatePath = path.resolve(
    import.meta.dirname,
    "..",
    "..",
    "templates",
    "roles",
    "impeccable.md"
  );

  it("template file exists and is non-empty", async () => {
    const content = await fs.readFile(templatePath, "utf8");
    expect(content.length).toBeGreaterThan(50);
  });

  it("loads correctly via role resolver", async () => {
    const role = new BaseRole({ name: "impeccable", config: {}, logger });
    await role.init();
    expect(role.instructions).toBeTruthy();
    expect(role.instructions).toContain("Impeccable");
  });

  it("resolveRoleMdPath includes impeccable.md candidate", () => {
    const candidates = resolveRoleMdPath("impeccable", "/my/project");
    expect(candidates.some((c) => c.endsWith("impeccable.md"))).toBe(true);
  });

  it("contains required audit section", async () => {
    const content = await fs.readFile(templatePath, "utf8");
    expect(content).toMatch(/audit/i);
    expect(content).toMatch(/accessibility|a11y/i);
    expect(content).toMatch(/performance/i);
    expect(content).toMatch(/theming/i);
    expect(content).toMatch(/responsive/i);
    expect(content).toMatch(/anti.?pattern/i);
  });

  it("contains required fix section", async () => {
    const content = await fs.readFile(templatePath, "utf8");
    expect(content).toMatch(/fix/i);
    expect(content).toMatch(/edit/i);
  });

  it("contains required report section with JSON output format", async () => {
    const content = await fs.readFile(templatePath, "utf8");
    expect(content).toMatch(/report/i);
    expect(content).toMatch(/"verdict"/);
    expect(content).toMatch(/APPROVED/);
    expect(content).toMatch(/IMPROVED/);
    expect(content).toMatch(/"issuesFound"/);
    expect(content).toMatch(/"issuesFixed"/);
  });

  it("uses standard interpolation variables", async () => {
    const content = await fs.readFile(templatePath, "utf8");
    expect(content).toContain("{{task}}");
    expect(content).toContain("{{diff}}");
    expect(content).toContain("{{context}}");
  });

  it("restricts scope to diff files only", async () => {
    const content = await fs.readFile(templatePath, "utf8");
    expect(content).toMatch(/only.*diff|diff.*only|changed files/i);
  });
});
