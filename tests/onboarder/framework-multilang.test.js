// KJC-TSK-0477 — framework detector (Django/Flask/FastAPI/Axum/Actix/Gin/Echo).
import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs/promises";
import { readFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";

import { sniffManifests } from "../../src/utils/manifest-sniff.js";
import { detectFrameworksMultiLang } from "../../src/onboarder/collectors/framework-multilang.js";
import { collectAll } from "../../src/onboarder/collectors/index.js";

async function mkProject(layout) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "fw-multilang-"));
  for (const [rel, content] of Object.entries(layout)) {
    const full = path.join(root, rel);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, content, "utf8");
  }
  return root;
}
const readRaw = (root) => (m) => readFileSync(path.join(root, m.manifest), "utf8");

describe("detectFrameworksMultiLang — KJC-TSK-0477", () => {
  let project;
  afterEach(async () => { if (project) await fs.rm(project, { recursive: true, force: true }); });

  it("Django via deps + manage.py + apps/ layout", async () => {
    project = await mkProject({
      "pyproject.toml": `[project]\nname = "x"\ndependencies = ["django"]\n`,
      "manage.py": "import django\n",
      "apps/users/__init__.py": "",
    });
    const m = await sniffManifests(project);
    const fw = detectFrameworksMultiLang(project, m, { readManifest: readRaw(project) });
    expect(fw).toHaveLength(1);
    expect(fw[0]).toMatchObject({ stack: "python" });
    expect(fw[0].frameworks.map((f) => f.name)).toContain("django");
    expect(fw[0].layout).toContain("apps");
  });

  it("FastAPI via deps only (no main.py)", async () => {
    project = await mkProject({
      "pyproject.toml": `[project]\nname = "api"\ndependencies = ["fastapi", "uvicorn"]\n`,
    });
    const m = await sniffManifests(project);
    const fw = detectFrameworksMultiLang(project, m, { readManifest: readRaw(project) });
    expect(fw[0].frameworks.map((f) => f.name)).toEqual(["fastapi"]);
  });

  it("Rust binary crate + Axum framework", async () => {
    project = await mkProject({
      "Cargo.toml": `[package]\nname = "svc"\n\n[dependencies]\naxum = "0.7"\ntokio = "1"\n`,
      "src/main.rs": "fn main() {}\n",
    });
    const m = await sniffManifests(project);
    const fw = detectFrameworksMultiLang(project, m, { readManifest: readRaw(project) });
    expect(fw[0]).toMatchObject({ stack: "rust", crateType: "binary" });
    expect(fw[0].frameworks.map((f) => f.name)).toContain("axum");
    expect(fw[0].layout).toEqual(expect.arrayContaining(["src"]));
  });

  it("Go module with cmd/ + internal/ + gin", async () => {
    project = await mkProject({
      "go.mod": `module example.com/x\n\ngo 1.21\n\nrequire github.com/gin-gonic/gin v1.9.0\n`,
      "cmd/server/main.go": "package main\n",
      "internal/svc/svc.go": "package svc\n",
    });
    const m = await sniffManifests(project);
    const fw = detectFrameworksMultiLang(project, m, { readManifest: readRaw(project) });
    expect(fw[0]).toMatchObject({ stack: "go", modulePath: "example.com/x" });
    expect(fw[0].frameworks.map((f) => f.name)).toEqual(["gin"]);
    expect(fw[0].layout.sort()).toEqual(["cmd", "internal"]);
  });

  it("Node stacks are skipped (covered by detectProjectStack)", () => {
    const fw = detectFrameworksMultiLang("/tmp", [{ stack: "node", deps: 1, devDeps: 0 }]);
    expect(fw).toEqual([]);
  });
});

describe("collectAll — KJC-TSK-0477 multi-stack fields", () => {
  let project;
  afterEach(async () => { if (project) await fs.rm(project, { recursive: true, force: true }); });

  it("emits manifests[] + frameworksMultiLang[] on a Python repo", async () => {
    project = await mkProject({
      "pyproject.toml": `[project]\nname = "py"\ndependencies = ["flask"]\n`,
      "app.py": "from flask import Flask\n",
    });
    const bundle = await collectAll(project);
    expect(bundle.manifests.map((m) => m.stack)).toEqual(["python"]);
    expect(bundle.frameworksMultiLang[0].frameworks.map((f) => f.name)).toContain("flask");
  });
});
