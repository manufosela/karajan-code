// KJC-TSK-0476 — measureBasalCost ahora cuenta deps de todos los stacks
// detectados y devuelve `stack` con el summary.
import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

import { measureBasalCost } from "../../src/audit/basal-cost.js";

async function mkProject(layout) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "basal-multilang-"));
  for (const [rel, content] of Object.entries(layout)) {
    const full = path.join(root, rel);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, content, "utf8");
  }
  return root;
}

describe("measureBasalCost — multi-stack", () => {
  let project;
  afterEach(async () => { if (project) await fs.rm(project, { recursive: true, force: true }); });

  it("reports stack=python and counts pyproject deps in a Python-only repo", async () => {
    project = await mkProject({
      "pyproject.toml": `[project]\nname = "py"\ndependencies = ["requests", "click"]\n`,
      "src/main.py": "def main(): pass\n",
    });
    const r = await measureBasalCost(project);
    expect(r.stack.primary).toBe("python");
    expect(r.stack.multi).toBe(false);
    expect(r.dependencies.total).toBe(2);
    // depcheck no debe ejecutarse sin package.json.
    expect(r.unusedDependencies.note).toMatch(/skipped/);
  });

  it("sums deps across stacks in a mixed Node + Python repo", async () => {
    project = await mkProject({
      "package.json": JSON.stringify({ name: "front", dependencies: { react: "18" }, devDependencies: { vitest: "1" } }),
      "pyproject.toml": `[project]\nname = "back"\ndependencies = ["fastapi"]\n`,
    });
    const r = await measureBasalCost(project);
    expect(r.stack.multi).toBe(true);
    expect(r.stack.manifests.map((m) => m.stack).sort()).toEqual(["node", "python"]);
    expect(r.dependencies.total).toBe(3); // 1 + 1 + 1
  });
});
