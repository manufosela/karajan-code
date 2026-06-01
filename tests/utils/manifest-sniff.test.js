// KJC-TSK-0476 — sniff de manifests por stack, sin libs externas.
import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

import { sniffManifests, summariseStack } from "../../src/utils/manifest-sniff.js";

async function mkProject(layout) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sniff-"));
  for (const [rel, content] of Object.entries(layout)) {
    const full = path.join(root, rel);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, content, "utf8");
  }
  return root;
}

describe("sniffManifests — KJC-TSK-0476", () => {
  let project;
  afterEach(async () => { if (project) await fs.rm(project, { recursive: true, force: true }); });

  it("counts Node deps + devDeps from package.json", async () => {
    project = await mkProject({
      "package.json": JSON.stringify({ name: "x", dependencies: { a: "1", b: "2" }, devDependencies: { c: "3" } }),
    });
    expect((await sniffManifests(project))[0]).toMatchObject({ stack: "node", name: "x", deps: 2, devDeps: 1 });
  });

  it("counts Python deps from pyproject.toml [project] dependencies", async () => {
    project = await mkProject({ "pyproject.toml": `[project]\nname = "demo"\ndependencies = ["requests>=2", "click", "rich"]\n` });
    expect((await sniffManifests(project))[0]).toMatchObject({ stack: "python", manifest: "pyproject.toml", name: "demo", deps: 3 });
  });

  it("falls back to requirements.txt when no pyproject", async () => {
    project = await mkProject({ "requirements.txt": "# comment\nrequests==2.0\nclick\n\nrich # inline note\n" });
    expect((await sniffManifests(project))[0]).toMatchObject({ stack: "python", manifest: "requirements.txt", deps: 3 });
  });

  it("counts Rust deps and dev-deps from Cargo.toml", async () => {
    project = await mkProject({
      "Cargo.toml": `[package]\nname = "demo"\n\n[dependencies]\nserde = "1"\ntokio = "1"\n\n[dev-dependencies]\nassert_cmd = "2"\n`,
    });
    expect((await sniffManifests(project))[0]).toMatchObject({ stack: "rust", name: "demo", deps: 2, devDeps: 1 });
  });

  it("counts Go requires (both block and single-line forms)", async () => {
    project = await mkProject({
      "go.mod": `module example.com/x\n\ngo 1.21\n\nrequire (\n  github.com/foo v1.0.0\n  github.com/bar v2.0.0\n)\n\nrequire example.com/baz v0.1.0\n`,
    });
    expect((await sniffManifests(project))[0]).toMatchObject({ stack: "go", name: "example.com/x", deps: 3 });
  });

  it("detects multi-stack repos; summariseStack picks primary by deps count", async () => {
    project = await mkProject({
      "package.json": JSON.stringify({ name: "front", dependencies: { react: "18" } }),
      "pyproject.toml": `[project]\nname = "back"\ndependencies = ["fastapi", "uvicorn"]\n`,
    });
    const sniffed = await sniffManifests(project);
    expect(sniffed.map((m) => m.stack).sort()).toEqual(["node", "python"]);
    expect(summariseStack(sniffed)).toMatchObject({ primary: "python", multi: true });
    expect(summariseStack([])).toEqual({ primary: null, multi: false, manifests: [] });
  });
});
