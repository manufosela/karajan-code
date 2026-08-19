// KJC-BUG-0141 (campo: Pedro) — kj start decía "new, no source code found"
// con el código en backend/app/… (maxDepth=2 del tree lo hacía invisible) y
// con proyectos de infra (yaml/tf/sh/Dockerfile no contaban como código).

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { deepSourceScan, runReadOnlySweep } from "../../src/start/sweep.js";

describe("deepSourceScan", () => {
  let dir;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-scan-")); });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("ve el código anidado a profundidad backend/app/… (el caso de Pedro)", async () => {
    fs.mkdirSync(path.join(dir, "backend", "app", "api"), { recursive: true });
    fs.writeFileSync(path.join(dir, "backend", "app", "api", "main.py"), "print(1)\n");
    fs.writeFileSync(path.join(dir, "backend", "app", "api", "main.test.py"), "test\n");
    const scan = await deepSourceScan(dir);
    expect(scan.code).toBe(1); // el test no cuenta como fuente
  });

  it("cuenta la infra como fuente: yaml, tf, sh y Dockerfile", async () => {
    fs.mkdirSync(path.join(dir, "manifests"), { recursive: true });
    fs.writeFileSync(path.join(dir, "manifests", "deploy.yaml"), "kind: Deployment\n");
    fs.writeFileSync(path.join(dir, "main.tf"), "resource {}\n");
    fs.writeFileSync(path.join(dir, "up.sh"), "#!/bin/sh\n");
    fs.writeFileSync(path.join(dir, "Dockerfile"), "FROM scratch\n");
    const scan = await deepSourceScan(dir);
    expect(scan.code).toBe(0);
    expect(scan.infra).toBe(4);
  });

  it("ignora node_modules y ocultos", async () => {
    fs.mkdirSync(path.join(dir, "node_modules", "x"), { recursive: true });
    fs.writeFileSync(path.join(dir, "node_modules", "x", "i.js"), "x\n");
    const scan = await deepSourceScan(dir);
    expect(scan.code + scan.infra).toBe(0);
  });
});

describe("sweep con el escáner inyectado (KJC-BUG-0141)", () => {
  const base = {
    collectAll: async () => ({ stack: { language: null }, tree: [], git: { commitCount: 20 }, configs: { present: [] } }),
    detectTestFramework: async () => ({ hasTests: false }),
    checkHarden: async () => null, compareHarden: () => null,
    detectQmd: async () => null, ragStatus: () => null, gitAgeDays: () => 3,
  };

  it("un proyecto de infra puro deja de ser 'new — no source code found'", async () => {
    const b = await runReadOnlySweep("/x", { deps: { ...base, sourceScan: async () => ({ code: 0, infra: 12 }) } });
    expect(b.signals.hasSourceCode).toBe(true);
    expect(b.maturity.maturity).not.toBe("new");
  });

  it("código anidado invisible para el tree superficial cuenta igual", async () => {
    const b = await runReadOnlySweep("/x", { deps: { ...base, sourceScan: async () => ({ code: 7, infra: 0 }) } });
    expect(b.signals.hasSourceCode).toBe(true);
  });

  it("si el escáner falla, el conteo del tree sigue siendo el fallback (fail-soft)", async () => {
    const b = await runReadOnlySweep("/x", { deps: { ...base, sourceScan: async () => { throw new Error("io"); } } });
    expect(b.signals.hasSourceCode).toBe(false); // tree vacío, sin crash
  });
});
