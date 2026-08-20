// IDN-A (KJC-TSK-0762, épica KJC-PCS-0079 Identity lock) — cada clon declara
// con qué cuenta de gh y qué email de git se trabaja. Origen: incidente
// 2026-08-20, un gh sin switch salió como la cuenta de cliente. Aquí las dos
// piezas de base: store (fichero local sin trackear) y detect (hosts.yml de
// gh + git config, sin red, nunca inventa).

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { identityPath, readIdentity, writeIdentity } from "../../src/identity/store.js";
import { activeGhUser, effectiveGitEmail } from "../../src/identity/detect.js";

let dir;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-identity-")); });
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const hostsYml = (user) => {
  const p = path.join(dir, "hosts.yml");
  fs.writeFileSync(p, `github.com:\n    users:\n        ${user}:\n        otra:\n    user: ${user}\n    git_protocol: ssh\n`);
  return p;
};

describe("store — .karajan/identity.local.yml, por clon y sin trackear", () => {
  it("escribe, lee y añade el fichero al .gitignore (sin duplicar)", () => {
    fs.writeFileSync(path.join(dir, ".gitignore"), "node_modules\n");
    expect(readIdentity(dir)).toBeNull();
    writeIdentity(dir, { gh_user: "manufosela", git_email: "a@b.c" });
    const id = readIdentity(dir);
    expect(id).toMatchObject({ gh_user: "manufosela", git_email: "a@b.c" });
    expect(id.declared_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(identityPath(dir)).toBe(path.join(dir, ".karajan", "identity.local.yml"));
    writeIdentity(dir, { gh_user: "manufosela", git_email: "a@b.c" });
    const ignore = fs.readFileSync(path.join(dir, ".gitignore"), "utf8");
    expect(ignore.split("\n").filter((l) => l === ".karajan/identity.local.yml")).toHaveLength(1);
  });

  it("crea el .gitignore si no existe y falla en alto con una identidad incompleta", () => {
    expect(() => writeIdentity(dir, { gh_user: "x" })).toThrow(/git_email/);
    writeIdentity(dir, { gh_user: "x", git_email: "y@z" });
    expect(fs.readFileSync(path.join(dir, ".gitignore"), "utf8")).toContain(".karajan/identity.local.yml");
  });

  it("un fichero corrupto o incompleto se lee como 'sin identidad'", () => {
    fs.mkdirSync(path.join(dir, ".karajan"));
    fs.writeFileSync(identityPath(dir), "gh_user: solo-esto\n");
    expect(readIdentity(dir)).toBeNull();
    fs.writeFileSync(identityPath(dir), "gh_user: [sin cerrar\n  :: yaml roto");
    expect(readIdentity(dir)).toBeNull();
  });
});

describe("detect — sin red: hosts.yml de gh y git config", () => {
  it("lee la cuenta activa de gh del hosts.yml y null si no hay sesión", () => {
    expect(activeGhUser({ hostsPath: hostsYml("manufosela-tribbu") })).toBe("manufosela-tribbu");
    expect(activeGhUser({ hostsPath: path.join(dir, "no-existe.yml") })).toBeNull();
    fs.writeFileSync(path.join(dir, "sin-user.yml"), "github.com:\n    git_protocol: ssh\n");
    expect(activeGhUser({ hostsPath: path.join(dir, "sin-user.yml") })).toBeNull();
  });

  it("email efectivo de git vía función inyectada; null si git falla o está vacío", () => {
    expect(effectiveGitEmail(dir, { gitFn: () => " a@b.c \n" })).toBe("a@b.c");
    expect(effectiveGitEmail(dir, { gitFn: () => "\n" })).toBeNull();
    expect(effectiveGitEmail(dir, { gitFn: () => { throw new Error("no git"); } })).toBeNull();
  });
});
