/**
 * `kj policy add "<regla hablada>"` (PL-C, KJC-TSK-0735) — el usuario habla,
 * kj escribe: un agente traduce a UNA regla candidata del vocabulario
 * CERRADO, parsePolicy valida el merge (lo intraducible se RECHAZA, jamás
 * se inventa — el YAML es artefacto, no interfaz), se propone el diff y NO
 * se aplica sin confirmación explícita (--yes).
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import yaml from "js-yaml";
import { parsePolicy } from "@karajan-family/governance";
import { createAgent } from "../agents/index.js";
import { resolveRole } from "../config/role-resolver.js";

const PROMPT = (text) => `Traduce esta regla de proyecto hablada a un FRAGMENTO YAML del vocabulario
cerrado v1 de policy de Karajan. Vocabulario COMPLETO (nada fuera de esto):
roles.<rol>.write|shell con allow/deny (listas de globs o patrones de
comando), enforcement (warn|deny), class (security); invariants con
{id, kind: diff-threshold, metric: net_lines_added, max, enforcement}.
Responde SOLO el fragmento YAML (claves raíz: roles y/o invariants), sin
explicación ni fences. Si la regla NO cabe en el vocabulario, responde
exactamente: NO_TRADUCIBLE.

Regla: ${text}`;

async function defaultTranslate({ text, config, logger }) {
  const role = resolveRole(config, "reviewer");
  const res = await createAgent(role.provider, config, logger).reviewTask({ prompt: PROMPT(text), role: "reviewer" });
  if (!res?.ok) throw new Error(`el agente traductor (${role.provider}) falló: ${res?.error || "sin salida"}`);
  return String(res.output || "").replace(/^```[a-z]*\n?|```\s*$/g, "").trim();
}

// Merge conservador: las listas se CONCATENAN (añadir jamás borra), los
// escalares nuevos solo entran donde no había valor.
function mergeFragment(doc, frag) {
  const out = { version: 1, ...doc };
  for (const [role, caps] of Object.entries(frag.roles || {})) {
    out.roles ||= {};
    out.roles[role] ||= {};
    for (const [cap, spec] of Object.entries(caps || {})) {
      const cur = (out.roles[role][cap] ||= {});
      for (const [k, v] of Object.entries(spec || {})) {
        cur[k] = Array.isArray(v) ? [...new Set([...(cur[k] || []), ...v])] : (cur[k] ?? v);
      }
    }
  }
  if (frag.invariants) out.invariants = [...(doc.invariants || []), ...frag.invariants];
  return out;
}

const naiveDiff = (oldText, newText) => {
  const oldLines = new Set(oldText.split("\n"));
  const newLines = new Set(newText.split("\n"));
  return [
    ...[...oldLines].filter((l) => l.trim() && !newLines.has(l)).map((l) => `- ${l}`),
    ...[...newLines].filter((l) => l.trim() && !oldLines.has(l)).map((l) => `+ ${l}`),
  ].join("\n");
};

export async function policyAddCommand({ text, config = {}, flags = {}, logger = console, deps = {} }) {
  const projectDir = config?.projectDir || process.cwd();
  if (!text?.trim()) {
    logger.error?.('policy add: falta la regla — kj policy add "el coder no toca los workflows"');
    return 1;
  }
  const { translateFn = defaultTranslate } = deps;
  const raw = await translateFn({ text, config, logger });
  if (raw.includes("NO_TRADUCIBLE")) {
    logger.error?.("policy add: la regla no cabe en el vocabulario cerrado v1 — no se inventa nada; exprésala como write/shell/diff-threshold o queda como instrucción de prompt");
    return 1;
  }
  let frag;
  try {
    frag = yaml.load(raw);
  } catch (err) {
    logger.error?.(`policy add: el agente no devolvió YAML válido (${err.message}) — nada que aplicar`);
    return 1;
  }
  if (typeof frag !== "object" || frag === null || Object.keys(frag).some((k) => !["roles", "invariants"].includes(k))) {
    logger.error?.("policy add: el fragmento solo puede declarar roles y/o invariants — rechazado (vocabulario cerrado)");
    return 1;
  }

  const file = join(projectDir, ".karajan", "policy.yml");
  let current = "";
  try {
    current = readFileSync(file, "utf8");
  } catch { /* sin policy previa: se propone crearla */ }
  const merged = mergeFragment(current ? yaml.load(current) || {} : {}, frag);
  const proposed = yaml.dump(merged, { lineWidth: 100 });
  const { errors } = parsePolicy(proposed);
  if (errors.length > 0) {
    for (const e of errors) logger.error?.(`✗ ${e}`);
    logger.error?.("policy add: la regla traducida no valida contra el vocabulario del motor — rechazada, no se inventa");
    return 1;
  }

  logger.info?.(`policy add — diff propuesto para .karajan/policy.yml:\n${naiveDiff(current, proposed)}`);
  if (current.includes("#")) {
    logger.warn?.("⚠ policy add: el fichero actual tiene comentarios y el rewrite NO los preserva — revisa el diff antes de confirmar");
  }
  if (!flags.yes) {
    logger.info?.("policy add: NADA aplicado — re-ejecuta con --yes para escribir (la confirmación es tuya, no del agente)");
    return 0;
  }
  // Primer run sin .karajan/ (catch de codex): crear el padre, no reventar.
  mkdirSync(join(projectDir, ".karajan"), { recursive: true });
  writeFileSync(file, proposed, "utf8");
  logger.info?.("✓ policy add: regla aplicada — los gates (review, pre-commit, tier C) la aplican desde ya");
  return 0;
}
