// IDN-A (KJC-TSK-0762) — compare (declarado vs efectivo → remedio literal) y
// el comando kj identity show|set. Probado en vivo el primer día: la sesión
// activa de gh la había cambiado OTRA sesión y `set --yes` ató el clon a la
// cuenta equivocada — por eso atar sin confirmar nunca es silencioso.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readIdentity } from "../../src/identity/store.js";
import { compareIdentity } from "../../src/identity/compare.js";
import { identityCommand } from "../../src/commands/identity.js";

let dir;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-identity-cmd-")); });
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const hostsYml = (user) => {
  const p = path.join(dir, `hosts-${user}.yml`);
  fs.writeFileSync(p, `github.com:\n    user: ${user}\n`);
  return p;
};

describe("compare — declarado vs efectivo, con el remedio literal", () => {
  it("ok cuando coincide; mismatch nombra ambos y el switch exacto", () => {
    const declared = { gh_user: "manufosela", git_email: "a@b.c" };
    expect(compareIdentity(declared, { gh_user: "manufosela", git_email: "a@b.c" }).ok).toBe(true);
    const r = compareIdentity(declared, { gh_user: "manufosela-tribbu", git_email: "a@b.c" });
    expect(r.ok).toBe(false);
    expect(r.mismatches).toHaveLength(1);
    expect(r.mismatches[0]).toMatchObject({ field: "gh_user", declared: "manufosela", effective: "manufosela-tribbu" });
    expect(r.mismatches[0].remedy).toBe("gh auth switch --user manufosela");
  });

  it("sin identidad declarada no es ok (remedio kj identity set); sin sesión gh se dice", () => {
    const none = compareIdentity(null, { gh_user: "x", git_email: "y" });
    expect(none.ok).toBe(false);
    expect(none.mismatches[0].remedy).toMatch(/kj identity set/);
    const noGh = compareIdentity({ gh_user: "manufosela", git_email: "a@b.c" }, { gh_user: null, git_email: "a@b.c" });
    expect(noGh.mismatches[0].effective).toBeNull();
    expect(noGh.mismatches[0].remedy).toMatch(/gh auth switch --user manufosela/);
  });
});

describe("kj identity show|set", () => {
  let lines;
  const deps = (user = "manufosela") => ({
    log: (l) => lines.push(l), isTTY: () => false,
    hostsPath: hostsYml(user), gitFn: () => "a@b.c\n",
  });
  beforeEach(() => { lines = []; });

  // KJC-TSK-0822: enroll-phone valida y confirma en llano; clave mala ⇒ exit 1.
  it("enroll-phone guarda la clave del móvil y rechaza una que no sea 32 bytes", async () => {
    const good = Buffer.alloc(32, 7).toString("base64");
    // KJC-TSK-0966: enrolar es un acto humano del catálogo; aquí las cuatro capas pasan.
    const human = { env: {}, ttyHuman: true, ancestry: { readProc: () => ({ ppid: 1, cmd: "bash" }) }, confirm: (nonce) => nonce };
    const run = (publicKeyBase64, extra = human) =>
      identityCommand({ action: "enroll-phone", config: { projectDir: dir }, flags: { publicKeyBase64 }, deps: { ...deps(), home: dir, ...extra } });
    expect(await run(good, { ...human, env: { CLAUDECODE: "1" } })).toBe(1);
    expect(lines.join("\n")).toMatch(/acto humano/);
    expect(await run("corta")).toBe(1);
    expect(lines.join("\n")).toMatch(/32 bytes/);
    expect(await run(good)).toBe(0);
    const saved = JSON.parse(fs.readFileSync(path.join(dir, ".karajan", "supervisor-phone.json"), "utf8"));
    expect(saved.publicKey).toBe(good);
    expect(lines.join("\n")).toMatch(/enrolado/i);
    // KJC-TSK-0998 (HUM-D, ADR 0018): the first phone had nobody to sign it; the next one is signed by one of the roster.
    expect(lines.join("\n")).toMatch(/sin móvil enrolado solo valen las cuatro capas/);
    let asked;
    const other = Buffer.alloc(32, 9).toString("base64");
    const phone = { enrolled: () => true, request: async (req) => { asked = req; return { ok: false, reason: "caducado" }; } };
    expect(await run(other, { ...human, phone })).toBe(1);
    expect(asked.files).toEqual([{ file: ".karajan/supervisor-signers.json", sha256: createHash("sha256").update(other).digest("hex") }]);
    expect(lines.at(-1)).toMatch(/firma del móvil rechazada \(caducado\)/);
    expect(JSON.parse(fs.readFileSync(path.join(dir, ".karajan", "supervisor-signers.json"), "utf8")).signers.map((s) => s.publicKey)).toEqual([good]);
  });

  it("set --yes ata lo efectivo AVISANDO y show lo marca ACTIVA", async () => {
    expect(await identityCommand({ action: "set", config: { projectDir: dir }, flags: { yes: true }, deps: deps() })).toBe(0);
    expect(readIdentity(dir)).toMatchObject({ gh_user: "manufosela", git_email: "a@b.c" });
    expect(lines.join("\n")).toMatch(/WARNING/);
    expect(await identityCommand({ action: "show", config: { projectDir: dir }, flags: {}, deps: deps() })).toBe(0);
    expect(lines.join("\n")).toMatch(/gh_user\s+manufosela.*ACTIVA/);
  });

  it("set con --gh/--email explícitos no avisa; show marca DISTINTA, da el switch y sale 2", async () => {
    await identityCommand({ action: "set", config: { projectDir: dir }, flags: { gh: "manufosela", email: "a@b.c", yes: true }, deps: deps() });
    expect(lines.join("\n")).not.toMatch(/WARNING/);
    const code = await identityCommand({ action: "show", config: { projectDir: dir }, flags: {}, deps: deps("manufosela-tribbu") });
    expect(code).toBe(2);
    expect(lines.join("\n")).toMatch(/DISTINTA.*manufosela-tribbu/);
    expect(lines.join("\n")).toContain("gh auth switch --user manufosela");
  });

  it("show sin identidad sale 2 pidiendo set; set sin sesión ni flags falla en alto (nunca inventa)", async () => {
    expect(await identityCommand({ action: "show", config: { projectDir: dir }, flags: {}, deps: deps() })).toBe(2);
    expect(lines.join("\n")).toMatch(/kj identity set/);
    const d = { ...deps(), hostsPath: path.join(dir, "nope.yml"), gitFn: () => { throw new Error("x"); } };
    expect(await identityCommand({ action: "set", config: { projectDir: dir }, flags: {}, deps: d })).toBe(1);
    expect(readIdentity(dir)).toBeNull();
  });
});
