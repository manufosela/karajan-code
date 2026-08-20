// IDN-A (KJC-TSK-0762) — captura al arrancar: solo con humano confirmando en
// TTY; en headless NUNCA se ata a ciegas (el primer set --yes real ató el
// clon a la cuenta que otra sesión había dejado activa) — se declara pendiente
// con el comando exacto.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ensureIdentity } from "../../src/identity/bootstrap.js";
import { readIdentity, writeIdentity } from "../../src/identity/store.js";

let dir;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-identity-boot-")); });
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const hosts = (user) => {
  const p = path.join(dir, "hosts.yml");
  fs.writeFileSync(p, `github.com:\n    user: ${user}\n`);
  return p;
};
const logger = () => ({ warn: vi.fn(), info: vi.fn() });

describe("ensureIdentity", () => {
  it("ya declarada → no toca nada", async () => {
    writeIdentity(dir, { gh_user: "manufosela", git_email: "a@b.c" });
    const r = await ensureIdentity({ projectDir: dir, logger: logger(), deps: { isTTY: () => true } });
    expect(r.declared).toBe(true);
    expect(r.identity.gh_user).toBe("manufosela");
  });

  it("headless: NO ata a ciegas — pendiente con el comando exacto", async () => {
    const log = logger();
    const r = await ensureIdentity({ projectDir: dir, logger: log, deps: { isTTY: () => false, hostsPath: hosts("manufosela-tribbu"), gitFn: () => "a@b.c" } });
    expect(r.declared).toBe(false);
    expect(r.pending).toContain("kj identity set --gh manufosela-tribbu --email a@b.c");
    expect(readIdentity(dir)).toBeNull();
    expect(log.warn).toHaveBeenCalled();
  });

  it("TTY con confirmación → declara; TTY rechazando → pendiente", async () => {
    const wiz = (answer) => () => ({ confirm: async () => answer, close: () => {} });
    const yes = await ensureIdentity({ projectDir: dir, logger: logger(), deps: { isTTY: () => true, hostsPath: hosts("manufosela"), gitFn: () => "a@b.c", makeWizard: wiz(true) } });
    expect(yes.declared).toBe(true);
    expect(readIdentity(dir)).toMatchObject({ gh_user: "manufosela", git_email: "a@b.c" });
    fs.rmSync(path.join(dir, ".karajan"), { recursive: true, force: true });
    const no = await ensureIdentity({ projectDir: dir, logger: logger(), deps: { isTTY: () => true, hostsPath: hosts("manufosela"), gitFn: () => "a@b.c", makeWizard: wiz(false) } });
    expect(no.declared).toBe(false);
    expect(no.pending).toMatch(/declined/);
  });

  it("sin sesión gh: pendiente aunque haya TTY (nunca inventa)", async () => {
    const r = await ensureIdentity({ projectDir: dir, logger: logger(), deps: { isTTY: () => true, hostsPath: path.join(dir, "none.yml"), gitFn: () => "a@b.c" } });
    expect(r.declared).toBe(false);
    expect(r.pending).toMatch(/no active gh session/);
  });
});
