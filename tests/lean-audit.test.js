import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  measureBasalCost,
  loadPreviousAudit,
  saveAuditSnapshot,
  computeGrowthDelta
} from "../src/audit/basal-cost.js";

let tmpDir;

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "kj-lean-audit-"));
}

beforeEach(() => {
  tmpDir = makeTmpDir();
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("measureBasalCost", () => {
  it("counts lines and files", async () => {
    const src = path.join(tmpDir, "src");
    fs.mkdirSync(src);
    fs.writeFileSync(path.join(src, "a.js"), "const a = 1;\nconst b = 2;\n");
    fs.writeFileSync(path.join(src, "b.js"), "export default 42;\n");

    const metrics = await measureBasalCost(tmpDir);

    expect(metrics.totalFiles).toBe(2);
    expect(metrics.totalLines).toBeGreaterThanOrEqual(4);
  });

  it("excludes node_modules", async () => {
    const src = path.join(tmpDir, "src");
    const nm = path.join(tmpDir, "node_modules", "pkg");
    fs.mkdirSync(src);
    fs.mkdirSync(nm, { recursive: true });
    fs.writeFileSync(path.join(src, "a.js"), "1\n2\n3\n");
    fs.writeFileSync(path.join(nm, "x.js"), "should be excluded\n");

    const metrics = await measureBasalCost(tmpDir);

    expect(metrics.totalFiles).toBe(1);
  });

  it("counts dependencies from package.json", async () => {
    fs.writeFileSync(
      path.join(tmpDir, "package.json"),
      JSON.stringify({
        dependencies: { foo: "^1.0.0", bar: "^2.0.0" },
        devDependencies: { baz: "^3.0.0" }
      })
    );

    const metrics = await measureBasalCost(tmpDir);

    expect(metrics.dependencies.dependencies).toBe(2);
    expect(metrics.dependencies.devDependencies).toBe(1);
    expect(metrics.dependencies.total).toBe(3);
  });

  it("returns zero deps when no package.json", async () => {
    const metrics = await measureBasalCost(tmpDir);

    expect(metrics.dependencies.total).toBe(0);
  });
});

describe("loadPreviousAudit", () => {
  it("returns null when no previous audit", () => {
    const originalEnv = process.env.KJ_HOME;
    process.env.KJ_HOME = path.join(tmpDir, ".karajan");
    try {
      const result = loadPreviousAudit("/fake/project");
      expect(result).toBeNull();
    } finally {
      if (originalEnv === undefined) delete process.env.KJ_HOME;
      else process.env.KJ_HOME = originalEnv;
    }
  });
});

describe("saveAuditSnapshot + loadPreviousAudit roundtrip", () => {
  it("saves and loads audit snapshot", () => {
    const originalEnv = process.env.KJ_HOME;
    process.env.KJ_HOME = path.join(tmpDir, ".karajan");
    try {
      const projectDir = "/fake/my-project";
      const metrics = {
        totalLines: 500,
        totalFiles: 20,
        dependencies: { dependencies: 5, devDependencies: 3, total: 8 },
        unusedDependencies: { unused: ["lodash"] },
        deadExports: []
      };

      const saved = saveAuditSnapshot(projectDir, metrics);
      expect(saved.timestamp).toBeDefined();
      expect(saved.totalLines).toBe(500);

      const loaded = loadPreviousAudit(projectDir);
      expect(loaded).not.toBeNull();
      expect(loaded.totalLines).toBe(500);
      expect(loaded.totalFiles).toBe(20);
      expect(loaded.dependencies.total).toBe(8);
      expect(loaded.timestamp).toBe(saved.timestamp);
    } finally {
      if (originalEnv === undefined) delete process.env.KJ_HOME;
      else process.env.KJ_HOME = originalEnv;
    }
  });
});

describe("computeGrowthDelta", () => {
  it("calculates correct deltas", () => {
    const current = {
      totalLines: 600,
      totalFiles: 25,
      dependencies: { total: 10 }
    };
    const previous = {
      totalLines: 500,
      totalFiles: 20,
      dependencies: { total: 8 },
      timestamp: "2026-01-01T00:00:00.000Z"
    };

    const delta = computeGrowthDelta(current, previous);

    expect(delta.lines).toBe(100);
    expect(delta.files).toBe(5);
    expect(delta.deps).toBe(2);
    expect(delta.since).toBe("2026-01-01T00:00:00.000Z");
  });

  it("returns null with no previous audit", () => {
    const current = {
      totalLines: 600,
      totalFiles: 25,
      dependencies: { total: 10 }
    };

    const delta = computeGrowthDelta(current, null);

    expect(delta).toBeNull();
  });

  it("handles negative deltas", () => {
    const current = {
      totalLines: 400,
      totalFiles: 15,
      dependencies: { total: 5 }
    };
    const previous = {
      totalLines: 500,
      totalFiles: 20,
      dependencies: { total: 8 },
      timestamp: "2026-01-01T00:00:00.000Z"
    };

    const delta = computeGrowthDelta(current, previous);

    expect(delta.lines).toBe(-100);
    expect(delta.files).toBe(-5);
    expect(delta.deps).toBe(-3);
  });
});
