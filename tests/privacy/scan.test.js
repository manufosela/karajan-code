// KJC-TSK-0704 (PV-A) — outbound privacy boundary. Findings NEVER echo the
// datum: denylist masks, generics report the redactPII-redacted line.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadPrivacyList, scanText, scanPaths } from "../../src/privacy/scan.js";

let home, dir;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "kj-priv-home-"));
  dir = mkdtempSync(join(tmpdir(), "kj-priv-dir-"));
  mkdirSync(join(home, ".karajan"), { recursive: true });
  writeFileSync(join(home, ".karajan", "privacy.yml"),
    'personal:\n  - "secreto.real@example.com"\n  - "Nombre Muyprivado"\nallow:\n  - "@manufosela"\n  - "mjfosela"\n');
});
afterEach(() => { rmSync(home, { recursive: true, force: true }); rmSync(dir, { recursive: true, force: true }); });

const list = () => loadPrivacyList({ home });

describe("privacy/scan", () => {
  it("denylist hits BLOCK and come out masked — the datum never echoes", () => {
    const f = scanText("author: secreto.real@example.com\n", { list: list(), source: "a.md" });
    const hit = f.find((x) => x.type === "denylist");
    expect(hit).toMatchObject({ severity: "block", source: "a.md", line: 1 });
    expect(JSON.stringify(f)).not.toContain("secreto.real@example.com");
  });

  it("generic PII warns with the line already redacted; allowlist keeps quiet", () => {
    const f = scanText("dni 12345678Z\nponte con @manufosela\n", { list: list() });
    expect(f.some((x) => x.severity === "warn" && x.type === "nif")).toBe(true);
    expect(f.filter((x) => x.line === 2)).toEqual([]);
    expect(JSON.stringify(f)).not.toContain("12345678Z");
  });

  it("works without privacy.yml (generics only, present:false)", () => {
    const empty = loadPrivacyList({ home: join(home, "nope") });
    expect(empty.present).toBe(false);
    const f = scanText("mail generico: alguien@dominio.com\n", { list: empty });
    expect(f.some((x) => x.type === "email" && x.severity === "warn")).toBe(true);
  });

  // KJC-TSK-0708 (PV-E) — hardcoded secrets. Fixture tokens are BUILT by
  // concatenation so this very file never trips the privacy gate.
  it("known token shapes BLOCK, masked; assignment/conn-string literals warn toward .env", () => {
    const gh = "ghp_" + "A1b2".repeat(9);
    const text = `token: ${gh}\nconst pwd = { password: "hunter2secret" }\ndb: postgres://admin:s3cr3t@db.local/x\n`;
    const f = scanText(text, { list: list() });
    const shape = f.find((x) => x.type === "github-token");
    expect(shape).toMatchObject({ severity: "block", line: 1 });
    expect(f.some((x) => x.type === "secret-assignment" && x.severity === "warn" && x.line === 2)).toBe(true);
    expect(f.some((x) => x.type === "conn-string" && x.severity === "warn" && x.line === 3)).toBe(true);
    const dump = JSON.stringify(f);
    expect(dump).not.toContain(gh);
    expect(dump).not.toContain("hunter2secret");
    expect(dump).not.toContain("s3cr3t");
  });

  it("allowlisted strings silence secret shapes too", () => {
    const fake = "AKIA" + "EXAMPLE234567890";
    writeFileSync(join(home, ".karajan", "privacy.yml"), `personal: []\nallow:\n  - "${fake}"\n`);
    expect(scanText(`key: ${fake}\n`, { list: list() })).toEqual([]);
  });

  it("scanPaths walks dirs, skips node_modules, and reports file:line", () => {
    writeFileSync(join(dir, "ok.txt"), "nada personal aqui\n");
    writeFileSync(join(dir, "leak.txt"), "linea limpia\ncontacto Nombre Muyprivado\n");
    mkdirSync(join(dir, "node_modules"), { recursive: true });
    writeFileSync(join(dir, "node_modules", "x.txt"), "secreto.real@example.com\n");
    const f = scanPaths([dir], { list: list() });
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ severity: "block", line: 2 });
    expect(f[0].source.endsWith("leak.txt")).toBe(true);
  });
});
