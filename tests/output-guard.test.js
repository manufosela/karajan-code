import { describe, it, expect } from "vitest";
import {
  extractAddedLines,
  scanDiff,
  checkProtectedFiles,
  compilePatterns,
  compileProtectedFiles,
  DESTRUCTIVE_PATTERNS,
  CREDENTIAL_PATTERNS,
  DEFAULT_PROTECTED_FILES,
} from "../src/guards/output-guard.js";

// Helper to build a realistic unified diff
function makeDiff(file, addedLines, contextLines = []) {
  const header = [
    `diff --git a/${file} b/${file}`,
    `--- a/${file}`,
    `+++ b/${file}`,
    `@@ -1,${contextLines.length} +1,${contextLines.length + addedLines.length} @@`,
  ];
  const body = [
    ...contextLines.map(l => ` ${l}`),
    ...addedLines.map(l => `+${l}`),
  ];
  return [...header, ...body].join("\n");
}

describe("extractAddedLines", () => {
  it("parses unified diff correctly, extracts only + lines (not ++), tracks file and line numbers", () => {
    const diff = [
      "diff --git a/src/deploy.sh b/src/deploy.sh",
      "--- a/src/deploy.sh",
      "+++ b/src/deploy.sh",
      "@@ -1,3 +1,5 @@",
      " #!/bin/bash",
      "+echo first",
      " echo middle",
      "+echo second",
      " echo end",
    ].join("\n");

    const result = extractAddedLines(diff);

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ file: "src/deploy.sh", line: 2, content: "echo first" });
    expect(result[1]).toEqual({ file: "src/deploy.sh", line: 4, content: "echo second" });
  });

  it("returns empty array for null/undefined input", () => {
    expect(extractAddedLines(null)).toEqual([]);
    expect(extractAddedLines(undefined)).toEqual([]);
  });
});

