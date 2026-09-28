// KJC-TSK-0879 (issue #1310) paso 3: tras escribir sus reglas en la fuente de
// Rulesync, kj puede compilarlas, pero solo si el proyecto lo declara
// (rulesync.generate: true) y sin descargar nada: kj no ejecuta el compilador
// de otro por su cuenta, ni un paquete bajado al vuelo.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { maybeRulesyncGenerate } from "../../src/utils/rulesync.js";

let dir;
const logger = () => ({ info: vi.fn(), warn: vi.fn() });
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "kj-rs-gen-")); mkdirSync(join(dir, ".rulesync")); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("maybeRulesyncGenerate", () => {
  it("sin opt-in no ejecuta nada, y dice como propagar las reglas", () => {
    const run = vi.fn();
    const log = logger();
    expect(maybeRulesyncGenerate({ projectDir: dir, config: {}, logger: log, run })).toMatchObject({ ran: false, reason: "not-opted-in" });
    expect(run).not.toHaveBeenCalled();
    expect(log.info.mock.calls.join(" ")).toMatch(/rulesync generate.*rulesync\.generate: true/);
  });

  it("con opt-in y el binario local, usa ese", () => {
    const bin = join(dir, "node_modules", ".bin");
    mkdirSync(bin, { recursive: true });
    writeFileSync(join(bin, "rulesync"), "");
    const run = vi.fn();
    expect(maybeRulesyncGenerate({ projectDir: dir, config: { rulesync: { generate: true } }, logger: logger(), run }).ran).toBe(true);
    expect(run).toHaveBeenCalledWith(join(bin, "rulesync"), ["generate", "--targets", "*", "--features", "*"], dir);
  });

  it("con opt-in y sin binario local, npx --no-install: nunca descarga", () => {
    const run = vi.fn();
    maybeRulesyncGenerate({ projectDir: dir, config: { rulesync: { generate: true } }, logger: logger(), run });
    expect(run.mock.calls[0][0]).toBe("npx");
    expect(run.mock.calls[0][1].slice(0, 2)).toEqual(["--no-install", "rulesync"]);
  });

  it("si falla lo dice en alto y no revienta el install", () => {
    const log = logger();
    const run = () => { throw new Error("rulesync: command not found"); };
    expect(maybeRulesyncGenerate({ projectDir: dir, config: { rulesync: { generate: true } }, logger: log, run })).toMatchObject({ ran: false, reason: "failed" });
    expect(log.warn.mock.calls.join(" ")).toMatch(/command not found/);
  });

  it("sin Rulesync en el proyecto, nada", () => {
    rmSync(join(dir, ".rulesync"), { recursive: true });
    const run = vi.fn();
    expect(maybeRulesyncGenerate({ projectDir: dir, config: { rulesync: { generate: true } }, logger: logger(), run }).reason).toBe("no-rulesync");
    expect(run).not.toHaveBeenCalled();
  });
});
