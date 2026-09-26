// KJC-BUG-0217 (issue #1409): los flags con los que kj invoca el CLI de un
// provider eran una constante del codigo. kimi-code 0.27.0 rechaza la
// combinacion ("Cannot combine --prompt with --yolo", hoy `-p` y `-y`), asi que
// `kj agent run kimi` quedaba inutilizable y la unica salida era parchear kj.
// `kj review` con el mismo provider si funcionaba, porque ahi no va el
// auto-aprobado. Ahora la combinacion se declara por agente.
import { describe, it, expect, vi, beforeEach } from "vitest";

import { KimiAgent } from "../../src/agents/kimi-agent.js";
import { buildMockEnvironment } from "../../src/infrastructure/mocks.js";

const declared = (args) => ({ agents: { kimi: { task_args: args } } });

describe("flags de invocacion declarados por agente", () => {
  let runCommand, env;
  beforeEach(() => {
    env = buildMockEnvironment();
    runCommand = vi.spyOn(env.runner, "run").mockResolvedValue({ exitCode: 0, stdout: "ok", stderr: "" });
  });

  it("sin declaracion se pasan los de siempre", async () => {
    await new KimiAgent("kimi", {}, {}, env).runTask({ prompt: "x", role: "coder" });
    expect(runCommand.mock.calls[0][1]).toContain("-y");
  });

  it("una lista vacia declarada quita el auto-aprobado que el CLI rechaza", async () => {
    await new KimiAgent("kimi", declared([]), {}, env).runTask({ prompt: "x", role: "coder" });
    expect(runCommand.mock.calls[0][1]).not.toContain("-y");
  });

  it("se puede declarar otro juego de flags, no solo quitarlos", async () => {
    await new KimiAgent("kimi", declared(["--force"]), {}, env).runTask({ prompt: "x", role: "coder" });
    const args = runCommand.mock.calls[0][1];
    expect(args).toContain("--force");
    expect(args).not.toContain("-y");
  });

  it("lo que no sea una lista de cadenas se ignora: la declaracion no puede romper la invocacion", async () => {
    for (const bad of ["-y", 42, { "0": "-y" }, [null, 7]]) {
      runCommand.mockClear();
      await new KimiAgent("kimi", declared(bad), {}, env).runTask({ prompt: "x", role: "coder" });
      const args = runCommand.mock.calls[0][1];
      expect(args.every((a) => typeof a === "string"), JSON.stringify(bad)).toBe(true);
    }
  });

  it("la declaracion de un agente no afecta a otro", async () => {
    await new KimiAgent("kimi", { agents: { codex: { task_args: [] } } }, {}, env).runTask({ prompt: "x", role: "coder" });
    expect(runCommand.mock.calls[0][1]).toContain("-y");
  });

  it("el rechazo del CLI llega traducido: dice que los flags se pueden declarar", async () => {
    runCommand.mockResolvedValue({ exitCode: 1, stdout: "", stderr: "error: failed to run prompt: Cannot combine --prompt with --yolo" });
    const res = await new KimiAgent("kimi", {}, {}, env).runTask({ prompt: "x", role: "coder" });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/agents\.kimi\.task_args/);
    expect(res.error).toMatch(/Cannot combine/);
  });
});