describe("scanDiff", () => {
  it("detects rm -rf in added lines -> pass: false, critical", () => {
    const diff = makeDiff("src/deploy.sh", ['rm -rf /tmp/build'], ['#!/bin/bash', 'echo "deploying"']);
    const result = scanDiff(diff);

    expect(result.pass).toBe(false);
    expect(result.violations.length).toBeGreaterThanOrEqual(1);
    const rmViolation = result.violations.find(v => v.id === "rm-rf");
    expect(rmViolation).toBeDefined();
    expect(rmViolation.severity).toBe("critical");
  });

  it("detects DROP TABLE -> pass: false, critical", () => {
    const diff = makeDiff("src/migration.sql", ['DROP TABLE users;'], ['-- migration']);
    const result = scanDiff(diff);

    expect(result.pass).toBe(false);
    const violation = result.violations.find(v => v.id === "drop-table");
    expect(violation).toBeDefined();
    expect(violation.severity).toBe("critical");
  });

  it("detects git reset --hard -> pass: false, critical", () => {
    const diff = makeDiff("scripts/clean.sh", ['git reset --hard HEAD~3'], ['#!/bin/bash']);
    const result = scanDiff(diff);

    expect(result.pass).toBe(false);
    const violation = result.violations.find(v => v.id === "git-reset-hard");
    expect(violation).toBeDefined();
    expect(violation.severity).toBe("critical");
  });

  it("detects AWS key pattern AKIA... -> pass: false, critical", () => {
    const diff = makeDiff("src/config.js", ['const key = "AKIAIOSFODNN7EXAMPLE";'], ['// config']);
    const result = scanDiff(diff);

    expect(result.pass).toBe(false);
    const violation = result.violations.find(v => v.id === "aws-key");
    expect(violation).toBeDefined();
    expect(violation.severity).toBe("critical");
  });

  it("detects private key header -> pass: false, critical", () => {
    const diff = makeDiff("certs/key.pem", ['-----BEGIN RSA PRIVATE KEY-----'], []);
    const result = scanDiff(diff);

    expect(result.pass).toBe(false);
    const violation = result.violations.find(v => v.id === "private-key");
    expect(violation).toBeDefined();
    expect(violation.severity).toBe("critical");
  });

  it("detects generic secret pattern -> critical severity, pass: false", () => {
    const diff = makeDiff("src/config.js", ['const password = "supersecretvalue123";'], ['// settings']);
    const result = scanDiff(diff);

    const violation = result.violations.find(v => v.id === "generic-secret");
    expect(violation).toBeDefined();
    expect(violation.severity).toBe("critical");
    expect(result.pass).toBe(false);
  });

  it("detects OpenAI API key", () => {
    const diff = makeDiff("src/ai.js", ['const key = "sk-abc123def456ghi789jkl012mno345pqr678"'], []);
    const result = scanDiff(diff);
    expect(result.pass).toBe(false);
    expect(result.violations.some(v => v.id === "openai-key")).toBe(true);
  });

  it("detects Anthropic API key", () => {
    const diff = makeDiff("src/ai.js", ['const key = "sk-ant-abc123def456ghi789jkl012mno"'], []);
    const result = scanDiff(diff);
    expect(result.pass).toBe(false);
    expect(result.violations.some(v => v.id === "anthropic-key")).toBe(true);
  });

  it("detects Google API key", () => {
    const diff = makeDiff("src/maps.js", ['const key = "AIzaTEST_FAKE_KEY_000000000000000000000"'], []);
    const result = scanDiff(diff);
    expect(result.pass).toBe(false);
    expect(result.violations.some(v => v.id === "google-api-key")).toBe(true);
  });

  it("detects Firebase config with hardcoded key", () => {
    const diff = makeDiff("src/firebase.js", ['"apiKey": "AIzaTEST_FAKE_KEY_000000000000000000000"'], []);
    const result = scanDiff(diff);
    expect(result.pass).toBe(false);
    expect(result.violations.some(v => v.id === "firebase-key")).toBe(true);
  });

  it("detects database URL with credentials", () => {
    const diff = makeDiff("src/db.js", ['const url = "mongodb://admin:secretpass@localhost:27017/mydb"'], []);
    const result = scanDiff(diff);
    expect(result.pass).toBe(false);
    expect(result.violations.some(v => v.id === "database-url")).toBe(true);
  });

  it("detects hardcoded key in variable assignment", () => {
    const diff = makeDiff("src/config.js", ['const apiKey = "abcdef1234567890abcdef"'], []);
    const result = scanDiff(diff);
    expect(result.pass).toBe(false);
    expect(result.violations.some(v => v.id === "hardcoded-key-assignment")).toBe(true);
  });

  it("allows process.env usage (no false positive)", () => {
    const diff = makeDiff("src/config.js", ['const apiKey = process.env.API_KEY'], []);
    const result = scanDiff(diff);
    expect(result.pass).toBe(true);
  });

  it("clean diff without patterns -> pass: true, empty violations", () => {
    const diff = makeDiff("src/utils.js", ['export function add(a, b) { return a + b; }'], ['// utils']);
    const result = scanDiff(diff);

    expect(result.pass).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  it("null/empty diff -> pass: true", () => {
    expect(scanDiff(null).pass).toBe(true);
    expect(scanDiff("").pass).toBe(true);
    expect(scanDiff(undefined).pass).toBe(true);
  });

  it("with custom config patterns, detects custom pattern", () => {
    const diff = makeDiff("src/app.js", ['eval("alert(1)")'], ['// app']);
    const config = {
      guards: {
        output: {
          patterns: [
            { id: "no-eval", pattern: "eval\\(", severity: "critical", message: "eval() is forbidden" },
          ],
        },
      },
    };
    const result = scanDiff(diff, config);

    expect(result.pass).toBe(false);
    const violation = result.violations.find(v => v.id === "no-eval");
    expect(violation).toBeDefined();
    expect(violation.severity).toBe("critical");
    expect(violation.message).toBe("eval() is forbidden");
  });
});

describe("checkProtectedFiles", () => {
  it("detects .env in modified files", () => {
    const diff = [
      "diff --git a/.env b/.env",
      "--- a/.env",
      "+++ b/.env",
      "@@ -1,2 +1,3 @@",
      " DB_HOST=localhost",
      "+DB_PASSWORD=secret",
    ].join("\n");

    const violations = checkProtectedFiles(diff, DEFAULT_PROTECTED_FILES);
    expect(violations.length).toBeGreaterThanOrEqual(1);
    expect(violations[0].severity).toBe("critical");
    expect(violations[0].id).toBe("protected-file");
  });

  it("detects serviceAccountKey.json in modified files", () => {
    const diff = [
      "diff --git a/config/serviceAccountKey.json b/config/serviceAccountKey.json",
      "--- a/config/serviceAccountKey.json",
      "+++ b/config/serviceAccountKey.json",
      "@@ -1,2 +1,3 @@",
      " {",
      '+  "project_id": "my-project"',
    ].join("\n");

    const violations = checkProtectedFiles(diff, DEFAULT_PROTECTED_FILES);
    expect(violations.length).toBeGreaterThanOrEqual(1);
    expect(violations[0].file).toBe("config/serviceAccountKey.json");
  });
});

describe("compilePatterns", () => {
  it("custom patterns from config are appended to built-in", () => {
    const configGuards = {
      output: {
        patterns: [
          { id: "custom-1", pattern: "foo", severity: "warning", message: "foo found" },
        ],
      },
    };
    const patterns = compilePatterns(configGuards);

    const builtInCount = DESTRUCTIVE_PATTERNS.length + CREDENTIAL_PATTERNS.length;
    expect(patterns).toHaveLength(builtInCount + 1);
    expect(patterns[patterns.length - 1].id).toBe("custom-1");
  });
});

describe("compileProtectedFiles", () => {
  it("custom protected files are merged with defaults (no duplicates)", () => {
    const configGuards = {
      output: {
        protected_files: [".env", "custom-secret.yaml"],
      },
    };
    const files = compileProtectedFiles(configGuards);

    // .env should not be duplicated
    expect(files.filter(f => f === ".env")).toHaveLength(1);
    // custom file should be present
    expect(files).toContain("custom-secret.yaml");
    // all defaults should be present
    for (const df of DEFAULT_PROTECTED_FILES) {
      expect(files).toContain(df);
    }
  });
});
