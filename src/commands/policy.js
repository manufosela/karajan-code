/**
 * `kj policy` — PL-A parte 3b (KJC-TSK-0733, épica KJC-PCS-0074). El motor
 * en modo WARN: eval de una tool call y check del diff staged contra
 * `.karajan/policy.yml`. En PL-A nada bloquea salvo un fichero de policy
 * inválido (exit 1: declarar lo inaplicable es error del fichero, no aviso).
 * `eval --strict` devuelve exit 2 en deny — el contrato para los adaptadores
 * de hooks de PL-B. Los dientes de check llegan en PL-B/PL-C.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { checkStagedDiff, evalToolCall, loadPolicy } from "../policy/engine.js";

const execFileAsync = promisify(execFile);

async function stagedFacts(projectDir, gitFn) {
  const run =
    gitFn ||
    (async (args) => (await execFileAsync("git", args, { cwd: projectDir, maxBuffer: 16 * 1024 * 1024 })).stdout);
  const files = (await run(["diff", "--cached", "--name-only"]))
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  let net = 0;
  for (const line of (await run(["diff", "--cached", "--numstat"])).split("\n")) {
    const [a, r] = line.trim().split(/\s+/);
    if (a && a !== "-") net += Number(a) || 0;
    if (r && r !== "-") net -= Number(r) || 0;
  }
  return { files, netLinesAdded: net };
}

export async function policyCommand({ action, config = {}, flags = {}, logger = console, deps = {} }) {
  const projectDir = config?.projectDir || process.cwd();
  const { policy, errors } = loadPolicy({ projectDir, deps });
  if (errors.length > 0) {
    for (const e of errors) logger.error?.(`✗ ${e}`);
    logger.error?.("policy: el fichero declara lo que el motor no puede aplicar — corrígelo (una regla que miente es peor que ninguna)");
    return 1;
  }

  if (action === "eval") {
    let input;
    try {
      input = flags.input ? JSON.parse(flags.input) : {};
    } catch {
      logger.error?.("policy eval: --input debe ser JSON válido");
      return 1;
    }
    const verdict = evalToolCall(policy, { role: flags.role || "coder", tool: flags.tool, input, root: projectDir });
    logger.info?.(JSON.stringify(verdict));
    return verdict.decision === "deny" && flags.strict ? 2 : 0;
  }

  // check — sobre el diff staged (único modo en PL-A), SIEMPRE warn.
  const facts = await stagedFacts(projectDir, deps.gitFn);
  const violations = checkStagedDiff(policy, { role: flags.role || "coder", ...facts });
  if (flags.json) {
    logger.info?.(JSON.stringify({ mode: "warn", violations }));
    return 0;
  }
  if (violations.length === 0) {
    logger.info?.("policy check: limpio");
    return 0;
  }
  for (const v of violations) {
    logger.warn?.(`⚠ policy [${v.rule_id}] ${v.reason}${v.file ? ` (${v.file})` : ""}`);
  }
  logger.warn?.(`policy check: ${violations.length} aviso(s) — modo warn (PL-A): no bloquea; PL-B le dará dientes`);
  return 0;
}
