import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { collectDeadExports, groupDeadExportsBySeverity } from "../../src/audit/dead-exports.js";

// KJC-TSK v2.17 — knip dead-exports collector for `kj audit`.
// Stack-aware: skipped on non-JS/TS or missing package.json.

describe("collectDeadExports — stack gating", () => {
  it("returns available:false when no JS/TS detected", async () => {
    const res = await collectDeadExports("/tmp/whatever", { language: "python" });
    expect(res.available).toBe(false);
    expect(res.reason).toMatch(/no js\/ts/i);
  });

  it("returns available:false when stack is null", async () => {
    const res = await collectDeadExports("/tmp/whatever", null);
    expect(res.available).toBe(false);
  });

  it("returns available:false when no package.json present", async () => {
    let tmp;
    try {
      tmp = mkdtempSync(path.join(tmpdir(), "knip-no-pkg-"));
      // JS file but no package.json
      writeFileSync(path.join(tmp, "a.js"), "export const a = 1;\n");
      const res = await collectDeadExports(tmp, { language: "javascript" });
      expect(res.available).toBe(false);
      expect(res.reason).toMatch(/package\.json/);
    } finally {
      if (tmp) rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("collectDeadExports — actual scan", () => {
  let tmp;
  beforeEach(() => { tmp = mkdtempSync(path.join(tmpdir(), "knip-scan-")); });
  afterEach(() => { rmSync(tmp, { recursive: true, force: true }); });

  it("detects an unused export in a minimal project", async () => {
    writeFileSync(path.join(tmp, "package.json"), JSON.stringify({
      name: "fixture", version: "0.0.0", type: "module", main: "src/index.js",
    }));
    mkdirSync(path.join(tmp, "src"), { recursive: true });
    writeFileSync(path.join(tmp, "src/index.js"), `import { used } from "./lib.js";\nexport function main() { return used(); }\n`);
    writeFileSync(path.join(tmp, "src/lib.js"), `export function used() { return 1; }\nexport function unusedExport() { return 2; }\n`);

    const res = await collectDeadExports(tmp, { language: "javascript" });
    expect(res.available).toBe(true);
    expect(res.total).toBeGreaterThanOrEqual(1);
    // We expect "unusedExport" somewhere in the kept items.
    const allItems = [...(res.exports || []), ...(res.files || [])];
    expect(allItems.some((i) => i.name === "unusedExport" || (i.message || "").includes("unusedExport"))).toBe(true);
  }, 30_000);

  it("respects config.audit.false_positives to suppress known dead exports", async () => {
    writeFileSync(path.join(tmp, "package.json"), JSON.stringify({
      name: "fixture", version: "0.0.0", type: "module", main: "src/index.js",
    }));
    mkdirSync(path.join(tmp, "src"), { recursive: true });
    writeFileSync(path.join(tmp, "src/index.js"), `import { used } from "./lib.js";\nexport function main() { return used(); }\n`);
    writeFileSync(path.join(tmp, "src/lib.js"), `export function used() { return 1; }\nexport function unusedExport() { return 2; }\n`);

    const config = {
      audit: {
        false_positives: [
          { tool: "knip", rule: "unused-exports", filePattern: "src/", reason: "fixture suppression" },
        ],
      },
    };
    const res = await collectDeadExports(tmp, { language: "javascript" }, config);
    expect(res.available).toBe(true);
    // unused-exports should be suppressed; unused-files (none here) and
    // unused-types still pass through.
    expect((res.exports || []).length).toBe(0);
    expect(res.suppressedCount).toBeGreaterThanOrEqual(1);
  }, 30_000);
});

describe("groupDeadExportsBySeverity", () => {
  it("buckets MAJOR (unused-files) and MINOR (unused-exports)", () => {
    const items = [
      { severity: "MAJOR", rule: "unused-files", path: "src/dead.js" },
      { severity: "MINOR", rule: "unused-exports", path: "src/a.js", name: "x" },
      { severity: "MINOR", rule: "unused-types", path: "src/b.ts", name: "T" },
    ];
    const groups = groupDeadExportsBySeverity(items);
    expect(groups.MAJOR).toHaveLength(1);
    expect(groups.MINOR).toHaveLength(2);
  });

  it("handles falsy / empty input", () => {
    expect(groupDeadExportsBySeverity(null)).toEqual({ MAJOR: [], MINOR: [] });
    expect(groupDeadExportsBySeverity([])).toEqual({ MAJOR: [], MINOR: [] });
  });
});
