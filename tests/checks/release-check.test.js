// KJC-TSK-0712 — memory is the reminder; the check is the guarantee.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { runReleaseCheck } from "../../src/checks/release-check.js";

let dir;
const git = (...args) => execFileSync("git", ["-C", dir, ...args]);
const write = (rel, text) => fs.writeFileSync(path.join(dir, rel), text);
const byName = (res, name) => res.checks.find((c) => c.name === name);

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-relcheck-"));
  git("init", "-q", "-b", "main");
  git("config", "user.email", "t@t"); git("config", "user.name", "t");
  write("package.json", JSON.stringify({ name: "demo", version: "1.2.0", private: true }));
  write("CHANGELOG.md", "# Changelog\n\n## [Unreleased]\n\n## [1.2.0] - 2026-08-03\n\n- stuff\n\n## [1.1.0] - 2026-08-01\n");
  write("a.txt", "x"); git("add", "-A"); git("commit", "-qm", "base");
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("runReleaseCheck — generics", () => {
  it("passes when manifest, top CHANGELOG section and tags agree", async () => {
    const res = await runReleaseCheck({ projectDir: dir, config: {} });
    expect(res.ok).toBe(true);
    expect(byName(res, "changelog-current").ok).toBe(true);
  });

  it("fails RED when the CHANGELOG top section is not the manifest version", async () => {
    write("package.json", JSON.stringify({ name: "demo", version: "1.3.0", private: true }));
    const res = await runReleaseCheck({ projectDir: dir, config: {} });
    expect(res.ok).toBe(false);
    const c = byName(res, "changelog-current");
    expect(c.ok).toBe(false);
    expect(c.detail).toContain("1.3.0");
  });

  it("fails when [Unreleased] still carries unpromoted content", async () => {
    write("CHANGELOG.md", "# Changelog\n\n## [Unreleased]\n\n### Added\n\n- forgotten entry\n\n## [1.2.0] - 2026-08-03\n\n- stuff\n");
    const res = await runReleaseCheck({ projectDir: dir, config: {} });
    expect(byName(res, "changelog-current").ok).toBe(false);
    expect(byName(res, "changelog-current").detail).toMatch(/Unreleased/);
  });

  it("fails when a tag AHEAD of the manifest exists; same-version tag is only info", async () => {
    git("tag", "v1.2.0");
    expect((await runReleaseCheck({ projectDir: dir, config: {} })).ok).toBe(true);
    git("tag", "v1.4.0");
    const res = await runReleaseCheck({ projectDir: dir, config: {} });
    expect(res.ok).toBe(false);
    expect(byName(res, "tags").detail).toContain("1.4.0");
  });
});

describe("runReleaseCheck — declared items", () => {
  it("file_contains interpolates {version}; command passes on exit 0 and fails otherwise", async () => {
    write("footer.html", "<span>v1.2.0</span>");
    const config = { release_check: { items: [
      { name: "footer shows version", file_contains: { path: "footer.html", pattern: "v{version}" } },
      { name: "always ok", command: "true" },
      { name: "always fails", command: "false" },
      { name: "ghost", file_contains: { path: "nope.txt", pattern: "x" } }, // missing file = red, not crash
    ] } };
    const res = await runReleaseCheck({ projectDir: dir, config });
    expect(byName(res, "footer shows version").ok).toBe(true);
    expect(byName(res, "always ok").ok).toBe(true);
    expect(byName(res, "always fails").ok).toBe(false);
    expect(byName(res, "ghost").ok).toBe(false);
    expect(res.ok).toBe(false);
  });
});

