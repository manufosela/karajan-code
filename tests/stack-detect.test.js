import { describe, expect, it, vi, beforeEach } from "vitest";
import { detectProjectStack } from "../src/utils/stack-detect.js";
import fs from "node:fs/promises";

vi.mock("node:fs/promises", () => ({
  default: {
    readFile: vi.fn(),
    access: vi.fn(),
    readdir: vi.fn(),
  },
}));

describe("detectProjectStack", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    fs.readFile.mockRejectedValue(new Error("not found"));
    fs.access.mockRejectedValue(new Error("not found"));
    fs.readdir.mockResolvedValue([]);
  });

  it("detects React from package.json → frameworks includes 'react', isFrontend true", async () => {
    fs.readFile.mockResolvedValue(
      JSON.stringify({ dependencies: { react: "^18.0.0", "react-dom": "^18.0.0" } })
    );

    const result = await detectProjectStack("/project");

    expect(result.frameworks).toContain("react");
    expect(result.isFrontend).toBe(true);
    expect(result.language).toBe("javascript");
    expect(result.suggestions.impeccable).toBe(true);
    expect(result.suggestions.skills).toContain("react");
  });

  it("detects Express from package.json → frameworks includes 'express', isBackend true", async () => {
    fs.readFile.mockResolvedValue(
      JSON.stringify({ dependencies: { express: "^4.0.0" } })
    );

    const result = await detectProjectStack("/project");

    expect(result.frameworks).toContain("express");
    expect(result.isBackend).toBe(true);
    expect(result.isFrontend).toBe(false);
    expect(result.suggestions.impeccable).toBe(false);
  });

  it("detects fullstack when both frontend and backend deps present", async () => {
    fs.readFile.mockResolvedValue(
      JSON.stringify({
        dependencies: { react: "^18.0.0", "react-dom": "^18.0.0", express: "^4.0.0" },
      })
    );

    const result = await detectProjectStack("/project");

    expect(result.frameworks).toContain("react");
    expect(result.frameworks).toContain("express");
    expect(result.isFrontend).toBe(true);
    expect(result.isBackend).toBe(true);
    expect(result.isFullstack).toBe(true);
  });

  it("detects Go from go.mod → language 'go'", async () => {
    fs.access.mockImplementation((p) => {
      if (p.endsWith("go.mod")) return Promise.resolve();
      return Promise.reject(new Error("not found"));
    });

    const result = await detectProjectStack("/project");

    expect(result.language).toBe("go");
    expect(result.isBackend).toBe(true);
    expect(result.frameworks).toEqual([]);
  });

  it("detects Rust from Cargo.toml → language 'rust'", async () => {
    fs.access.mockImplementation((p) => {
      if (p.endsWith("Cargo.toml")) return Promise.resolve();
      return Promise.reject(new Error("not found"));
    });

    const result = await detectProjectStack("/project");

    expect(result.language).toBe("rust");
    expect(result.isBackend).toBe(true);
  });

  it("detects Python from pyproject.toml → language 'python'", async () => {
    fs.access.mockImplementation((p) => {
      if (p.endsWith("pyproject.toml")) return Promise.resolve();
      return Promise.reject(new Error("not found"));
    });

    const result = await detectProjectStack("/project");

    expect(result.language).toBe("python");
    expect(result.isBackend).toBe(true);
  });

  it("returns empty frameworks and null language when no recognizable files found", async () => {
    const result = await detectProjectStack("/empty-project");

    expect(result.frameworks).toEqual([]);
    expect(result.language).toBeNull();
    expect(result.isFrontend).toBe(false);
    expect(result.isBackend).toBe(false);
    expect(result.isFullstack).toBe(false);
    expect(result.suggestions.impeccable).toBe(false);
    expect(result.suggestions.skills).toEqual([]);
  });

  it("suggestions include impeccable for frontend projects", async () => {
    fs.readFile.mockResolvedValue(
      JSON.stringify({ dependencies: { vue: "^3.0.0" } })
    );

    const result = await detectProjectStack("/project");

    expect(result.isFrontend).toBe(true);
    expect(result.suggestions.impeccable).toBe(true);
    expect(result.suggestions.skills).toContain("vue");
  });

  it("detects TypeScript when typescript dep present", async () => {
    fs.readFile.mockResolvedValue(
      JSON.stringify({ devDependencies: { typescript: "^5.0.0" } })
    );

    const result = await detectProjectStack("/project");

    expect(result.language).toBe("typescript");
  });

  it("detects Next.js as fullstack framework", async () => {
    fs.readFile.mockResolvedValue(
      JSON.stringify({ dependencies: { next: "^14.0.0", react: "^18.0.0" } })
    );

    const result = await detectProjectStack("/project");

    expect(result.frameworks).toContain("next");
    expect(result.frameworks).toContain("react");
    expect(result.isFrontend).toBe(true);
    expect(result.isBackend).toBe(true);
    expect(result.isFullstack).toBe(true);
    expect(result.suggestions.skills).toContain("nextjs");
  });

  it("detects Astro as frontend framework", async () => {
    fs.readFile.mockResolvedValue(
      JSON.stringify({ dependencies: { astro: "^4.0.0" } })
    );

    const result = await detectProjectStack("/project");

    expect(result.frameworks).toContain("astro");
    expect(result.isFrontend).toBe(true);
    expect(result.isBackend).toBe(false);
    expect(result.suggestions.skills).toContain("astro");
  });

  it("language file marker does not override non-JS language already detected", async () => {
    // go.mod detected first, then pyproject.toml should not override
    fs.access.mockImplementation((p) => {
      if (p.endsWith("go.mod") || p.endsWith("pyproject.toml")) return Promise.resolve();
      return Promise.reject(new Error("not found"));
    });

    const result = await detectProjectStack("/project");

    // go.mod is first in LANGUAGE_FILE_MARKERS, so 'go' should be the primary language
    expect(result.language).toBe("go");
    expect(result.isBackend).toBe(true);
  });
});
