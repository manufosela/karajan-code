import { describe, expect, it, vi, beforeEach } from "vitest";
import { detectTestFramework, TEST_PATTERNS_BY_LANGUAGE } from "../src/utils/project-detect.js";
import fs from "node:fs/promises";

vi.mock("node:fs/promises", () => ({
  default: {
    readFile: vi.fn(),
    access: vi.fn(),
    readdir: vi.fn(),
  },
}));

describe("multi-language test framework detection", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    fs.readFile.mockRejectedValue(new Error("not found"));
    fs.access.mockRejectedValue(new Error("not found"));
    fs.readdir.mockResolvedValue([]);
  });

  it("detects vitest from package.json", async () => {
    fs.readFile.mockResolvedValue(JSON.stringify({ devDependencies: { vitest: "^4.0.0" } }));
    const r = await detectTestFramework("/project");
    expect(r).toEqual({ hasTests: true, framework: "vitest", language: "javascript" });
  });

  it("detects Java/Maven from pom.xml", async () => {
    fs.access.mockImplementation((p) => {
      if (p.endsWith("pom.xml")) return Promise.resolve();
      return Promise.reject(new Error("not found"));
    });
    const r = await detectTestFramework("/project");
    expect(r).toEqual({ hasTests: true, framework: "junit", language: "java" });
  });

  it("detects Kotlin/Gradle from build.gradle.kts", async () => {
    fs.access.mockImplementation((p) => {
      if (p.endsWith("build.gradle.kts")) return Promise.resolve();
      return Promise.reject(new Error("not found"));
    });
    const r = await detectTestFramework("/project");
    expect(r).toEqual({ hasTests: true, framework: "junit", language: "kotlin" });
  });

  it("detects Java/Gradle from build.gradle", async () => {
    fs.access.mockImplementation((p) => {
      if (p.endsWith("build.gradle")) return Promise.resolve();
      return Promise.reject(new Error("not found"));
    });
    const r = await detectTestFramework("/project");
    expect(r).toEqual({ hasTests: true, framework: "junit", language: "java" });
  });

  it("detects Python from pyproject.toml", async () => {
    fs.access.mockImplementation((p) => {
      if (p.endsWith("pyproject.toml")) return Promise.resolve();
      return Promise.reject(new Error("not found"));
    });
    const r = await detectTestFramework("/project");
    expect(r).toEqual({ hasTests: true, framework: "pytest", language: "python" });
  });

  it("detects Python from pytest.ini", async () => {
    fs.access.mockImplementation((p) => {
      if (p.endsWith("pytest.ini")) return Promise.resolve();
      return Promise.reject(new Error("not found"));
    });
    const r = await detectTestFramework("/project");
    expect(r).toEqual({ hasTests: true, framework: "pytest", language: "python" });
  });

  it("detects Go from go.mod", async () => {
    fs.access.mockImplementation((p) => {
      if (p.endsWith("go.mod")) return Promise.resolve();
      return Promise.reject(new Error("not found"));
    });
    const r = await detectTestFramework("/project");
    expect(r).toEqual({ hasTests: true, framework: "go-test", language: "go" });
  });

  it("detects Rust from Cargo.toml", async () => {
    fs.access.mockImplementation((p) => {
      if (p.endsWith("Cargo.toml")) return Promise.resolve();
      return Promise.reject(new Error("not found"));
    });
    const r = await detectTestFramework("/project");
    expect(r).toEqual({ hasTests: true, framework: "cargo-test", language: "rust" });
  });

  it("detects C# from .csproj file", async () => {
    fs.readdir.mockResolvedValue(["MyApp.csproj", "Program.cs"]);
    const r = await detectTestFramework("/project");
    expect(r).toEqual({ hasTests: true, framework: "dotnet-test", language: "csharp" });
  });

  it("detects Ruby from Gemfile", async () => {
    fs.access.mockImplementation((p) => {
      if (p.endsWith("Gemfile")) return Promise.resolve();
      return Promise.reject(new Error("not found"));
    });
    const r = await detectTestFramework("/project");
    expect(r).toEqual({ hasTests: true, framework: "rspec", language: "ruby" });
  });

  it("detects PHP from phpunit.xml", async () => {
    fs.access.mockImplementation((p) => {
      if (p.endsWith("phpunit.xml")) return Promise.resolve();
      return Promise.reject(new Error("not found"));
    });
    const r = await detectTestFramework("/project");
    expect(r).toEqual({ hasTests: true, framework: "phpunit", language: "php" });
  });

  it("detects Dart from pubspec.yaml", async () => {
    fs.access.mockImplementation((p) => {
      if (p.endsWith("pubspec.yaml")) return Promise.resolve();
      return Promise.reject(new Error("not found"));
    });
    const r = await detectTestFramework("/project");
    expect(r).toEqual({ hasTests: true, framework: "dart-test", language: "dart" });
  });

  it("detects Swift from Package.swift", async () => {
    fs.access.mockImplementation((p) => {
      if (p.endsWith("Package.swift")) return Promise.resolve();
      return Promise.reject(new Error("not found"));
    });
    const r = await detectTestFramework("/project");
    expect(r).toEqual({ hasTests: true, framework: "xctest", language: "swift" });
  });

  it("returns no framework when nothing found", async () => {
    const r = await detectTestFramework("/project");
    expect(r).toEqual({ hasTests: false, framework: null, language: null });
  });

  it("JS package.json takes priority over language markers", async () => {
    fs.readFile.mockResolvedValue(JSON.stringify({ devDependencies: { jest: "^29.0.0" } }));
    fs.access.mockResolvedValue(); // go.mod would also match
    const r = await detectTestFramework("/project");
    expect(r.framework).toBe("jest");
    expect(r.language).toBe("javascript");
  });
});

describe("TEST_PATTERNS_BY_LANGUAGE export", () => {
  it("has patterns for all supported languages", () => {
    const languages = ["javascript", "java", "kotlin", "python", "go", "rust", "csharp", "ruby", "php", "swift", "dart"];
    for (const lang of languages) {
      expect(TEST_PATTERNS_BY_LANGUAGE[lang]).toBeDefined();
      expect(TEST_PATTERNS_BY_LANGUAGE[lang].length).toBeGreaterThan(0);
    }
  });
});
