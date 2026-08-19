/**
 * Mutation pre-gate (MUT-A, KJC-TSK-0716, épica KJC-PCS-0072) — el auditor
 * del invariante "tests prove behavior": un test con asserts flojos deja
 * mutantes vivos aunque la suite esté verde. OPT-IN (method_gates.mutation:
 * warn|block — la mutación cuesta minutos, jamás corre sin declararla) y
 * SOLO en --staged, donde ya se va a gastar reviewer: los supervivientes
 * viajan como advisory en su task, y en block cierran el gate ANTES con la
 * lista exacta. Indisponible = degrada avisando, nunca en silencio.
 */
import { runMutation } from "../mutate/runner.js";
import { getDiffScope } from "../mutate/diff-scope.js";
import { detectProjectStack } from "../utils/stack-detect.js";
import { getMutationTool } from "../mutate/tool-registry.js";

export const formatSurvivor = (s) =>
  `${s.file}:${s.line} (${s.mutator ?? s.status ?? "?"}) — mátalo con un assert que distinga el cambio`;

async function defaultMutate({ projectDir }) {
  const { language } = await detectProjectStack(projectDir);
  const tool = getMutationTool(language);
  if (!tool.supported) throw new Error(`lenguaje no soportado (${language ?? "desconocido"}) — ${tool.reason}`);
  const scope = await getDiffScope({ staged: true, language });
  if (scope.empty) return { result: { score: 100, killed: 0, total: 0, survived: [] } };
  const outcome = await runMutation({ binary: tool.binary, args: scope.args, cwd: projectDir });
  if (!outcome.result) throw new Error(`la herramienta ${tool.id} no produjo un informe legible`);
  return outcome;
}

/**
 * @returns {Promise<{enabled: boolean, ok: boolean, available?: boolean, mode?: string, survived?: object[], score?: number, reason?: string}>}
 */
export async function runMutationPregate({ config = {}, projectDir = process.cwd(), deps = {} } = {}) {
  const mode = config?.method_gates?.mutation;
  if (mode !== "warn" && mode !== "block") return { enabled: false, ok: true };
  const { mutateFn = defaultMutate } = deps;
  let outcome;
  try {
    outcome = await mutateFn({ projectDir });
  } catch (err) {
    // Sin herramienta no hay medición: cerrar sería castigar sin juicio y
    // callar sería un pase falso — se degrada DICIENDO qué red está caída.
    return { enabled: true, ok: true, available: false, mode, reason: err.message };
  }
  // Payload malformado del runner = misma degradación que el error (catch
  // de codex): jamás crashear el review gate por un informe roto.
  if (!outcome?.result || !Array.isArray(outcome.result.survived ?? [])) {
    return { enabled: true, ok: true, available: false, mode, reason: "el runner de mutación devolvió un informe ilegible" };
  }
  const { survived = [], score } = outcome.result;
  return { enabled: true, available: true, mode, survived, score, ok: mode === "warn" || survived.length === 0 };
}