// KJC-BUG-0204 — un check en rojo no puede bloquear el comando que lo repara.
describe("runReleaseCheck — remedios (KJC-BUG-0204)", () => {
  const landing = (extra = {}) => ({ release_check: { items: [
    { name: "landing desplegada", command: "false", remedied_by: "firebase deploy", ...extra },
  ] } });

  it("lifts the red check whose remedy IS the command, and says which", async () => {
    const res = await runReleaseCheck({ projectDir: dir, config: landing(), forCommand: "firebase --account a@b --project p deploy --only hosting:main" });
    expect(res.ok).toBe(true);
    expect(res.lifted).toEqual(["landing desplegada"]);
    expect(byName(res, "landing desplegada").ok).toBe(false); // el hecho no se falsea: sigue en rojo
  });

  it("keeps blocking when a red check is NOT remedied by the command", async () => {
    const config = landing();
    config.release_check.items.push({ name: "otra cosa", command: "false" });
    const res = await runReleaseCheck({ projectDir: dir, config, forCommand: "firebase deploy --only hosting" });
    expect(res.ok).toBe(false);
    expect(res.lifted).toEqual(["landing desplegada"]);
  });

  it("never lifts for a package publication, whatever the item declares", async () => {
    const res = await runReleaseCheck({ projectDir: dir, config: landing({ remedied_by: "npm publish" }), forCommand: "npm publish --otp=123456" });
    expect(res.ok).toBe(false);
    expect(res.lifted).toEqual([]);
  });

  it("detects a publication with flags in the middle, and separators do not hide one", async () => {
    // Catch de la review: la deteccion de publicacion era por adyacencia
    // mientras el remedio toleraba flags, asi que publicar podia quedar exento.
    for (const cmd of ["npm --registry https://r.example publish", "gh --repo o/r release create v1", "(npm publish)", "npm publish;", "/usr/bin/npm publish", "./node_modules/.bin/gh release create v1"]) {
      const res = await runReleaseCheck({ projectDir: dir, config: landing({ remedied_by: "npm publish" }), forCommand: cmd });
      expect(res.lifted, cmd).toEqual([]);
      expect(res.ok, cmd).toBe(false);
    }
  });

  it("keeps the remedy when the item could not even run", async () => {
    // Catch de la review: en la rama de error el remedio se perdia, asi que el
    // comando que lo repara quedaba bloqueado justo cuando nada se comprobo.
    const explodes = { toString() { throw new Error("boom"); } };
    const config = { release_check: { items: [{ name: "landing", command: explodes, remedied_by: "firebase deploy" }] } };
    const res = await runReleaseCheck({ projectDir: dir, config, forCommand: "firebase deploy --only hosting" });
    expect(byName(res, "landing").detail).toMatch(/boom/);
    expect(res.lifted).toEqual(["landing"]);
    expect(res.ok).toBe(true);
  });

  it("a remedy lifts its OWN item, never another red item that shares its name", async () => {
    // Catch de la review: el levantamiento viajaba por nombre.
    const config = { release_check: { items: [
      { name: "landing", command: "false", remedied_by: "firebase deploy" },
      { name: "landing", command: "false" },
    ] } };
    const res = await runReleaseCheck({ projectDir: dir, config, forCommand: "firebase deploy --only hosting" });
    expect(res.ok).toBe(false);
    expect(res.checks.filter((c) => c.name === "landing").map((c) => c.lifted === true)).toEqual([true, false]);
  });

  it("requires the remedy tokens in order, and ignores an item without remedied_by", async () => {
    const plain = { release_check: { items: [{ name: "landing desplegada", command: "false" }] } };
    expect((await runReleaseCheck({ projectDir: dir, config: plain, forCommand: "firebase deploy" })).ok).toBe(false);
    // "deploy firebase" no es "firebase deploy": el orden es parte del remedio.
    expect((await runReleaseCheck({ projectDir: dir, config: landing(), forCommand: "deploy firebase now" })).ok).toBe(false);
    // Sin forCommand el comportamiento es el de siempre.
    const res = await runReleaseCheck({ projectDir: dir, config: landing() });
    expect(res.ok).toBe(false);
    expect(res.lifted).toBeUndefined();
  });

  it("does not lift a GENERIC check: a remedy only covers what its item declares", async () => {
    write("package.json", JSON.stringify({ name: "demo", version: "9.9.9", private: true }));
    const res = await runReleaseCheck({ projectDir: dir, config: landing(), forCommand: "firebase deploy" });
    expect(res.ok).toBe(false); // changelog-current en rojo y nadie lo repara
    expect(res.lifted).toEqual(["landing desplegada"]);
  });
});
