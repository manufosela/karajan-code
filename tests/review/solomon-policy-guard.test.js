// KJC-TSK-0734 PL-B — solomon y la policy: un hallazgo de clase seguridad
// no es arbitrable (misma doctrina que los findings de seguridad del
// reviewer), y una policy invalida cierra el arbitraje en vez de abrirlo
// (catch de codex en la parte 2b: sec vacio NO puede significar "adelante").

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const solomonMock = vi.fn();
vi.mock("../../src/review/solomon-arbitration.js", () => ({ runSolomonArbitration: (...a) => solomonMock(...a) }));

import { solomonCommand } from "../../src/commands/review-gate.js";

let dir;
const cwd0 = process.cwd();
afterEach(() => { process.chdir(cwd0); });
beforeEach(() => {
  vi.clearAllMocks();
  process.exitCode = 0;
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-solpol-"));
  const git = (...args) => execFileSync("git", ["-C", dir, ...args]);
  git("init", "-q");
  git("config", "user.email", "t@t"); git("config", "user.name", "t");
  fs.writeFileSync(path.join(dir, "base.js"), "base\n");
  git("add", "base.js"); git("commit", "-qm", "base");
  process.chdir(dir);
});

const stage = (name) => {
  fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
  fs.writeFileSync(path.join(dir, name), "x\n");
  execFileSync("git", ["-C", dir, "add", name]);
};
const silence = () => vi.spyOn(console, "log").mockImplementation(() => {});

describe("solomon y la clase seguridad", () => {
  it("se niega a arbitrar cuando el diff toca ficheros del supervisor (security)", async () => {
    stage(".karajan/hooks/evil");
    const spy = silence();
    const r = await solomonCommand({ config: { projectDir: dir }, flags: { position: "yo tengo razon" } });
    spy.mockRestore();
    expect(r.ruling).toBe("reject");
    expect(solomonMock).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });

  it("con policy invalida se niega a arbitrar — fail closed, no un pase silencioso", async () => {
    fs.mkdirSync(path.join(dir, ".karajan"), { recursive: true });
    fs.writeFileSync(path.join(dir, ".karajan", "policy.yml"), "version: 1\nroles:\n  coder:\n    write: { allw: ['x'] }\n");
    stage("src/normal.js");
    const spy = silence();
    const r = await solomonCommand({ config: { projectDir: dir }, flags: { position: "da igual" } });
    spy.mockRestore();
    expect(r.ruling).toBe("reject");
    expect(solomonMock).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });

  it("sin hallazgos security, arbitra con normalidad", async () => {
    stage("src/normal.js");
    solomonMock.mockResolvedValue({ ruling: "approve", solomon: "agy", reasoning: "ok" });
    const spy = silence();
    const r = await solomonCommand({ config: { projectDir: dir }, flags: { position: "detalle" } });
    spy.mockRestore();
    expect(r.ruling).toBe("approve");
    expect(process.exitCode).toBe(0);
  });
});
