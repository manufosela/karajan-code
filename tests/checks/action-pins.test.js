/**
 * KJC-TSK-0870: fijar las actions por SHA (issue #1374) traslado su
 * mantenimiento a kj. Este check avisa cuando la etiqueta ha seguido avanzando
 * sin su pin, y NUNCA da por bueno lo que no ha podido mirar.
 */
import { describe, expect, it, vi } from "vitest";

import { currentSha, parsePin } from "../../src/checks/action-pins.js";

const SHA_A = "11d5960a326750d5838078e36cf38b85af677262";
const SHA_B = "49933ea5288caeca8642d1e84afbd3f7d6820020";

const answer = (sha) => ({ ok: true, text: async () => `${sha}\n` });
// ghFn: null apagado en los tests — sin esto llamarian al gh real de la maquina.
const noGh = async () => null;

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
