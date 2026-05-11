import { describe, it, expect, vi, beforeEach } from "vitest";
import path from "node:path";

vi.mock("node:fs/promises", () => ({
  readdir: vi.fn(),
  readFile: vi.fn(),
  access: vi.fn()
}));

vi.mock("../src/utils/paths.js", () => ({
  getKarajanHome: vi.fn(() => "/home/user/.karajan")
}));

const { readdir, readFile } = await import("node:fs/promises");
const { parseDomainFile, loadDomains } = await import("../src/domains/domain-loader.js");

const DENTAL_DOMAIN_MD = `---
name: dental-clinical
description: Clinical dental workflows and terminology
tags:
  - dental
  - clinical
  - orthodontics
version: 1.0.0
author: geniova
visibility: private
sources:
  - type: manual
    note: Created by dental team
---

# Dental Clinical Domain

## Core Concepts

Teeth are numbered using the FDI system (11-48).
Orthodontic treatment involves brackets, archwires and aligners.

## Terminology

- **Malocclusion**: misalignment of teeth
- **Bracket**: attachment bonded to tooth surface
- **Aligner**: removable transparent tray

## Business Rules

Treatment plans must be approved by the lead clinician.
Maximum treatment duration is 36 months.

## Common Edge Cases

Mixed dentition in pediatric patients requires special staging.
`;

const MINIMAL_DOMAIN_MD = `---
name: minimal
description: A minimal domain
tags: []
---

Some content.
`;

const NO_FRONTMATTER_MD = `# Just Markdown

No frontmatter here, just plain content.
`;

const MALFORMED_YAML_MD = `---
name: broken
description: [invalid yaml
tags: not-a-list
---

Some content after malformed YAML.
`;

describe("parseDomainFile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("parses a complete DOMAIN.md with all frontmatter fields", async () => {
    readFile.mockResolvedValue(DENTAL_DOMAIN_MD);

    const result = await parseDomainFile("/domains/dental/DOMAIN.md");

    expect(result).not.toBeNull();
    expect(result.name).toBe("dental-clinical");
    expect(result.description).toBe("Clinical dental workflows and terminology");
    expect(result.tags).toEqual(["dental", "clinical", "orthodontics"]);
    expect(result.version).toBe("1.0.0");
    expect(result.author).toBe("geniova");
    expect(result.visibility).toBe("private");
    expect(result.sources).toHaveLength(1);
    expect(result.sources[0].type).toBe("manual");
    expect(result.content).toContain("Teeth are numbered");
    expect(result.content).toContain("## Core Concepts");
    expect(result.content).toContain("## Business Rules");
    expect(result.filePath).toBe("/domains/dental/DOMAIN.md");
  });

  it("parses sections into structured sections array", async () => {
    readFile.mockResolvedValue(DENTAL_DOMAIN_MD);

    const result = await parseDomainFile("/domains/dental/DOMAIN.md");

    expect(result.sections).toBeDefined();
    expect(result.sections.length).toBeGreaterThanOrEqual(4);

    const coreSection = result.sections.find(s => s.heading === "Core Concepts");
    expect(coreSection).toBeDefined();
    expect(coreSection.content).toContain("FDI system");

    const termsSection = result.sections.find(s => s.heading === "Terminology");
    expect(termsSection).toBeDefined();
    expect(termsSection.content).toContain("Malocclusion");

    const rulesSection = result.sections.find(s => s.heading === "Business Rules");
    expect(rulesSection).toBeDefined();
    expect(rulesSection.content).toContain("lead clinician");

    const edgeCasesSection = result.sections.find(s => s.heading === "Common Edge Cases");
    expect(edgeCasesSection).toBeDefined();
    expect(edgeCasesSection.content).toContain("Mixed dentition");
  });

  it("parses minimal DOMAIN.md with empty tags", async () => {
    readFile.mockResolvedValue(MINIMAL_DOMAIN_MD);

    const result = await parseDomainFile("/domains/minimal/DOMAIN.md");

    expect(result).not.toBeNull();
    expect(result.name).toBe("minimal");
    expect(result.tags).toEqual([]);
    expect(result.content).toContain("Some content.");
  });

  it("returns null for file without frontmatter", async () => {
    readFile.mockResolvedValue(NO_FRONTMATTER_MD);

    const result = await parseDomainFile("/domains/nofm/DOMAIN.md");

    expect(result).toBeNull();
  });

  it("returns null for file with malformed YAML frontmatter", async () => {
    readFile.mockResolvedValue(MALFORMED_YAML_MD);

    const result = await parseDomainFile("/domains/broken/DOMAIN.md");

    expect(result).toBeNull();
  });

  it("returns null when file cannot be read", async () => {
    readFile.mockRejectedValue(new Error("ENOENT"));

    const result = await parseDomainFile("/nonexistent/DOMAIN.md");

    expect(result).toBeNull();
  });

  it("defaults missing optional fields", async () => {
    const sparse = `---
name: sparse-domain
---

Content here.
`;
    readFile.mockResolvedValue(sparse);

    const result = await parseDomainFile("/domains/sparse/DOMAIN.md");

    expect(result).not.toBeNull();
    expect(result.name).toBe("sparse-domain");
    expect(result.description).toBe("");
    expect(result.tags).toEqual([]);
    expect(result.version).toBe("0.0.0");
    expect(result.author).toBe("");
    expect(result.visibility).toBe("private");
    expect(result.sources).toEqual([]);
  });
});

