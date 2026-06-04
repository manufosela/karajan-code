// KJC-TSK-0348 — Tests for kj sync --apply (apply-canvas-patch module).
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyCanvasPatch, renderDriftComment } from "../../src/sync/apply-canvas-patch.js";

const BASE_CANVAS = `# Test Spec\n\n## REASONS:Requirements\nDo a thing.\n\n## REASONS:Approach\nDo it well.\n\n## REASONS:Structure\n- touches: src/foo.js\n\n## REASONS:Operations\n1. Add foo\n   Acceptance:\n   - shell: node -e "1"\n`;

let tmpDir;
beforeEach(async () => { tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "kj-sync-apply-")); });
afterEach(async () => { await fs.rm(tmpDir, { recursive: true, force: true }); });

async function seedCanvas() {
  const p = path.join(tmpDir, "SPEC.canvas.md");
  await fs.writeFile(p, BASE_CANVAS, "utf-8");
  return p;
}

describe("renderDriftComment", () => {
  it("counts untracked + missing as mutations and ignores covered for the counter", () => {
    const { block, mutations } = renderDriftComment({
      untracked: [{ path: "src/new.js" }],
      missing: [{ path: "src/gone.js", operationIndex: 0 }],
      covered: [{ path: "src/foo.js", operationIndex: 0 }],
    });
    expect(mutations).toBe(2);
    expect(block).toMatch(/<!-- \+ src\/new\.js -->/);
    expect(block).toMatch(/<!-- ! src\/gone\.js {2}\[op #1\] -->/);
    expect(block).toMatch(/<!-- ~ src\/foo\.js/);
    expect(block.startsWith("\n<!-- kj sync --apply")).toBe(true);
    expect(block.endsWith("<!-- /kj sync -->\n")).toBe(true);
  });
});

describe("applyCanvasPatch", () => {
  it("writes a .bak backup with the ORIGINAL content and patches the Canvas atomically", async () => {
    const canvasPath = await seedCanvas();
    const out = await applyCanvasPatch({
      canvasPath,
      report: { untracked: [{ path: "src/new.js" }], missing: [], covered: [], clean: [] },
    });
    expect(out.mutations).toBe(1);
    expect(out.backupPath).toBe(`${canvasPath}.bak`);
    expect(await fs.readFile(out.backupPath, "utf-8")).toBe(BASE_CANVAS);
    const patched = await fs.readFile(canvasPath, "utf-8");
    expect(patched.startsWith(BASE_CANVAS.replace(/\n+$/, "\n"))).toBe(true);
    expect(patched).toMatch(/<!-- \+ src\/new\.js -->/);
    expect(patched).toMatch(/<!-- \/kj sync -->/);
  });

  it("is a no-op when there's no actionable drift (no .bak, Canvas untouched)", async () => {
    const canvasPath = await seedCanvas();
    const out = await applyCanvasPatch({
      canvasPath, report: { untracked: [], missing: [], covered: [], clean: [] },
    });
    expect(out.skipped).toBe(true);
    expect(out.mutations).toBe(0);
    expect(out.backupPath).toBeNull();
    expect(await fs.readFile(canvasPath, "utf-8")).toBe(BASE_CANVAS);
    await expect(fs.access(`${canvasPath}.bak`)).rejects.toThrow();
  });

  it("rejects missing canvasPath / report and surfaces read errors clearly", async () => {
    await expect(applyCanvasPatch({})).rejects.toThrow(/canvasPath is required/);
    await expect(applyCanvasPatch({ canvasPath: "x" })).rejects.toThrow(/report is required/);
    await expect(applyCanvasPatch({
      canvasPath: path.join(tmpDir, "missing.canvas.md"),
      report: { untracked: [{ path: "x" }], missing: [], covered: [] },
    })).rejects.toThrow(/cannot read canvas/);
  });
});
