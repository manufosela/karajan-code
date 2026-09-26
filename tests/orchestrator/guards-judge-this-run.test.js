/**
 * KJC-BUG-0214 (issue #1733): un kj_run sobre un proyecto Laravel se bloqueo
 * por una linea que el coder no habia tocado, codigo que ya estaba en la rama.
 * Los guards diffeaban contra el merge-base con la base, asi que toda la rama
 * contaba como recien escrita. La sesion ya guarda HEAD al arrancar (campo
 * head_at_start, puesto ahi justo para saber que ha producido el run).
 */
import { describe, expect, it, vi } from "vitest";

const generateDiff = vi.fn(async () => "");
const computeBaseRef = vi.fn(async () => "merge-base-de-la-rama");

vi.mock("../../src/review/diff-generator.js", () => ({
  generateDiff: (...a) => generateDiff(...a),
  computeBaseRef: (...a) => computeBaseRef(...a),
}));

const { runGuardStages } = await import("../../src/orchestrator/drivers/iteration-phases/guards.js");

const logger = () => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn() });
const base = { config: { base_branch: "main" }, emitter: null, eventBase: {}, iteration: 1 };

describe("runGuardStages", () => {
  it("diffea contra el arranque del run, no contra la base de la rama", async () => {
    generateDiff.mockClear(); computeBaseRef.mockClear();
    await runGuardStages({ ...base, logger: logger(), session: { id: "s", head_at_start: "sha-del-arranque" } });
    expect(generateDiff).toHaveBeenCalledWith(expect.objectContaining({ baseRef: "sha-del-arranque" }));
    expect(computeBaseRef).not.toHaveBeenCalled();
  });

  it("sin head_at_start cae a session_start_sha", async () => {
    generateDiff.mockClear(); computeBaseRef.mockClear();
    await runGuardStages({ ...base, logger: logger(), session: { id: "s", session_start_sha: "sha-viejo" } });
    expect(generateDiff).toHaveBeenCalledWith(expect.objectContaining({ baseRef: "sha-viejo" }));
  });

  it("sin punto de arranque juzga la rama entera, pero lo dice", async () => {
    generateDiff.mockClear(); computeBaseRef.mockClear();
    const log = logger();
    await runGuardStages({ ...base, logger: log, session: { id: "s" } });
    expect(computeBaseRef).toHaveBeenCalled();
    expect(generateDiff).toHaveBeenCalledWith(expect.objectContaining({ baseRef: "merge-base-de-la-rama" }));
    expect(log.warn).toHaveBeenCalledWith(expect.stringMatching(/rama entera/));
  });

  it("con los dos guards apagados no se mira nada", async () => {
    generateDiff.mockClear();
    const res = await runGuardStages({
      ...base,
      config: { guards: { output: { enabled: false }, perf: { enabled: false } } },
      logger: logger(),
      session: { id: "s", head_at_start: "x" },
    });
    expect(res).toEqual({ action: "ok" });
    expect(generateDiff).not.toHaveBeenCalled();
  });
});