describe("loadDomains", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns empty array when no domain directories and no auto-detect files exist", async () => {
    readdir.mockRejectedValue(new Error("ENOENT"));
    readFile.mockRejectedValue(new Error("ENOENT"));

    const result = await loadDomains("/project");

    expect(result).toEqual([]);
  });

  it("loads domains from project-local .karajan/domains/", async () => {
    readdir.mockImplementation(async (dir) => {
      if (dir === "/project/.karajan/domains") {
        return [{ name: "dental", isDirectory: () => true }];
      }
      throw new Error("ENOENT");
    });
    readFile.mockResolvedValue(MINIMAL_DOMAIN_MD);

    const result = await loadDomains("/project");

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("minimal");
    expect(result[0].origin).toBe("project");
  });

  it("loads domains from user-global ~/.karajan/domains/", async () => {
    readdir.mockImplementation(async (dir) => {
      if (dir === "/home/user/.karajan/domains") {
        return [{ name: "dental", isDirectory: () => true }];
      }
      throw new Error("ENOENT");
    });
    readFile.mockResolvedValue(DENTAL_DOMAIN_MD);

    const result = await loadDomains("/project");

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("dental-clinical");
    expect(result[0].origin).toBe("user");
  });

  it("project-local domains override user-global domains by directory name", async () => {
    readdir.mockImplementation(async (dir) => {
      if (dir === "/home/user/.karajan/domains") {
        return [{ name: "dental", isDirectory: () => true }];
      }
      if (dir === "/project/.karajan/domains") {
        return [{ name: "dental", isDirectory: () => true }];
      }
      throw new Error("ENOENT");
    });
    readFile.mockImplementation(async (filePath) => {
      if (filePath.startsWith("/project/")) {
        return `---
name: dental-project-override
description: Project-specific dental domain
tags: [dental]
---

Project-level dental content.
`;
      }
      return DENTAL_DOMAIN_MD;
    });

    const result = await loadDomains("/project");

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("dental-project-override");
    expect(result[0].origin).toBe("project");
  });

  it("merges domains from both sources when names differ", async () => {
    readdir.mockImplementation(async (dir) => {
      if (dir === "/home/user/.karajan/domains") {
        return [{ name: "logistics", isDirectory: () => true }];
      }
      if (dir === "/project/.karajan/domains") {
        return [{ name: "dental", isDirectory: () => true }];
      }
      throw new Error("ENOENT");
    });
    readFile.mockImplementation(async (filePath) => {
      if (filePath.includes("dental")) {
        return `---
name: dental
tags: [dental]
---

Dental content.
`;
      }
      return `---
name: logistics
tags: [logistics]
---

Logistics content.
`;
    });

    const result = await loadDomains("/project");

    expect(result).toHaveLength(2);
    const names = result.map(d => d.name);
    expect(names).toContain("dental");
    expect(names).toContain("logistics");
  });

  it("skips entries that are not directories", async () => {
    readdir.mockImplementation(async (dir) => {
      if (dir === "/project/.karajan/domains") {
        return [
          { name: "README.md", isDirectory: () => false },
          { name: "dental", isDirectory: () => true }
        ];
      }
      throw new Error("ENOENT");
    });
    readFile.mockResolvedValue(MINIMAL_DOMAIN_MD);

    const result = await loadDomains("/project");

    expect(result).toHaveLength(1);
  });

  it("skips subdirectories without DOMAIN.md", async () => {
    readdir.mockImplementation(async (dir) => {
      if (dir === "/project/.karajan/domains") {
        return [{ name: "empty", isDirectory: () => true }];
      }
      throw new Error("ENOENT");
    });
    readFile.mockRejectedValue(new Error("ENOENT"));

    const result = await loadDomains("/project");

    expect(result).toEqual([]);
  });

  it("skips domains with malformed DOMAIN.md gracefully", async () => {
    readdir.mockImplementation(async (dir) => {
      if (dir === "/project/.karajan/domains") {
        return [
          { name: "broken", isDirectory: () => true },
          { name: "good", isDirectory: () => true }
        ];
      }
      throw new Error("ENOENT");
    });
    readFile.mockImplementation(async (filePath) => {
      if (filePath.includes("broken")) return NO_FRONTMATTER_MD;
      return MINIMAL_DOMAIN_MD;
    });

    const result = await loadDomains("/project");

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("minimal");
  });

  it("works when projectDir is null (only user-global)", async () => {
    readdir.mockImplementation(async (dir) => {
      if (dir === "/home/user/.karajan/domains") {
        return [{ name: "dental", isDirectory: () => true }];
      }
      throw new Error("ENOENT");
    });
    readFile.mockResolvedValue(MINIMAL_DOMAIN_MD);

    const result = await loadDomains(null);

    expect(result).toHaveLength(1);
    expect(result[0].origin).toBe("user");
  });
});
