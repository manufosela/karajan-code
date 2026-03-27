import { describe, expect, it, vi, beforeEach } from "vitest";
import { detectTestFramework, TEST_PATTERNS_BY_LANGUAGE } from "../src/utils/project-detect.js";
import { evaluateTddPolicy } from "../src/review/tdd-policy.js";
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

describe("TDD policy with multi-language patterns", () => {
  it("detects Java test files (src/test/)", () => {
    const diff = "diff --git a/src/main/java/App.java b/src/main/java/App.java\ndiff --git a/src/test/java/AppTest.java b/src/test/java/AppTest.java";
    const r = evaluateTddPolicy(diff);
    expect(r.ok).toBe(true);
    expect(r.testFiles).toContain("src/test/java/AppTest.java");
    expect(r.sourceFiles).toContain("src/main/java/App.java");
  });

  it("fails TDD for Java source without test", () => {
    const diff = "diff --git a/src/main/java/App.java b/src/main/java/App.java";
    const r = evaluateTddPolicy(diff);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("source_changes_without_tests");
  });

  it("detects Python test files (test_*.py)", () => {
    const diff = "diff --git a/app.py b/app.py\ndiff --git a/tests/test_app.py b/tests/test_app.py";
    const r = evaluateTddPolicy(diff);
    expect(r.ok).toBe(true);
    expect(r.testFiles).toContain("tests/test_app.py");
  });

  it("detects Go test files (_test.go)", () => {
    const diff = "diff --git a/main.go b/main.go\ndiff --git a/main_test.go b/main_test.go";
    const r = evaluateTddPolicy(diff);
    expect(r.ok).toBe(true);
    expect(r.testFiles).toContain("main_test.go");
  });

  it("detects Kotlin test files", () => {
    const diff = "diff --git a/src/main/kotlin/App.kt b/src/main/kotlin/App.kt\ndiff --git a/src/test/kotlin/AppTest.kt b/src/test/kotlin/AppTest.kt";
    const r = evaluateTddPolicy(diff);
    expect(r.ok).toBe(true);
    expect(r.testFiles).toContain("src/test/kotlin/AppTest.kt");
  });

  it("detects C# test files", () => {
    const diff = "diff --git a/src/App.cs b/src/App.cs\ndiff --git a/Tests/AppTest.cs b/Tests/AppTest.cs";
    const r = evaluateTddPolicy(diff);
    expect(r.ok).toBe(true);
    expect(r.testFiles).toContain("Tests/AppTest.cs");
  });

  it("detects Ruby spec files", () => {
    const diff = "diff --git a/lib/app.rb b/lib/app.rb\ndiff --git a/spec/app_spec.rb b/spec/app_spec.rb";
    const r = evaluateTddPolicy(diff);
    expect(r.ok).toBe(true);
    expect(r.testFiles).toContain("spec/app_spec.rb");
  });

  it("detects PHP test files", () => {
    const diff = "diff --git a/src/App.php b/src/App.php\ndiff --git a/tests/AppTest.php b/tests/AppTest.php";
    const r = evaluateTddPolicy(diff);
    expect(r.ok).toBe(true);
    expect(r.testFiles).toContain("tests/AppTest.php");
  });

  it("detects Dart test files", () => {
    const diff = "diff --git a/lib/app.dart b/lib/app.dart\ndiff --git a/test/app_test.dart b/test/app_test.dart";
    const r = evaluateTddPolicy(diff);
    expect(r.ok).toBe(true);
    expect(r.testFiles).toContain("test/app_test.dart");
  });

  it("skips TDD for doc taskType regardless of language", () => {
    const diff = "diff --git a/src/main/java/App.java b/src/main/java/App.java";
    const r = evaluateTddPolicy(diff, {}, [], "doc");
    expect(r.ok).toBe(true);
    expect(r.reason).toBe("tdd_not_applicable_for_task_type");
  });

  it("skips TDD for infra taskType", () => {
    const diff = "diff --git a/main.go b/main.go";
    const r = evaluateTddPolicy(diff, {}, [], "infra");
    expect(r.ok).toBe(true);
    expect(r.reason).toBe("tdd_not_applicable_for_task_type");
  });
});
