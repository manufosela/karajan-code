// KJC-TSK-0345 slice 0.1 — semantic auditor smoke tests with synthetic fixtures.
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { auditTestDiet, parseImports, extractExports, renderMarkdown } from "../../scripts/audit-test-diet.mjs";

let root;
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "kj-audit-diet-"));
  await fs.mkdir(path.join(root, "src"), { recursive: true });
  await fs.mkdir(path.join(root, "tests"), { recursive: true });
});
afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });

async function write(rel, content) {
  const p = path.join(root, rel);
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, content, "utf-8");
}

describe("auditTestDiet — semantic categories", () => {
  it("parses imports/exports correctly (helpers)", () => {
    expect(parseImports(`import { a, b as bb } from "./x.js";\n`)[0].named).toEqual(["a", "b"]);
    expect(extractExports(`export function a(){}\nexport const b=1;\nexport default c;\n`)).toEqual(new Set(["a", "b", "default"]));
  });

  it("flags empty-no-expect, skipped-pending, imports-orphan and renders markdown", async () => {
    await write("tests/empty.test.js", `import { it } from "vitest";\nit("noop", () => { const x = 1; });\n`);
    await write("tests/skipped.test.js", `import { it, expect } from "vitest";\nit.skip("parked", () => { expect(1).toBe(1); });\n`);
    await write("tests/orphan.test.js", `import { gone } from "../src/gone.js";\nimport { it, expect } from "vitest";\nit("g", () => { expect(gone()).toBe(1); });\n`);
    const report = auditTestDiet(root);
    const cats = new Set(report.findings.map((f) => f.category));
    expect(cats.has("empty-no-expect")).toBe(true);
    expect(cats.has("skipped-pending")).toBe(true);
    const orphan = report.findings.find((f) => f.category === "imports-orphan");
    expect(orphan.detail).toMatch(/gone\.js/);
    expect(renderMarkdown(report)).toMatch(/## empty-no-expect/);
  });

  it("flags deprecated-export when a named import is no longer exported", async () => {
    await write("src/mod.js", `export function alive() { return 1; }\n`);
    await write("tests/dep.test.js", `import { alive, removed } from "../src/mod.js";\nimport { it, expect } from "vitest";\nit("x", () => { expect(alive()).toBe(1); expect(removed).toBeUndefined(); });\n`);
    const dep = auditTestDiet(root).findings.find((f) => f.category === "deprecated-export");
    expect(dep.detail).toMatch(/removed/);
    expect(dep.confidence).toBe("low");
  });

  it("flags subsumed-candidate only when it() names actually overlap", async () => {
    await write("src/big.js", `export const a = 1;\nexport const b = 2;\nexport const c = 3;\n`);
    // Real subsumption: narrow's it() names are a subset of broad's.
    await write("tests/narrow.test.js", `import { a } from "../src/big.js";\nimport { it, expect } from "vitest";\nit("a is 1", () => { expect(a).toBe(1); });\n`);
    await write("tests/broad.test.js", `import { a, b, c } from "../src/big.js";\nimport { it, expect } from "vitest";\nit("a is 1", () => { expect(a).toBe(1); });\nit("b is 2", () => { expect(b).toBe(2); });\nit("sum", () => { expect(a+b+c).toBe(6); });\n`);
    // Same imports, disjoint it() names → must NOT be flagged.
    await write("src/dual.js", `export const x = 1;\nexport const y = 2;\n`);
    await write("tests/dual-tracker.test.js", `import { x } from "../src/dual.js";\nimport { it, expect } from "vitest";\nit("tracker records", () => { expect(x).toBe(1); });\n`);
    await write("tests/dual-helpers.test.js", `import { x, y } from "../src/dual.js";\nimport { it, expect } from "vitest";\nit("helper does math", () => { expect(x+y).toBe(3); });\n`);
    const findings = auditTestDiet(root).findings.filter((f) => f.category === "subsumed-candidate");
    expect(findings.find((f) => f.path.endsWith("narrow.test.js"))).toBeTruthy();
    expect(findings.find((f) => f.path.endsWith("dual-tracker.test.js"))).toBeUndefined();
  });
});
