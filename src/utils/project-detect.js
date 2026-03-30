import fs from "node:fs/promises";
import path from "node:path";

// --- JS/TS ---
const JS_FRAMEWORKS = ["vitest", "jest", "@jest/core", "mocha", "ava", "tap", "playwright", "@playwright/test"];
const JS_CONFIG_FILES = [
  "vitest.config.js", "vitest.config.ts",
  "jest.config.js", "jest.config.ts", "jest.config.mjs",
  ".mocharc.yml", ".mocharc.json",
  "playwright.config.js", "playwright.config.ts"
];

// --- Multi-language project markers ---
const LANGUAGE_MARKERS = [
  // Java / Kotlin (Maven)
  { file: "pom.xml", framework: "junit", language: "java" },
  // Java / Kotlin (Gradle)
  { file: "build.gradle", framework: "junit", language: "java" },
  { file: "build.gradle.kts", framework: "junit", language: "kotlin" },
  // Python
  { file: "pytest.ini", framework: "pytest", language: "python" },
  { file: "pyproject.toml", framework: "pytest", language: "python" },
  { file: "setup.py", framework: "pytest", language: "python" },
  { file: "setup.cfg", framework: "pytest", language: "python" },
  { file: "tox.ini", framework: "pytest", language: "python" },
  // Go
  { file: "go.mod", framework: "go-test", language: "go" },
  // Rust
  { file: "Cargo.toml", framework: "cargo-test", language: "rust" },
  // C# / .NET
  { file: "*.csproj", glob: true, framework: "dotnet-test", language: "csharp" },
  { file: "*.sln", glob: true, framework: "dotnet-test", language: "csharp" },
  // Ruby
  { file: "Gemfile", framework: "rspec", language: "ruby" },
  { file: ".rspec", framework: "rspec", language: "ruby" },
  // PHP
  { file: "phpunit.xml", framework: "phpunit", language: "php" },
  { file: "phpunit.xml.dist", framework: "phpunit", language: "php" },
  // Swift
  { file: "Package.swift", framework: "xctest", language: "swift" },
  // Dart / Flutter
  { file: "pubspec.yaml", framework: "dart-test", language: "dart" },
];

/** Test file patterns per language (used by TDD policy). */
export const TEST_PATTERNS_BY_LANGUAGE = {
  javascript: ["/tests/", "/__tests__/", ".test.", ".spec."],
  java:       ["/src/test/", "/test/", "Test.java", "Tests.java", "IT.java"],
  kotlin:     ["/src/test/", "/test/", "Test.kt", "Tests.kt", "/src/androidTest/"],
  python:     ["/tests/", "/test/", "test_", "_test.py", "tests.py"],
  go:         ["_test.go"],
  rust:       ["/tests/", "#[test]", "#[cfg(test)]"],
  csharp:     ["/Tests/", "/Test/", "Tests.cs", "Test.cs", ".Tests/"],
  ruby:       ["/spec/", "/test/", "_spec.rb", "_test.rb"],
  php:        ["/tests/", "/test/", "Test.php"],
  swift:      ["/Tests/", "Tests.swift"],
  dart:       ["/test/", "_test.dart"],
};

function frameworkFromConfig(filename) {
  if (filename.startsWith("vitest")) return "vitest";
  if (filename.startsWith("jest")) return "jest";
  if (filename.startsWith(".mocha")) return "mocha";
  return "playwright";
}

/**
 * Detect if the project has a test framework configured.
 * Checks JS (package.json), then multi-language project markers.
 * @param {string} cwd - Project root
 * @returns {Promise<{hasTests: boolean, framework: string|null, language: string|null}>}
 */
export async function detectTestFramework(cwd = process.cwd()) {
  // 1. JS/TS: check package.json
  try {
    const pkgRaw = await fs.readFile(path.join(cwd, "package.json"), "utf8");
    const pkg = JSON.parse(pkgRaw);
    const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };

    for (const fw of JS_FRAMEWORKS) {
      if (allDeps[fw]) {
        return { hasTests: true, framework: fw, language: "javascript" };
      }
    }
  } catch { /* no package.json or parse error */ }

  // 2. JS/TS: check config files
  for (const cf of JS_CONFIG_FILES) {
    try {
      await fs.access(path.join(cwd, cf));
      return { hasTests: true, framework: frameworkFromConfig(cf), language: "javascript" };
    } catch { /* not found */ }
  }

  // 3. Multi-language: check project markers
  for (const marker of LANGUAGE_MARKERS) {
    try {
      if (marker.glob) {
        const entries = await fs.readdir(cwd);
        const ext = marker.file.replace("*", "");
        if (entries.some((e) => e.endsWith(ext))) {
          return { hasTests: true, framework: marker.framework, language: marker.language };
        }
      } else {
        await fs.access(path.join(cwd, marker.file));
        return { hasTests: true, framework: marker.framework, language: marker.language };
      }
    } catch { /* not found */ }
  }

  return { hasTests: false, framework: null, language: null };
}

/**
 * Detect if SonarQube is configured for this project.
 * @param {string} cwd - Project root
 * @returns {Promise<{configured: boolean}>}
 */
export async function detectSonarConfig(cwd = process.cwd()) {
  try {
    await fs.access(path.join(cwd, "sonar-project.properties"));
    return { configured: true };
  } catch { /* sonar-project.properties does not exist */
    return { configured: false };
  }
}
