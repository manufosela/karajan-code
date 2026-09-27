// KJC-BUG-0222: el aviso del harness decia "does not match the installed kj" y
// ahi acababa. En campo se leyo como "kj se desincroniza solo": una sesion se
// monto el ritual de ejecutar `kj harden` antes de cada review y cada commit,
// veinte veces en un dia. La causa estaba entera en el dato que faltaba, que
// ese kj estaba enlazado a un arbol de desarrollo. Un gate que no dice contra
// que compara ensena a saltarselo, y saltarselo por rutina es peor que no
// tenerlo, porque parece que se cumple.
import { describe, it, expect } from "vitest";

import { kjProvenance } from "../../src/review/kj-provenance.js";
import { checkRagRequirement, checkRagVerdict } from "../../src/review/rag-requirement.js";

describe("kjProvenance", () => {
  it("un kj instalado se nombra por version y ruta, sin alarma", () => {
    const p = kjProvenance("/home/u/proj/node_modules/karajan-code/src/review");
    expect(p.linked).toBe(false);
    expect(p.label).not.toMatch(/LINKED/);
  });

  it("un arbol enlazado se dice, y se dice que mueve las plantillas de toda la maquina", () => {
    const p = kjProvenance("/home/u/ws/karajan-code/src/review");
    expect(p.linked).toBe(true);
    expect(p.label).toMatch(/LINKED from \/home\/u\/ws\/karajan-code/);
    expect(p.label).toMatch(/every project on this machine/);
  });

  it("sin manifest legible no revienta: adornar un mensaje no puede tumbar un gate", () => {
    const p = kjProvenance("/no/existe/en/ninguna/parte/src/review");
    expect(p.version).toBeNull();
    expect(p.label).toContain("unknown kj");
  });
});

describe("el aviso del harness dice contra que compara", () => {
  const config = { development: { source_file_extensions: [".js"] } };
  const staged = ["src/a.js"];

  it("en kj review --staged", () => {
    const r = checkRagRequirement({
      config, stagedFiles: staged,
      ledger: { harness: true, verified: false, mismatched: ["stop.mjs"] },
      env: {},
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/templates of kj \d+\.\d+\.\d+/);
    expect(r.reason).toContain("stop.mjs");
  });

  it("en el gate de commit", () => {
    const r = checkRagVerdict({ config, stagedFiles: staged, verified: false, mismatched: ["stop.mjs"] });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/templates of kj \d+\.\d+\.\d+/);
  });

  // Catch de la review: el mensaje seguia mandando `kj harden` incluso para un
  // guard sellado, que es justo el que ese comando deja en paz. Cada estado
  // nombra el comando que LO resuelve, o el aviso es un bucle con buena prosa.
  it("un guard sellado y atrasado nombra kj harden --commit, no kj harden a secas", () => {
    const r = checkRagVerdict({ config, stagedFiles: staged, verified: false, mismatched: ["stop.mjs"], drift: ["stop.mjs"] });
    expect(r.reason).toMatch(/kj harden --commit/);
    expect(r.reason).toMatch(/leaves untouched on purpose/);
  });

  it("sin nada sellado, el remedio sigue siendo kj harden", () => {
    const r = checkRagVerdict({ config, stagedFiles: staged, verified: false, mismatched: ["stop.mjs"] });
    expect(r.reason).not.toMatch(/--commit/);
    expect(r.reason).toMatch(/kj harden/);
  });
});
