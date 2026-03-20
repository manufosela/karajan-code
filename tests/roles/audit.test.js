import { describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { BaseRole, resolveRoleMdPath } from "../../src/roles/base-role.js";

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), setContext: vi.fn() };

describe("Audit role template", () => {
  const templatePath = path.resolve(
    import.meta.dirname,
    "..",
    "..",
    "templates",
    "roles",
    "audit.md"
  );

  it("template file exists and is non-empty", async () => {
    const content = await fs.readFile(templatePath, "utf8");
    expect(content.length).toBeGreaterThan(50);
  });

  it("contains all 5 dimensions", async () => {
    const content = await fs.readFile(templatePath, "utf8");
    expect(content).toMatch(/security/i);
    expect(content).toMatch(/code quality/i);
    expect(content).toMatch(/performance/i);
    expect(content).toMatch(/architecture/i);
    expect(content).toMatch(/testing/i);
  });

  it("contains read-only constraint (no Edit/Write)", async () => {
    const content = await fs.readFile(templatePath, "utf8");
    expect(content).toMatch(/DO NOT use Edit or Write/);
    expect(content).toMatch(/read-only/i);
  });

  it("uses standard interpolation variables", async () => {
    const content = await fs.readFile(templatePath, "utf8");
    expect(content).toContain("{{task}}");
    expect(content).toContain("{{context}}");
  });

  it("loads correctly via role resolver", async () => {
    const role = new BaseRole({ name: "audit", config: {}, logger });
    await role.init();
    expect(role.instructions).toBeTruthy();
    expect(role.instructions).toContain("Audit");
  });

  it("resolveRoleMdPath includes audit.md candidate", () => {
    const candidates = resolveRoleMdPath("audit", "/my/project");
    expect(candidates.some((c) => c.endsWith("audit.md"))).toBe(true);
  });

  it("contains JSON output format specification", async () => {
    const content = await fs.readFile(templatePath, "utf8");
    expect(content).toMatch(/"overallHealth"/);
    expect(content).toMatch(/"totalFindings"/);
    expect(content).toMatch(/"severity"/);
    expect(content).toMatch(/"score"/);
    expect(content).toMatch(/"topRecommendations"/);
  });
});
