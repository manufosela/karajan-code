import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  filterFalsePositives,
  hasInlineIgnore,
  DEFAULT_FALSE_POSITIVES,
} from "../../src/audit/issue-filter.js";

// KJC-TSK-0416 (v2.16): pre-filtro de falsos positivos Sonar.
// Generalised to all audit collectors in v2.17 — see cross-tool cases below.

describe("DEFAULT_FALSE_POSITIVES", () => {
  it("contiene la regla S2699 para tests/architecture/", () => {
    expect(DEFAULT_FALSE_POSITIVES.some(
      (r) => r.rule === "javascript:S2699" && r.filePattern.test("tests/architecture/foo.test.js")
    )).toBe(true);
  });
});

describe("filterFalsePositives — rules estáticas", () => {
  const mkIssue = (rule, component) => ({ rule, component, line: 10, severity: "BLOCKER" });

  it("suprime issue que matchea rule + filePattern del default", () => {
    const issues = [
      mkIssue("javascript:S2699", "proj-x:tests/architecture/foo.test.js"),
      mkIssue("javascript:S1234", "proj-x:tests/architecture/foo.test.js"), // mismo file, distinta regla
      mkIssue("javascript:S2699", "proj-x:src/something.js"),                 // misma regla, otro file
    ];
    const { kept, suppressed } = filterFalsePositives(issues);
    expect(suppressed).toHaveLength(1);
    expect(suppressed[0].rule).toBe("javascript:S2699");
    expect(suppressed[0]._suppressedBy.reason).toMatch(/structural/i);
    expect(kept).toHaveLength(2);
  });

  it("acepta extraRules del config con filePattern como string", () => {
    const issues = [{ rule: "X", component: "p:src/legacy/foo.js", line: 1 }];
    const { kept, suppressed } = filterFalsePositives(issues, {
      extraRules: [{ rule: "X", filePattern: "src/legacy/", reason: "deprecated dir" }],
    });
    expect(kept).toHaveLength(0);
    expect(suppressed).toHaveLength(1);
    expect(suppressed[0]._suppressedBy.reason).toBe("deprecated dir");
  });

  it("rule sin match deja el issue en kept", () => {
    const issues = [{ rule: "X", component: "p:src/y.js", line: 1 }];
    const { kept, suppressed } = filterFalsePositives(issues);
    expect(kept).toHaveLength(1);
    expect(suppressed).toHaveLength(0);
  });

  it("array vacío / no-array → no rompe", () => {
    expect(filterFalsePositives([])).toEqual({ kept: [], suppressed: [] });
    expect(filterFalsePositives(null)).toEqual({ kept: [], suppressed: [] });
  });
});

describe("hasInlineIgnore", () => {
  let tmpDir;
  beforeEach(() => { tmpDir = mkdtempSync(path.join(tmpdir(), "issue-filter-")); });
  afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }); });

  it("detecta `// karajan-sonar-ignore: <ruleId>` en la línea exacta", () => {
    const file = path.join(tmpDir, "x.js");
    writeFileSync(file, "const a = 1; // karajan-sonar-ignore: javascript:S1234\nconst b = 2;\n");
    expect(hasInlineIgnore(file, 1, "javascript:S1234")).toBe(true);
  });

  it("detecta el comment en la línea anterior", () => {
    const file = path.join(tmpDir, "y.js");
    writeFileSync(file, "// karajan-sonar-ignore: javascript:S1234\nconst a = 1;\n");
    expect(hasInlineIgnore(file, 2, "javascript:S1234")).toBe(true);
  });

  it("no matchea otra ruleId", () => {
    const file = path.join(tmpDir, "z.js");
    writeFileSync(file, "// karajan-sonar-ignore: javascript:S9999\nconst a = 1;\n");
    expect(hasInlineIgnore(file, 2, "javascript:S1234")).toBe(false);
  });

  it("file no existe → false", () => {
    expect(hasInlineIgnore(path.join(tmpDir, "ghost.js"), 1, "X")).toBe(false);
  });

  it("args inválidos → false sin throw", () => {
    expect(hasInlineIgnore(null, 1, "X")).toBe(false);
    expect(hasInlineIgnore("/x", null, "X")).toBe(false);
    expect(hasInlineIgnore("/x", 1, null)).toBe(false);
  });
});

