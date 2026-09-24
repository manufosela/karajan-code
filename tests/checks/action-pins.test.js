/**
 * KJC-TSK-0870: fijar las actions por SHA (issue #1374) traslado su
 * mantenimiento a kj. Este check avisa cuando la etiqueta ha seguido avanzando
 * sin su pin, y NUNCA da por bueno lo que no ha podido mirar.
 */
import { describe, expect, it, vi } from "vitest";

import { createActionPinsCheck, currentSha, parsePin } from "../../src/checks/action-pins.js";
import { PINNED_ACTIONS } from "../../src/harden/workflow-templates.js";

const SHA_A = "11d5960a326750d5838078e36cf38b85af677262";
const SHA_B = "49933ea5288caeca8642d1e84afbd3f7d6820020";
const PINS = { checkout: `actions/checkout@${SHA_A} # v4` };

const answer = (sha) => ({ ok: true, text: async () => `${sha}\n` });
// ghFn: null apagado en los tests — sin esto llamarian al gh real de la maquina.
const noGh = async () => null;
const detect = (pins, fetchFn) => createActionPinsCheck({ pins, deps: { fetchFn, ghFn: noGh } }).detect();

describe("parsePin", () => {
  it("lee owner/repo@sha # tag", () => {
    expect(parsePin(`actions/checkout@${SHA_A} # v4`)).toEqual({ action: "actions/checkout", sha: SHA_A, tag: "v4" });
  });

  it("rechaza lo que no es un pin: un tag movil no lo es", () => {
    expect(parsePin("actions/checkout@v4")).toBeNull();
    expect(parsePin(`actions/checkout@${SHA_A}`)).toBeNull(); // sin tag no hay con que comparar
    expect(parsePin("")).toBeNull();
    expect(parsePin(null)).toBeNull();
  });
});

describe("currentSha", () => {
  it("pide el SHA de la etiqueta y lo devuelve normalizado", async () => {
    const fetchFn = vi.fn(async () => answer(SHA_A.toUpperCase()));
    expect(await currentSha("actions/checkout", "v4", { fetchFn, ghFn: noGh })).toBe(SHA_A);
    expect(fetchFn.mock.calls[0][0]).toBe("https://api.github.com/repos/actions/checkout/commits/v4");
  });


  it("pregunta primero por gh: es quien lleva las credenciales del usuario", async () => {
    const ghFn = vi.fn(async () => SHA_B);
    const fetchFn = vi.fn();
    expect(await currentSha("actions/checkout", "v4", { ghFn, fetchFn })).toBe(SHA_B);
    expect(ghFn).toHaveBeenCalledWith("actions/checkout", "v4");
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("sin gh cae a fetch: medido, no supuesto (fetch sin autenticar respondio 403 en la primera ejecucion real)", async () => {
    const fetchFn = vi.fn(async () => answer(SHA_A));
    expect(await currentSha("actions/checkout", "v4", { ghFn: noGh, fetchFn })).toBe(SHA_A);
    expect(fetchFn).toHaveBeenCalled();
  });

  it("una respuesta que no es un SHA no es una respuesta", async () => {
    expect(await currentSha("a/b", "v4", { ghFn: noGh, fetchFn: async () => ({ ok: true, text: async () => "Not Found" }) })).toBeNull();
    expect(await currentSha("a/b", "v4", { ghFn: noGh, fetchFn: async () => ({ ok: false, text: async () => SHA_A }) })).toBeNull();
  });
});

describe("createActionPinsCheck", () => {
  it("al dia: el pin y la etiqueta coinciden", async () => {
    const res = await detect(PINS, async () => answer(SHA_A));
    expect(res).toMatchObject({ ok: true, severity: "info" });
    expect(res.detail).toContain("al día");
  });

  it("viejo: avisa con los dos SHA y con la linea literal que lo arregla", async () => {
    const res = await detect(PINS, async () => answer(SHA_B));
    expect(res).toMatchObject({ ok: false, severity: "warn" });
    expect(res.detail).toContain("actions/checkout v4");
    expect(res.detail).toContain(SHA_B.slice(0, 12));
    expect(res.detail).toContain(SHA_A.slice(0, 12));
    expect(res.fix).toBe(`actions/checkout@${SHA_B} # v4`);
  });

  it("sin red NO da por bueno lo que no ha mirado", async () => {
    const res = await detect(PINS, async () => { throw new Error("ENOTFOUND api.github.com"); });
    expect(res.ok).toBe(true); // no es un defecto del proyecto
    expect(res.severity).toBe("info");
    expect(res.detail).toContain("no se pudo comprobar");
    expect(res.detail).not.toContain("al día");
  });

  it("comprobadas a medias: lo dice, sin fingir que estan todas", async () => {
    const pins = { checkout: PINS.checkout, setupNode: `actions/setup-node@${SHA_B} # v4` };
    const fetchFn = vi.fn(async (url) => (url.includes("setup-node") ? { ok: false, text: async () => "" } : answer(SHA_A)));
    const res = await detect(pins, fetchFn);
    expect(res.detail).toContain("1 action(s) sin comprobar");
  });

  it("un pin ilegible se denuncia: lo que no se puede leer no se puede comprobar", async () => {
    const res = await detect({ checkout: "actions/checkout@v4" }, async () => answer(SHA_A));
    expect(res).toMatchObject({ ok: false, severity: "warn" });
    expect(res.detail).toContain("mal formado");
    expect(res.fix).toContain("PINNED_ACTIONS");
  });

  it("los pines reales del proyecto son legibles (si no, el check es decorativo)", () => {
    for (const [key, pin] of Object.entries(PINNED_ACTIONS)) {
      expect(parsePin(pin), `${key} → ${pin}`).not.toBeNull();
    }
  });
});
