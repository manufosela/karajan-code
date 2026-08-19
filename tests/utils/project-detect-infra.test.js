// INF-B (KJC-TSK-0759, épica KJC-PCS-0078) — un proyecto de infra tiene
// suite propia: terraform validate, helm lint, kustomize build, ansible-lint.
// Solo marcadores INEQUÍVOCOS (un yaml suelto NO es infra) y siempre DESPUÉS
// de los frameworks de aplicación (un repo mixto conserva su framework).

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { detectTestFramework, TEST_PATTERNS_BY_LANGUAGE } from "../../src/utils/project-detect.js";

let dir;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-infra-detect-")); });
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("detectTestFramework — markers de infra", () => {
  it("raiz con *.tf → terraform-validate (language infra)", async () => {
    fs.writeFileSync(path.join(dir, "main.tf"), "resource {}\n");
    expect(await detectTestFramework(dir)).toEqual({ hasTests: true, framework: "terraform-validate", language: "infra" });
  });

  it("directorio terraform/ tambien cuenta", async () => {
    fs.mkdirSync(path.join(dir, "terraform"));
    fs.writeFileSync(path.join(dir, "terraform", "main.tf"), "resource {}\n");
    expect((await detectTestFramework(dir)).framework).toBe("terraform-validate");
  });

  it("Chart.yaml → helm-lint; kustomization.yaml → kustomize-build; ansible.cfg → ansible-lint", async () => {
    fs.writeFileSync(path.join(dir, "Chart.yaml"), "name: x\n");
    expect((await detectTestFramework(dir)).framework).toBe("helm-lint");
    fs.rmSync(path.join(dir, "Chart.yaml"));
    fs.writeFileSync(path.join(dir, "kustomization.yaml"), "resources: []\n");
    expect((await detectTestFramework(dir)).framework).toBe("kustomize-build");
    fs.rmSync(path.join(dir, "kustomization.yaml"));
    fs.writeFileSync(path.join(dir, "ansible.cfg"), "[defaults]\n");
    expect((await detectTestFramework(dir)).framework).toBe("ansible-lint");
  });

  it("un yaml suelto NO clasifica como infra", async () => {
    fs.writeFileSync(path.join(dir, "config.yaml"), "a: 1\n");
    expect((await detectTestFramework(dir)).hasTests).toBe(false);
  });

  it("repo mixto: el framework de aplicación mantiene la precedencia", async () => {
    fs.writeFileSync(path.join(dir, "main.tf"), "resource {}\n");
    fs.writeFileSync(path.join(dir, "go.mod"), "module x\n");
    expect((await detectTestFramework(dir)).framework).toBe("go-test");
  });

  it("infra tiene patterns de test declarados (TDD policy)", () => {
    expect(TEST_PATTERNS_BY_LANGUAGE.infra).toBeDefined();
    expect(TEST_PATTERNS_BY_LANGUAGE.infra.length).toBeGreaterThan(0);
  });
});

describe("tester brief con proyecto de infra", () => {
  it("ordena la suite de infra y el fail-loud de tools ausentes (nunca verde vacío)", async () => {
    fs.writeFileSync(path.join(dir, "main.tf"), "resource {}\n");
    const { TesterRole } = await import("../../src/roles/tester-role.js");
    const role = new TesterRole({ config: { projectDir: dir, roles: {} }, logger: { warn: () => {} } });
    const { prompt } = await role.buildPrompt({
      task: "t", diff: null, sonarIssues: null, pendingGherkinTests: null, shellTestResults: null,
    });
    expect(prompt).toContain("terraform-validate (infra)");
    expect(prompt).toContain("terraform validate");
    expect(prompt).toContain("checkov");
    expect(prompt).toContain("MISSING");
    expect(prompt).not.toContain("npm install");
  });
});