describe("filterFalsePositives — inline ignore integration", () => {
  let tmpDir;
  beforeEach(() => { tmpDir = mkdtempSync(path.join(tmpdir(), "issue-filter-int-")); });
  afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }); });

  it("respeta inline ignore como segundo mecanismo (cuando rule estática no aplica)", () => {
    mkdirSync(path.join(tmpDir, "src"), { recursive: true });
    const relativePath = "src/foo.js";
    const absPath = path.join(tmpDir, relativePath);
    writeFileSync(absPath, "const a = 1; // karajan-sonar-ignore: javascript:S1234\n");
    const issues = [{ rule: "javascript:S1234", component: `proj:${relativePath}`, line: 1 }];
    const { kept, suppressed } = filterFalsePositives(issues, { projectRoot: tmpDir });
    expect(suppressed).toHaveLength(1);
    expect(suppressed[0]._suppressedBy.reason).toMatch(/inline/i);
    expect(kept).toHaveLength(0);
  });
});

// v2.17: cross-tool cases. The filter must distinguish issues from different
// collectors so a `knip:unused-exports` rule cannot accidentally match a
// `sonar:unused-exports` issue (or vice-versa) just because the ruleId collides.
describe("filterFalsePositives — cross-tool", () => {
  it("static rule with tool='knip' only matches knip issues, not sonar", () => {
    const issues = [
      { tool: "knip", rule: "unused-exports", component: "p:src/a.js", line: 1 },
      { tool: "sonar", rule: "unused-exports", component: "p:src/a.js", line: 1 },
    ];
    const { kept, suppressed } = filterFalsePositives(issues, {
      extraRules: [{ tool: "knip", rule: "unused-exports", filePattern: "src/", reason: "fixture" }],
    });
    expect(suppressed).toHaveLength(1);
    expect(suppressed[0].tool).toBe("knip");
    expect(kept).toHaveLength(1);
    expect(kept[0].tool).toBe("sonar");
  });

  it("issues without explicit tool default to 'sonar' (backwards compat)", () => {
    const issues = [{ rule: "javascript:S2699", component: "p:tests/architecture/x.test.js", line: 1 }];
    const { kept, suppressed } = filterFalsePositives(issues);
    expect(suppressed).toHaveLength(1);
    expect(kept).toHaveLength(0);
  });

  it("new inline marker `// karajan-audit-ignore: <tool>:<rule>` works", () => {
    const tmp = mkdtempSync(path.join(tmpdir(), "issue-filter-x-"));
    try {
      mkdirSync(path.join(tmp, "src"), { recursive: true });
      const rel = "src/x.js";
      writeFileSync(path.join(tmp, rel), "const a = 1; // karajan-audit-ignore: knip:unused-exports\n");
      const issues = [{ tool: "knip", rule: "unused-exports", component: `p:${rel}`, line: 1 }];
      const { kept, suppressed } = filterFalsePositives(issues, { projectRoot: tmp });
      expect(suppressed).toHaveLength(1);
      expect(kept).toHaveLength(0);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("legacy `// karajan-sonar-ignore: <rule>` still works for sonar issues only", () => {
    const tmp = mkdtempSync(path.join(tmpdir(), "issue-filter-y-"));
    try {
      mkdirSync(path.join(tmp, "src"), { recursive: true });
      const rel = "src/y.js";
      writeFileSync(path.join(tmp, rel), "const a = 1; // karajan-sonar-ignore: javascript:S1234\n");
      const sonarIssue = { tool: "sonar", rule: "javascript:S1234", component: `p:${rel}`, line: 1 };
      const knipIssue = { tool: "knip", rule: "javascript:S1234", component: `p:${rel}`, line: 1 };
      const res = filterFalsePositives([sonarIssue, knipIssue], { projectRoot: tmp });
      expect(res.suppressed).toHaveLength(1);
      expect(res.suppressed[0].tool).toBe("sonar");
      expect(res.kept).toHaveLength(1);
      expect(res.kept[0].tool).toBe("knip");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

// v2.17: the compat shim at src/sonar/issue-filter.js must re-export the same
// surface — existing imports must keep working.
describe("compat shim: src/sonar/issue-filter.js", () => {
  it("re-exports filterFalsePositives, hasInlineIgnore, DEFAULT_FALSE_POSITIVES", async () => {
    const shim = await import("../../src/sonar/issue-filter.js");
    expect(typeof shim.filterFalsePositives).toBe("function");
    expect(typeof shim.hasInlineIgnore).toBe("function");
    expect(Array.isArray(shim.DEFAULT_FALSE_POSITIVES)).toBe(true);
  });
});
