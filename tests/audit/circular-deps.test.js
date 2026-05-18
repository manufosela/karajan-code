import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { collectCircularDeps, groupCyclesBySeverity } from "../../src/audit/circular-deps.js";

// KJC-TSK v2.17 — madge circular-import collector for `kj audit`.
// Stack-aware: should be a no-op on non-JS/TS projects.

describe("collectCircularDeps — stack gating", () => {
  it("returns available:false when no JS/TS detected", async () => {
    const res = await collectCircularDeps("/tmp/whatever", { language: "python" });
    expect(res.available).toBe(false);
    expect(res.reason).toMatch(/no js\/ts/i);
  });

  it("returns available:false when stack is null", async () => {
    const res = await collectCircularDeps("/tmp/whatever", null);
    expect(res.available).toBe(false);
  });

  it("accepts `languages: [...]` array shape", async () => {
    let tmp;
    try {
      tmp = mkdtempSync(path.join(tmpdir(), "circ-stack-"));
      mkdirSync(path.join(tmp, "src"), { recursive: true });
      writeFileSync(path.join(tmp, "src/a.js"), "export const a = 1;\n");
      const res = await collectCircularDeps(tmp, { languages: ["typescript", "html"] });
      expect(res.available).toBe(true);
    } finally {
      if (tmp) rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("collectCircularDeps — actual scan", () => {
  let tmp;
  beforeEach(() => { tmp = mkdtempSync(path.join(tmpdir(), "circ-scan-")); });
  afterEach(() => { rmSync(tmp, { recursive: true, force: true }); });

  it("detects a simple 2-file cycle", async () => {
    mkdirSync(path.join(tmp, "src"), { recursive: true });
    writeFileSync(path.join(tmp, "src/a.js"), `import { b } from "./b.js";\nexport const a = () => b();\n`);
    writeFileSync(path.join(tmp, "src/b.js"), `import { a } from "./a.js";\nexport const b = () => a();\n`);

    const res = await collectCircularDeps(tmp, { language: "javascript" });
    expect(res.available).toBe(true);
    expect(res.total).toBeGreaterThanOrEqual(1);
    expect(res.cycles[0].rule).toBe("circular-import");
    expect(res.cycles[0].tool).toBe("madge");
    expect(res.cycles[0].cycle.length).toBe(2);
    expect(res.cycles[0].severity).toBe("MINOR");
  });

  it("returns total:0 on a clean project", async () => {
    mkdirSync(path.join(tmp, "src"), { recursive: true });
    writeFileSync(path.join(tmp, "src/a.js"), `export const a = 1;\n`);
    writeFileSync(path.join(tmp, "src/b.js"), `import { a } from "./a.js";\nexport const b = a + 1;\n`);

    const res = await collectCircularDeps(tmp, { language: "javascript" });
    expect(res.available).toBe(true);
    expect(res.total).toBe(0);
    expect(res.cycles).toHaveLength(0);
  });

  it("flags 4+ file cycles as MAJOR", async () => {
    mkdirSync(path.join(tmp, "src"), { recursive: true });
    writeFileSync(path.join(tmp, "src/a.js"), `import { b } from "./b.js";\nexport const a = () => b();\n`);
    writeFileSync(path.join(tmp, "src/b.js"), `import { c } from "./c.js";\nexport const b = () => c();\n`);
    writeFileSync(path.join(tmp, "src/c.js"), `import { d } from "./d.js";\nexport const c = () => d();\n`);
    writeFileSync(path.join(tmp, "src/d.js"), `import { a } from "./a.js";\nexport const d = () => a();\n`);

    const res = await collectCircularDeps(tmp, { language: "javascript" });
    expect(res.available).toBe(true);
    expect(res.total).toBeGreaterThanOrEqual(1);
    expect(res.cycles[0].severity).toBe("MAJOR");
    expect(res.cycles[0].cycle.length).toBe(4);
  });

  it("returns available:false if entrypoint (src/) missing", async () => {
    // tmp has no src/ folder
    const res = await collectCircularDeps(tmp, { language: "javascript" });
    expect(res.available).toBe(false);
    expect(res.reason).toMatch(/src.*not found/i);
  });

  it("respects config.audit.false_positives to suppress known cycles", async () => {
    mkdirSync(path.join(tmp, "src"), { recursive: true });
    writeFileSync(path.join(tmp, "src/a.js"), `import { b } from "./b.js";\nexport const a = () => b();\n`);
    writeFileSync(path.join(tmp, "src/b.js"), `import { a } from "./a.js";\nexport const b = () => a();\n`);

    const config = {
      audit: {
        false_positives: [
          { tool: "madge", rule: "circular-import", filePattern: "src/", reason: "fixture" },
        ],
      },
    };
    const res = await collectCircularDeps(tmp, { language: "javascript" }, config);
    expect(res.available).toBe(true);
    expect(res.total).toBe(0);
    expect(res.suppressedCount).toBeGreaterThanOrEqual(1);
    expect(res.suppressed[0]._suppressedBy.reason).toBe("fixture");
  });
});

describe("groupCyclesBySeverity", () => {
  it("buckets MAJOR and MINOR cycles into the right groups", () => {
    const cycles = [
      { severity: "MAJOR", cycle: ["a", "b", "c", "d"] },
      { severity: "MINOR", cycle: ["x", "y"] },
      { severity: "MINOR", cycle: ["p", "q"] },
    ];
    const groups = groupCyclesBySeverity(cycles);
    expect(groups.MAJOR).toHaveLength(1);
    expect(groups.MINOR).toHaveLength(2);
  });

  it("returns empty buckets for falsy input", () => {
    expect(groupCyclesBySeverity(null)).toEqual({ MAJOR: [], MINOR: [] });
    expect(groupCyclesBySeverity([])).toEqual({ MAJOR: [], MINOR: [] });
  });
});
