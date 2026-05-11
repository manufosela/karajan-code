import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

vi.mock("node:fs/promises", () => ({
  readdir: vi.fn(),
  readFile: vi.fn(),
  writeFile: vi.fn(),
  mkdir: vi.fn(),
  access: vi.fn()
}));

vi.mock("../src/utils/paths.js", () => ({
  getKarajanHome: vi.fn(() => "/home/user/.karajan")
}));

const { readdir, readFile, writeFile, mkdir } = await import("node:fs/promises");

// Load the real example domain template for testing
const EXAMPLE_DENTAL = readFileSync(
  join(process.cwd(), "templates/domains/example-dental.md"),
  "utf-8"
);

describe("Domain Knowledge System — integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mkdir.mockResolvedValue(undefined);
    writeFile.mockResolvedValue(undefined);
  });

  it("full flow: parseDomainFile -> synthesize -> verify output", async () => {
    const { parseDomainFile } = await import("../src/domains/domain-loader.js");
    const { synthesizeDomainContext } = await import("../src/domains/domain-synthesizer.js");

    readFile.mockResolvedValue(EXAMPLE_DENTAL);
    const domain = await parseDomainFile("/domains/dental/DOMAIN.md");

    expect(domain).not.toBeNull();
    expect(domain.name).toBe("dental-clinical");
    expect(domain.tags).toContain("dental");
    expect(domain.sections.length).toBeGreaterThanOrEqual(4);

    const context = synthesizeDomainContext({
      task: "Create a bracket positioning algorithm for orthodontic treatment",
      domainHints: ["dental", "orthodontics"],
      selectedDomains: [domain]
    });

    expect(context).toContain("dental-clinical");
    expect(context).toContain("Core Concepts");
    expect(context).toContain("Bracket");
    expect(context).toContain("Business Rules");
  });

  it("full flow: loadDomains -> curator -> domainContext", async () => {
    const { DomainCuratorRole } = await import("../src/roles/domain-curator-role.js");

    readdir.mockImplementation(async (dir) => {
      if (dir === "/project/.karajan/domains") {
        return [{ name: "dental", isDirectory: () => true }];
      }
      throw new Error("ENOENT");
    });
    readFile.mockImplementation(async (filePath) => {
      if (filePath.includes("DOMAIN.md")) return EXAMPLE_DENTAL;
      throw new Error("ENOENT");
    });

    const curator = new DomainCuratorRole({
      config: {},
      logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), setContext: vi.fn() }
    });

    const result = await curator.execute({
      task: "Build treatment plan approval workflow",
      domainHints: ["dental", "clinical"],
      projectDir: "/project"
    });

    expect(result.ok).toBe(true);
    expect(result.result.domainsFound).toBe(1);
    expect(result.result.domainsUsed).toBe(1);
    expect(result.result.domainContext).toContain("dental-clinical");
    expect(result.result.domainContext).toContain("Treatment plans must be approved");
  });

  it("backward compatibility: no domains directory means pipeline unchanged", async () => {
    readdir.mockRejectedValue(new Error("ENOENT"));
    readFile.mockRejectedValue(new Error("ENOENT"));

    const { DomainCuratorRole } = await import("../src/roles/domain-curator-role.js");

    const curator = new DomainCuratorRole({
      config: {},
      logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), setContext: vi.fn() }
    });

    const result = await curator.execute({
      task: "Refactor React component",
      domainHints: [],
      projectDir: "/project"
    });

    expect(result.ok).toBe(true);
    expect(result.result.domainContext).toBeNull();
    expect(result.result.domainsFound).toBe(0);
  });

  it("project-local domains merge with user-global", async () => {
    const { loadDomains } = await import("../src/domains/domain-loader.js");

    const projectDomain = `---
name: dental-project
description: Project-specific dental overrides
tags: [dental]
---

## Project Rules

This project uses a custom bracket system.
`;

    readdir.mockImplementation(async (dir) => {
      if (dir === "/home/user/.karajan/domains") {
        return [{ name: "dental", isDirectory: () => true }];
      }
      if (dir === "/project/.karajan/domains") {
        return [
          { name: "dental", isDirectory: () => true },
          { name: "billing", isDirectory: () => true }
        ];
      }
      throw new Error("ENOENT");
    });
    readFile.mockImplementation(async (filePath) => {
      if (filePath.startsWith("/project/") && filePath.includes("dental")) return projectDomain;
      if (filePath.startsWith("/project/") && filePath.includes("billing")) return `---
name: billing
tags: [billing]
---

## Billing Rules

30 day payment terms.
`;
      if (filePath.includes("dental")) return EXAMPLE_DENTAL;
      throw new Error("ENOENT");
    });

    const domains = await loadDomains("/project");

    // dental should be overridden by project version, billing is project-only
    expect(domains).toHaveLength(2);
    const dental = domains.find(d => d.name === "dental-project");
    expect(dental).toBeDefined();
    expect(dental.origin).toBe("project");
    expect(dental.content).toContain("custom bracket system");
  });

  it("domainContext injection in coder prompt (end-to-end)", async () => {
    readdir.mockRejectedValue(new Error("ENOENT"));
    readFile.mockRejectedValue(new Error("ENOENT"));

    const { buildCoderPrompt } = await import("../src/prompts/coder.js");
    const prompt = await buildCoderPrompt({
      task: "Build dental treatment approval workflow",
      domainContext: "### dental-clinical\n\n#### Business Rules\nTreatment plans must be approved by lead clinician.",
      productContext: "We are building a dental platform."
    });

    // Both contexts should be present
    expect(prompt).toContain("## Product Context");
    expect(prompt).toContain("dental platform");
    expect(prompt).toContain("## Domain Context");
    expect(prompt).toContain("Treatment plans must be approved");
  });
});
