import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("node:fs/promises", () => ({
  readdir: vi.fn(),
  readFile: vi.fn(),
  mkdir: vi.fn(),
  writeFile: vi.fn(),
  stat: vi.fn()
}));

vi.mock("../src/utils/paths.js", () => ({
  getKarajanHome: vi.fn(() => "/home/user/.karajan")
}));

const { readdir, readFile, mkdir, writeFile, stat } = await import("node:fs/promises");
const { autoDetectDomains, persistInlineDomain } = await import("../src/domains/domain-loader.js");

beforeEach(() => {
  vi.resetAllMocks();
  readdir.mockResolvedValue([]);
});

describe("autoDetectDomains", () => {
  it("detects README.md as domain context", async () => {
    readFile.mockImplementation((path) => {
      if (path.endsWith("README.md") && !path.includes("docs")) {
        return Promise.resolve("# My Project\n\nThis is a task management system with REST API.\n");
      }
      return Promise.reject(new Error("ENOENT"));
    });

    const domains = await autoDetectDomains("/tmp/project");
    expect(domains).toHaveLength(1);
    expect(domains[0].name).toBe("auto:README.md");
    expect(domains[0].content).toContain("task management");
    expect(domains[0].origin).toBe("auto-detect");
  });

  it("detects both README.md and CLAUDE.md", async () => {
    readFile.mockImplementation((path) => {
      if (path.endsWith("README.md") && !path.includes("docs")) {
        return Promise.resolve("# Project\n\nDescription here that is long enough to count.\n");
      }
      if (path.endsWith("CLAUDE.md")) {
        return Promise.resolve("# Instructions\n\nUse TDD, run vitest, do not touch main branch.\n");
      }
      return Promise.reject(new Error("ENOENT"));
    });

    const domains = await autoDetectDomains("/tmp/project");
    expect(domains).toHaveLength(2);
    expect(domains.map(d => d.name)).toEqual(["auto:README.md", "auto:CLAUDE.md"]);
  });

  it("skips files shorter than 20 chars", async () => {
    readFile.mockImplementation((path) => {
      if (path.endsWith("README.md")) return Promise.resolve("Short");
      return Promise.reject(new Error("ENOENT"));
    });

    const domains = await autoDetectDomains("/tmp/project");
    expect(domains).toHaveLength(0);
  });

  it("truncates files over 4000 chars", async () => {
    readFile.mockImplementation((path) => {
      if (path.endsWith("README.md") && !path.includes("docs")) {
        return Promise.resolve("x".repeat(5000));
      }
      return Promise.reject(new Error("ENOENT"));
    });

    const domains = await autoDetectDomains("/tmp/project");
    expect(domains[0].content).toContain("[...truncated]");
    expect(domains[0].content.length).toBeLessThan(4100);
  });

  it("returns empty for null projectDir", async () => {
    const domains = await autoDetectDomains(null);
    expect(domains).toHaveLength(0);
  });
});

describe("persistInlineDomain", () => {
  it("writes inline text to .karajan/domains/inline/DOMAIN.md", async () => {
    mkdir.mockResolvedValue(undefined);
    writeFile.mockResolvedValue(undefined);

    await persistInlineDomain("This project is a dental platform", "/tmp/project");

    expect(mkdir).toHaveBeenCalledWith(
      expect.stringContaining(".karajan/domains/inline"),
      { recursive: true }
    );
    expect(writeFile).toHaveBeenCalledWith(
      expect.stringContaining("DOMAIN.md"),
      expect.stringContaining("dental platform"),
      "utf-8"
    );
  });

  it("reads content from .md file path", async () => {
    stat.mockResolvedValue({ isFile: () => true });
    readFile.mockResolvedValue("# Domain from file\n\nDetailed domain knowledge here.");
    mkdir.mockResolvedValue(undefined);
    writeFile.mockResolvedValue(undefined);

    await persistInlineDomain("/path/to/domain.md", "/tmp/project");

    expect(readFile).toHaveBeenCalledWith("/path/to/domain.md", "utf-8");
    expect(writeFile).toHaveBeenCalledWith(
      expect.stringContaining("DOMAIN.md"),
      expect.stringContaining("Domain from file"),
      "utf-8"
    );
  });

  it("treats non-existent file path as inline text", async () => {
    stat.mockRejectedValue(new Error("ENOENT"));
    mkdir.mockResolvedValue(undefined);
    writeFile.mockResolvedValue(undefined);

    await persistInlineDomain("/not/a/real/file.md", "/tmp/project");

    expect(writeFile).toHaveBeenCalledWith(
      expect.stringContaining("DOMAIN.md"),
      expect.stringContaining("/not/a/real/file.md"),
      "utf-8"
    );
  });

  it("does nothing with empty input", async () => {
    await persistInlineDomain("", "/tmp/project");
    expect(writeFile).not.toHaveBeenCalled();
  });
});
