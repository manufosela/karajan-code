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
    expect(scanText(`key: ${fake}\n`, { list: list() })).toHaveLength(0);
  });

  // KJC-TSK-0797 (epic KJC-PCS-0082) — context before generics. Measured twice:
  // GREBLA's pinned Actions flagged as phone numbers, and this repo's own
  // workflow pinning flagged twelve times. A detector that cries wolf teaches
  // people to ignore the day a real phone ships.
  it("a pinned-action git SHA is not a phone number — discarded by context, and counted", () => {
    const f = scanText("      - uses: actions/setup-node@a0853c24544627f65ddf259abe73b1d18a591444 # v4\n", { list: list() });
    expect(f).toHaveLength(0);
    expect(f.discardedByContext).toBe(1);
  });

  it("a 64-hex digest is context too", () => {
    const f = scanText(`sha256: ${"ab12".repeat(16)}\n`, { list: list() });
    expect(f).toHaveLength(0);
    expect(f.discardedByContext).toBe(1);
  });

  it("documentation-domain emails (RFC 2606) are fixtures, not people", () => {
    const f = scanText("a: user@example.com\nb: dev@mail.example.org\nc: qa@foo.test\n", { list: list() });
    expect(f).toHaveLength(0);
    expect(f.discardedByContext).toBe(3);
  });

  it("a REAL email still warns — the discard opens no false negative", () => {
    const f = scanText("contacto: persona.real@gmail.com\n", { list: list() });
    expect(f.some((x) => x.type === "email" && x.severity === "warn")).toBe(true);
  });

  it("the personal denylist runs BEFORE context: the user's datum blocks even when it looks like a fixture", () => {
    const f = scanText("author: secreto.real@example.com\n", { list: list() });
    expect(f.some((x) => x.type === "denylist" && x.severity === "block")).toBe(true);
  });

  it("scanPaths carries the discarded-by-context count across files", () => {
    writeFileSync(join(dir, "wf.yml"), "uses: actions/checkout@08c6903cd8c0fde910a37f88322edcfb5dd907a8 # v5\n");
    writeFileSync(join(dir, "fx.js"), "const email = 'admin@example.org';\n");
    const f = scanPaths([dir], { list: list() });
    expect(f).toHaveLength(0);
    expect(f.discardedByContext).toBe(2);
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
