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
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { checkStagedDiff, evalToolCall, loadPolicy } from "../policy/engine.js";
import { liftSealedSupervisorViolations } from "../policy/supervisor-verify.js";
import { loadExceptionRecords, loadGlobalExceptionRecords, loadStandingExceptions, recordPolicyException } from "../policy/exceptions.js";
import { buildPolicyReport } from "../policy/report.js";
import { policyFileHash, recordGateDecision } from "../policy/decisions.js";
import { readIdentity } from "../identity/store.js";
import { verifyDecisionChain } from "@karajan-family/governance";

const execFileAsync = promisify(execFile);

async function stagedFacts(projectDir, gitFn, range = null) {
  const run =
    gitFn ||
    (async (args) => (await execFileAsync("git", args, { cwd: projectDir, maxBuffer: 16 * 1024 * 1024 })).stdout);
  // PL-C (KJC-TSK-0735): en CI no hay staged — con --range se evalúa
  // base...head, el MISMO motor sobre el diff del PR (tier C del ADR 0001).
  const base = range ? ["diff", range] : ["diff", "--cached"];
  const files = (await run([...base, "--name-only"]))
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  let net = 0;
  for (const line of (await run([...base, "--numstat"])).split("\n")) {
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

  // GOV-C2 (KJC-TSK-0749): anclaje temporal sin blockchain — verificar la
  // cadena ENTERA y sellar su head-hash en un fichero TRACKEADO por git:
  // reescribir el log de ayer exige reescribir el repo de ayer. Un anchor
  // previo con más entradas que el log actual = truncado ⇒ no se re-sella.
  if (action === "anchor") {
    let raw;
    try {
      raw = readFileSync(join(projectDir, ".karajan", "policy-decisions.jsonl"), "utf8");
    } catch {
      logger.info?.("policy anchor: sin decisiones que anclar — el log nace con el primer deny/excepción/commit-allow");
      return 0;
    }
    const lines = raw.split("\n").filter((l) => l.trim());
    // Fichero vacío o solo whitespace = sin decisiones (catch de codex:
    // lines.at(-1) undefined reventaba el hash en vez de salir limpio).
    if (lines.length === 0) {
      logger.info?.("policy anchor: sin decisiones que anclar — el log nace con el primer deny/excepción/commit-allow");
      return 0;
    }
    const chain = verifyDecisionChain(lines);
    if (!chain.ok) {
      logger.error?.(`✗ policy anchor: cadena rota en la entrada ${chain.at} (${chain.reason}) — el log ha sido manipulado; NO se sella`);
      return 1;
    }
    const anchorFile = join(projectDir, ".karajan", "policy-anchor.json");
    try {
      const prev = JSON.parse(readFileSync(anchorFile, "utf8"));
      if (Number.isFinite(prev.length) && prev.length > chain.length) {
        logger.error?.(`✗ policy anchor: el log retrocede (anchor previo=${prev.length} entradas, actual=${chain.length}) — truncado tras el último sello; NO se re-sella`);
        return 1;
      }
    } catch { /* sin anchor previo (o ilegible): primer sello */ }
    const head = createHash("sha256").update(lines.at(-1), "utf8").digest("hex");
    writeFileSync(anchorFile, `${JSON.stringify({ head, length: chain.length, ts: new Date().toISOString() }, null, 2)}\n`, "utf8");
    logger.info?.(`✓ policy anchor: cadena íntegra (${chain.length} decisiones) — head ${head.slice(0, 12)} sellado en .karajan/policy-anchor.json; committéalo para anclarlo en la historia de git`);
    return 0;
  }

  // GOV-B (KJC-TSK-0746): conceder una excepción PERMANENTE con el modelo
  // probatorio completo — quién (identidad), regla exacta, justificación en
  // el momento y caducidad obligatoria. Los defaults.* del consumidor son
  // inexcepcionables: no se conceden ni desde aquí.
  if (action === "grant") {
    const { rule, until, reason } = flags;
    if (!rule || !until || !reason?.trim()) {
      logger.error?.("policy grant: --rule, --until (ISO) y --reason son obligatorios — una excepción sin quién/por qué/hasta cuándo no es una excepción, es un agujero");
      return 1;
    }
    // Inexcepcionable = inexcepcionable TAMBIÉN al conceder (catch de codex):
    // defaults.*, cualquier cap con class security, y una policy inválida
    // (sin policy legible no se puede probar que la regla NO es security).
    const m = /^roles\.([^.]+)\.(write|shell)/.exec(rule);
    if (rule.startsWith("defaults.") || errors.length > 0 || (m && policy.roles?.[m[1]]?.[m[2]]?.class === "security")) {
      logger.error?.(`policy grant: "${rule}" es inexcepcionable (default del proyecto o clase security) o la policy no es verificable — no se concede, ni con razón`);
      return 1;
    }
    try {
      // GOV-E (KJC-TSK-0750, idea del lector): la renovación es SEÑAL — una
      // regla re-concedida N veces es la política real pidiendo que la
      // cambien por su cauce. Se cuenta contra TODAS las permanentes previas
      // (vencidas incluidas: precisamente esas son la sedimentación).
      // KJC-TSK-0813: --global escribe en ~/.karajan (todos los proyectos de
      // la máquina). El contador de renovaciones cuenta sobre la FUSIÓN.
      const scope = flags.global ? "global" : "project";
      const previous = loadStandingExceptions(projectDir, { home: deps.home }).standing.filter((e) => e.rule_id === rule).length;
      const rec = recordPolicyException({
        projectDir, scope, deps: { home: deps.home },
        entry: { rule_id: rule, justification: reason.trim(), scopeKind: "permanente", expiresAt: until },
      });
      const ambit = scope === "global" ? " [ámbito global — todos tus proyectos de esta máquina]" : "";
      logger.info?.(`✓ excepción permanente registrada${ambit}: [${rec.rule_id}] hasta ${rec.expiresAt} — concedida por ${rec.who?.git ?? "?"} (${rec.who?.grade ?? "?"})`);
      if (previous >= 1) {
        logger.warn?.(`⚠ ${previous + 1}ª concesión sobre esta regla — una excepción que se renueva ya no es una excepción: considera cambiar la política por su cauce (PR a .karajan/policy.yml)`);
      }
      return 0;
    } catch (err) {
      logger.error?.(`policy grant: ${err.message}`);
      return 1;
    }
  }

  // PL-E (KJC-TSK-0767): el informe — evidencia de proceso determinista
  // sobre los dos jsonl. Cadena rota = exit 1: un informe sobre un log
  // manipulado no es un informe. El resto es informativo (exit 0).
  if (action === "report") {
    let decisionLines = [];
    try {
      decisionLines = readFileSync(join(projectDir, ".karajan", "policy-decisions.jsonl"), "utf8").split("\n").filter((l) => l.trim());
    } catch { /* sin decisiones aún: el informe lo dice con ceros */ }
    // KJC-TSK-0813 (AC3): el informe cubre TAMBIÉN el almacén global — cada
    // registro llega con su origin FÍSICO estampado por la carga.
    const proj = loadExceptionRecords(projectDir);
    const glob = loadGlobalExceptionRecords({ home: deps.home });
    const exc = { records: [...proj.records, ...glob.records], discarded: proj.discarded + glob.discarded };
    const soonDays = Number(flags.soon ?? 7);
    const report = buildPolicyReport({ decisionLines, exceptionRecords: exc.records, policy, soonDays: Number.isFinite(soonDays) ? soonDays : 7 });
    if (flags.json) {
      logger.info?.(JSON.stringify({ ...report, exceptions_discarded: exc.discarded }));
      return report.chain.ok ? 0 : 1;
    }
    const { chain, decisions: d, rules, grants: g } = report;
    if (chain.ok) logger.info?.(`✓ decision log: cadena íntegra (${chain.length} decisiones)`);
    else logger.error?.(`✗ decision log: cadena rota en la entrada ${chain.at} (${chain.reason}) — el log ha sido manipulado`);
    if (d.discarded > 0 || exc.discarded > 0) logger.warn?.(`⚠ líneas corruptas descartadas: ${d.discarded} en decisiones, ${exc.discarded} en excepciones`);
    const cps = Object.entries(d.chokepoints).map(([k, v]) => `${k} ${v}`).join(" · ") || "ninguno";
    logger.info?.(`decisiones: allow ${d.allow} · deny ${d.deny} · exempt ${d.exempt} · abiertas ${d.open} (chokepoints: ${cps})`);
    logger.info?.(rules.length > 0 ? "reglas (ordenadas por fricción):" : "reglas: ninguna ha avisado ni denegado todavía");
    for (const r of rules) {
      const meta = [r.enforcement && `enforcement=${r.enforcement}`, r.class && `class=${r.class}`].filter(Boolean).join(" ");
      logger.info?.(`  [${r.rule_id}] ${meta} — warn ${r.warns} · deny ${r.denies} · exempt ${r.exempts} · abiertas ${r.open}`);
    }
    // Con 0 globales el resumen queda EXACTAMENTE como siempre (hay consumidores de texto).
    const globals = g.alive.filter((e) => e.origin === "global").length;
    logger.info?.(`concesiones: vivas ${g.alive.length} (${globals > 0 ? `${globals} globales, ` : ""}próximas a vencer ${g.soon.length}) · vencidas ${g.expired.length} · puntuales ${g.point}`);
    for (const e of g.alive) logger.info?.(`  [${e.rule_id}] hasta ${e.expiresAt}${e.origin === "global" ? " [global]" : ""} — ${e.who?.git ?? "?"}: ${e.justification ?? "sin justificación"}`);
    logger.info?.(report.signals.length > 0 ? "señales:" : "señales: ninguna");
    for (const s of report.signals) logger.warn?.(`  ⚠ ${s}`);
    return chain.ok ? 0 : 1;
  }

  if (action === "eval") {
    let input;
    try {
      input = flags.input ? JSON.parse(flags.input) : {};
    } catch {
      logger.error?.("policy eval: --input debe ser JSON válido");
      return 1;
    }
    const role = flags.role || "coder";
    const verdict = evalToolCall(policy, { role, tool: flags.tool, input, root: projectDir });
    const strictDeny = verdict.decision === "deny" && Boolean(flags.strict);
    // GOV-F (KJC-TSK-0768): el deny de tool-time (contrato --strict del
    // Sentinel) entra en la MISMA cadena que las decisiones de commit — con
    // el hash del tool_input como artefacto. Un sello fallido se dice ANTES
    // del veredicto (la última línea de stdout sigue siendo el JSON que el
    // Sentinel parsea) y el deny se mantiene: jamás un allow por fallo de registro.
    if (strictDeny) {
      try {
        recordGateDecision(projectDir, {
          decision: "deny", chokepoint: "tool", rule_ids: [verdict.rule_id], role, tool: flags.tool ?? null,
          ...(verdict.class ? { class: verdict.class } : {}),
          // El hash es del payload CRUDO recibido (--input tal cual), no de su
          // re-serialización: el mismo JSON con otro orden o espacios es otro
          // artefacto para la auditoría (catch de codex).
          policy_hash: policyFileHash(projectDir), artifact_hash: createHash("sha256").update(String(flags.input ?? ""), "utf8").digest("hex"),
        });
      } catch (err) {
        logger.error?.(`policy eval: deny NO sellado en el decision log (${err.message}) — el deny se mantiene`);
      }
    }
    logger.info?.(JSON.stringify(verdict));
    return strictDeny ? 2 : 0;
  }

  // GOV-F (KJC-TSK-0768): un escape KJ_ALLOW_* usado en tool-time es una
  // excepción consciente — se sella como exempt chokepoint=tool con la
  // identidad DECLARADA del clon (identity.local.yml), para que el informe
  // y el anchor la vean. Lo llama el Sentinel; cualquiera puede auditarlo.
  if (action === "seal") {
    if (!flags.escape) {
      logger.error?.("policy seal: --escape <KJ_ALLOW_X> es obligatorio — un escape sin nombre no es auditable");
      return 1;
    }
    try {
      const who = readIdentity(projectDir);
      const rec = recordGateDecision(projectDir, {
        decision: "exempt", chokepoint: "tool", escape: flags.escape, tool: flags.tool ?? null,
        who: who ? { gh: who.gh_user ?? null, git: who.git_email ?? null, grade: "declarada" } : null,
        policy_hash: policyFileHash(projectDir),
      });
      logger.info?.(`✓ escape ${rec.escape} sellado (chokepoint tool${rec.tool ? `, ${rec.tool}` : ""})`);
      return 0;
    } catch (err) {
      logger.error?.(`policy seal: ${err.message}`);
      return 1;
    }
  }

  // check — staged por defecto, base...head con --range (CI). Warn salvo
  // --strict (PL-C): con --strict, una violación enforcement=deny devuelve
  // exit 2 nombrando la regla — el contrato merge-blocking del tier C.
  const facts = await stagedFacts(projectDir, deps.gitFn, flags.range || null);
  let violations = checkStagedDiff(policy, { role: flags.role || "coder", ...facts });
  // ADR 0009 (KJC-BUG-0161): en CI la misma exención estructural que en la
  // review — supervisor respaldado por provenance sellada + render canónico.
  const sup = liftSealedSupervisorViolations({ projectDir, violations });
  if (sup.lifted > 0) {
    logger.info?.(`✓ policy: ${sup.lifted} fichero(s) de supervisor verificados contra la provenance sellada (ADR 0009)`);
    violations = sup.violations;
  }
  const hard = flags.strict ? violations.filter((v) => v.enforcement === "deny") : [];
  if (flags.json) {
    logger.info?.(JSON.stringify({ mode: flags.strict ? "strict" : "warn", violations }));
    return hard.length > 0 ? 2 : 0;
  }
  if (violations.length === 0) {
    logger.info?.("policy check: limpio");
    return 0;
  }
  for (const v of violations) {
    const where = v.file ? ` (${v.file})` : "";
    const mark = flags.strict && v.enforcement === "deny" ? "✗" : "⚠";
    logger.warn?.(`${mark} policy [${v.rule_id}] ${v.reason}${where}`);
  }
  if (hard.length > 0) {
    logger.error?.(`policy check: ${hard.length} violación(es) con enforcement=deny — el merge no procede (--strict)`);
    return 2;
  }
  logger.warn?.(`policy check: ${violations.length} aviso(s) — check es modo warn, no bloquea; los deny los aplican kj review --staged y el pre-commit (PL-B)`);
  return 0;
}
