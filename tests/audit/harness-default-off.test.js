// KJC-BUG-0228 (issue #1840): el paso Harness Scorecard venia ACTIVO por
// defecto contra una imagen de terceros que ya no existe en el registro
// publico, asi que cada `kj audit` intentaba descargarla, fallaba con "pull
// access denied" y se saltaba el paso. kj no puede depender por defecto de una
// imagen que otro puede borrar: un paso que no puede correr debe DECIR que no
// va a correr, no intentarlo cada vez como si fuera normal.
import { describe, it, expect } from "vitest";

import { normalizeHarnessConfig } from "../../src/audit/harness-scorecard.js";
import { formatHarnessSection, runHarnessSection } from "../../src/audit/harness-section.js";

describe("el scorecard no se activa solo", () => {
  it("sin configuracion esta DESACTIVADO: la imagen por defecto no es de kj", () => {
    expect(normalizeHarnessConfig({}).enabled).toBe(false);
    expect(normalizeHarnessConfig().enabled).toBe(false);
  });

  it("quien lo quiere lo pide, y puede traer su propia imagen", () => {
    expect(normalizeHarnessConfig({ enabled: true }).enabled).toBe(true);
    expect(normalizeHarnessConfig({ enabled: true, image: "mi/imagen:1" }).image).toBe("mi/imagen:1");
  });

  it("un enabled: false explicito sigue desactivando, como siempre", () => {
    expect(normalizeHarnessConfig({ enabled: false }).enabled).toBe(false);
  });

  it("desactivado NO ejecuta docker y dice por que, en vez de callarse", async () => {
    let called = false;
    const res = await runHarnessSection({
      projectDir: "/tmp/no-existe",
      runAssess: async () => { called = true; return { ok: true }; },
    });
    expect(called).toBe(false);
    expect(res.skipped).toBe(true);
    expect(res.reason).toMatch(/opt-in/);
    // Y el informe lo dice: un paso ausente en silencio se lee como aprobado.
    expect(formatHarnessSection(res)).toMatch(/audit\.harness\.enabled/);
  });
});
