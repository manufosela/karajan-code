import { describe, it, expect } from "vitest";
import {
  hasFrontendFiles,
  scanPerfDiff,
  PERF_PATTERNS,
  HEAVY_DEPS,
  FRONTEND_EXTENSIONS,
} from "../src/guards/perf-guard.js";

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

// Helper to combine multiple diffs (for tests needing both frontend + package.json)
function combineDiffs(...diffs) {
  return diffs.join("\n");
}

describe("hasFrontendFiles", () => {
  it("returns true for .html, .jsx, .tsx, .astro, .vue, .svelte files in diff", () => {
    for (const ext of [".html", ".jsx", ".tsx", ".astro", ".vue", ".svelte"]) {
      const diff = makeDiff(`src/component${ext}`, ["// content"]);
      expect(hasFrontendFiles(diff)).toBe(true);
    }
  });

  it("returns false for .js, .py backend files", () => {
    const diffJs = makeDiff("src/server.js", ['console.log("hello")']);
    const diffPy = makeDiff("src/app.py", ['print("hello")']);

    expect(hasFrontendFiles(diffJs)).toBe(false);
    expect(hasFrontendFiles(diffPy)).toBe(false);
  });
});

describe("scanPerfDiff", () => {
  it("skipped: true when no frontend files", () => {
    const diff = makeDiff("src/server.js", ['const x = 1;']);
    const result = scanPerfDiff(diff);

    expect(result.skipped).toBe(true);
    expect(result.pass).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  it("detects <img> without width/height -> warning violation", () => {
    const diff = makeDiff("src/components/App.jsx", [
      '  return <img src="photo.jpg" alt="photo" />;',
    ]);
    const result = scanPerfDiff(diff);

    expect(result.skipped).toBe(false);
    const violation = result.violations.find(v => v.id === "img-no-dimensions");
    expect(violation).toBeDefined();
    expect(violation.severity).toBe("warning");
  });

  it("detects <script src> without defer/async -> warning", () => {
    const diff = makeDiff("src/pages/index.html", [
      '<script src="app.js"></script>',
    ]);
    const result = scanPerfDiff(diff);

    const violation = result.violations.find(v => v.id === "script-no-defer");
    expect(violation).toBeDefined();
    expect(violation.severity).toBe("warning");
  });

  it("<script defer src> -> no violation for script-no-defer", () => {
    const diff = makeDiff("src/pages/index.html", [
      '<script defer src="app.js"></script>',
    ]);
    const result = scanPerfDiff(diff);

    const violation = result.violations.find(v => v.id === "script-no-defer");
    expect(violation).toBeUndefined();
  });

  it('<script type="module" src> -> no violation for script-no-defer', () => {
    const diff = makeDiff("src/pages/index.html", [
      '<script type="module" src="app.js"></script>',
    ]);
    const result = scanPerfDiff(diff);

    const violation = result.violations.find(v => v.id === "script-no-defer");
    expect(violation).toBeUndefined();
  });

  it("detects @font-face without font-display -> warning", () => {
    const diff = makeDiff("src/styles/global.css", [
      "@font-face { font-family: 'MyFont'; src: url('font.woff2'); }",
    ]);
    // .css is a frontend extension
    const result = scanPerfDiff(diff);

    const violation = result.violations.find(v => v.id === "font-no-display");
    expect(violation).toBeDefined();
    expect(violation.severity).toBe("warning");
  });

  it("detects document.write( -> warning", () => {
    const diff = makeDiff("src/components/Widget.jsx", [
      'document.write("<div>injected</div>");',
    ]);
    const result = scanPerfDiff(diff);

    const violation = result.violations.find(v => v.id === "document-write");
    expect(violation).toBeDefined();
    expect(violation.severity).toBe("warning");
  });

  it('detects "moment" in package.json -> info violation', () => {
    // Need a frontend file so the diff is not skipped, plus the package.json
    const frontendDiff = makeDiff("src/App.jsx", ["// updated"]);
    const pkgDiff = makeDiff("package.json", [
      '    "moment": "^2.29.4",',
    ]);
    const diff = combineDiffs(frontendDiff, pkgDiff);
    const result = scanPerfDiff(diff);

    const violation = result.violations.find(v => v.id === "heavy-moment");
    expect(violation).toBeDefined();
    expect(violation.severity).toBe("info");
  });

  it('detects "lodash" (not "lodash/debounce") in package.json -> info', () => {
    const frontendDiff = makeDiff("src/App.jsx", ["// updated"]);
    const pkgDiff = makeDiff("package.json", [
      '    "lodash": "^4.17.21",',
    ]);
    const diff = combineDiffs(frontendDiff, pkgDiff);
    const result = scanPerfDiff(diff);

    const violation = result.violations.find(v => v.id === "heavy-lodash");
    expect(violation).toBeDefined();
    expect(violation.severity).toBe("info");
  });

  it("pass: true by default (warnings don't block)", () => {
    const diff = makeDiff("src/pages/index.html", [
      '<script src="app.js"></script>',
      'document.write("hello");',
    ]);
    const result = scanPerfDiff(diff);

    expect(result.violations.length).toBeGreaterThan(0);
    expect(result.pass).toBe(true);
  });

  it("pass: false when block_on_warning: true and warnings exist", () => {
    const diff = makeDiff("src/pages/index.html", [
      '<script src="app.js"></script>',
    ]);
    const config = { guards: { perf: { block_on_warning: true } } };
    const result = scanPerfDiff(diff, config);

    expect(result.violations.some(v => v.severity === "warning")).toBe(true);
    expect(result.pass).toBe(false);
  });

  it("custom perf patterns from config are detected", () => {
    const diff = makeDiff("src/components/App.jsx", [
      'console.log("debug info");',
    ]);
    const config = {
      guards: {
        perf: {
          patterns: [
            { id: "no-console-log", pattern: "console\\.log", severity: "warning", message: "console.log in production" },
          ],
        },
      },
    };
    const result = scanPerfDiff(diff, config);

    const violation = result.violations.find(v => v.id === "no-console-log");
    expect(violation).toBeDefined();
    expect(violation.message).toBe("console.log in production");
  });

  it("null/empty diff -> pass: true, skipped: true", () => {
    expect(scanPerfDiff(null)).toEqual({ pass: true, violations: [], skipped: true });
    expect(scanPerfDiff("")).toEqual({ pass: true, violations: [], skipped: true });
    expect(scanPerfDiff(undefined)).toEqual({ pass: true, violations: [], skipped: true });
  });
});
