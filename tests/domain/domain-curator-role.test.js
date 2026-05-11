import { describe, it, expect, vi, beforeEach } from "vitest";

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
const { DomainCuratorRole } = await import("../src/roles/domain-curator-role.js");

const DENTAL_DOMAIN_MD = `---
name: dental-clinical
description: Clinical dental workflows
tags:
  - dental
  - clinical
version: 1.0.0
---

## Core Concepts

Teeth numbered using FDI system.

## Business Rules

Treatment plans need approval.
`;

function createLogger() {
  return { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), setContext: vi.fn() };
}

function createAskQuestion({ interactive = true, answers = [] } = {}) {
  let callIdx = 0;
  const fn = vi.fn(async () => {
    const answer = answers[callIdx] ?? null;
    callIdx++;
    return answer;
  });
  fn.interactive = interactive;
  return fn;
}

describe("DomainCuratorRole", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mkdir.mockResolvedValue(undefined);
    writeFile.mockResolvedValue(undefined);
  });

  it("returns null domainContext when no domains found and not interactive", async () => {
    readdir.mockRejectedValue(new Error("ENOENT"));
    readFile.mockRejectedValue(new Error("ENOENT"));

    const curator = new DomainCuratorRole({ config: {}, logger: createLogger() });
    const result = await curator.execute({
      task: "Build dental workflow",
      domainHints: ["dental"],
      askQuestion: createAskQuestion({ interactive: false })
    });

    expect(result.ok).toBe(true);
    expect(result.result.domainContext).toBeNull();
    expect(result.result.domainsFound).toBe(0);
    expect(result.result.source).toBe("none");
  });

  it("asks user when no domains found and interactive", async () => {
    readdir.mockRejectedValue(new Error("ENOENT"));
    readFile.mockRejectedValue(new Error("ENOENT"));

    const askQuestion = createAskQuestion({ interactive: true, answers: [false] });
    const curator = new DomainCuratorRole({ config: {}, logger: createLogger() });
    const result = await curator.execute({
      task: "Build dental workflow",
      domainHints: ["dental"],
      askQuestion
    });

    expect(askQuestion).toHaveBeenCalledTimes(1);
    expect(result.result.domainContext).toBeNull();
  });

  it("loads and synthesizes domains from filesystem", async () => {
    readdir.mockImplementation(async (dir) => {
      if (dir === "/project/.karajan/domains") {
        return [{ name: "dental", isDirectory: () => true }];
      }
      throw new Error("ENOENT");
    });
    readFile.mockImplementation(async (filePath) => {
      if (filePath.includes("DOMAIN.md")) return DENTAL_DOMAIN_MD;
      throw new Error("ENOENT"); // registry file
    });

    const curator = new DomainCuratorRole({ config: {}, logger: createLogger() });
    const result = await curator.execute({
      task: "Build dental treatment workflow",
      domainHints: ["dental"],
      askQuestion: createAskQuestion({ interactive: false }),
      projectDir: "/project"
    });

    expect(result.ok).toBe(true);
    expect(result.result.domainsFound).toBe(1);
    expect(result.result.domainsUsed).toBe(1);
    expect(result.result.domainContext).toContain("dental-clinical");
    expect(result.result.domainContext).toContain("Core Concepts");
  });

  it("uses all domains automatically when not interactive", async () => {
    readdir.mockImplementation(async (dir) => {
      if (dir === "/project/.karajan/domains") {
        return [
          { name: "dental", isDirectory: () => true },
          { name: "billing", isDirectory: () => true }
        ];
      }
      throw new Error("ENOENT");
    });
    readFile.mockImplementation(async (filePath) => {
      if (filePath.includes("dental/DOMAIN.md")) return DENTAL_DOMAIN_MD;
      if (filePath.includes("billing/DOMAIN.md")) return `---
name: billing
description: Billing domain
tags: [billing]
version: 1.0.0
---

## Invoice Rules

Invoices need VAT.
`;
      throw new Error("ENOENT");
    });

    const curator = new DomainCuratorRole({ config: {}, logger: createLogger() });
    const result = await curator.execute({
      task: "dental billing",
      domainHints: ["dental", "billing"],
      askQuestion: createAskQuestion({ interactive: false }),
      projectDir: "/project"
    });

    expect(result.result.domainsUsed).toBe(2);
    expect(result.result.selectedDomains).toContain("dental-clinical");
    expect(result.result.selectedDomains).toContain("billing");
  });

  it("proposes selection when interactive and multiple domains", async () => {
    readdir.mockImplementation(async (dir) => {
      if (dir === "/project/.karajan/domains") {
        return [
          { name: "dental", isDirectory: () => true },
          { name: "billing", isDirectory: () => true }
        ];
      }
      throw new Error("ENOENT");
    });
    readFile.mockImplementation(async (filePath) => {
      if (filePath.includes("dental/DOMAIN.md")) return DENTAL_DOMAIN_MD;
      if (filePath.includes("billing/DOMAIN.md")) return `---
name: billing
description: Billing
tags: [billing]
---

## Rules

Pay on time.
`;
      throw new Error("ENOENT");
    });

    // User selects only "dental-clinical"
    const askQuestion = createAskQuestion({
      interactive: true,
      answers: [["dental-clinical"]]
    });

    const curator = new DomainCuratorRole({ config: {}, logger: createLogger() });
    const result = await curator.execute({
      task: "dental treatment",
      domainHints: ["dental"],
      askQuestion,
      projectDir: "/project"
    });

    expect(askQuestion).toHaveBeenCalledTimes(1);
    expect(result.result.domainsUsed).toBe(1);
    expect(result.result.selectedDomains).toEqual(["dental-clinical"]);
  });

  it("works without askQuestion at all", async () => {
    readdir.mockImplementation(async (dir) => {
      if (dir === "/project/.karajan/domains") {
        return [{ name: "dental", isDirectory: () => true }];
      }
      throw new Error("ENOENT");
    });
    readFile.mockImplementation(async (filePath) => {
      if (filePath.includes("DOMAIN.md")) return DENTAL_DOMAIN_MD;
      throw new Error("ENOENT");
    });

    const curator = new DomainCuratorRole({ config: {}, logger: createLogger() });
    const result = await curator.execute({
      task: "dental stuff",
      domainHints: ["dental"],
      projectDir: "/project"
    });

    expect(result.ok).toBe(true);
    expect(result.result.domainsUsed).toBe(1);
  });
});
