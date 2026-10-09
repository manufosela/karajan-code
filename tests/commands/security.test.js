// KJC-TSK-0995 (HUM-D, ADR 0018): kj security show|normal|max.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { securityCommand } from "../../src/commands/security.js";
import { SECURITY_LEVEL_FILE } from "../../src/harden/security-level.js";
import { setNormalLevel } from "../_fixtures/set-normal-level.js";

let repo, home, lines;
beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "kj-seccmd-"));
  home = mkdtempSync(join(tmpdir(), "kj-seccmd-home-"));
  mkdirSync(join(repo, ".karajan"));
  lines = [];
});
afterEach(() => { for (const dir of [repo, home]) rmSync(dir, { recursive: true, force: true }); });

const run = (action, deps = {}) => securityCommand({ action, config: { projectDir: repo }, kjVersion: "9.9.9", deps: { home, ...deps }, log: (l) => lines.push(l) });

describe("kj security", () => {
  it("show: the level, where it comes from and the phone; exit 2 on a record that cannot be trusted", async () => {
    expect(await run("show")).toBe(0);
    expect(lines.join("\n")).toMatch(/nivel {3}máxima.*\norigen {2}por defecto.*\nmóvil {3}no enrolado \(kj identity enroll-phone/);
    writeFileSync(join(repo, SECURITY_LEVEL_FILE), JSON.stringify({ level: "normal", since: "2026-10-09" }));
    lines = [];
    expect(await run("show")).toBe(2);
    expect(lines.join("\n")).toMatch(/nivel {3}máxima.*\norigen {2}REGISTRO NO FIABLE: .*no lleva firma/);
  });

  it("max: free, says it is registered and to commit it; then show reads the file", async () => {
    setNormalLevel(repo); // KJC-TSK-0997: max is the default, so the raise starts from normal
    expect(await run("max")).toBe(0);
    expect(lines[0]).toMatch(/nivel máxima registrado en \.karajan\/security-level\.json \(commítealo/);
    expect(await run("max")).toBe(0);
    expect(lines[1]).toMatch(/ya es máxima/);
    lines = [];
    await run("show");
    expect(lines[1]).toMatch(/^origen {2}registrado en \.karajan\/security-level\.json desde 20/);
  });

  it("normal: the catalog act; refused without a phone, with the way to enroll, and exit 1", async () => {
    await run("max");
    lines = [];
    const deps = { env: {}, ttyHuman: true, ancestry: { readProc: () => ({ ppid: 1, cmd: "bash" }) }, phone: { enrolled: () => false } };
    expect(await run("normal", deps)).toBe(1);
    expect(lines[0]).toMatch(/^kj security normal: kj security normal: bajar el nivel se firma con el móvil y no hay ninguno enrolado.*kj identity enroll-phone/);
    expect(await run("normal", { env: { CLAUDECODE: "1" } })).toBe(1);
    expect(lines[1]).toMatch(/es un acto humano/);
  });
});
