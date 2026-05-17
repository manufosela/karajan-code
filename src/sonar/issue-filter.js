// KJC-TSK-0416: pre-filtro determinístico de falsos positivos Sonar.
//
// Antes de que los issues Sonar lleguen al coder como feedback (sonar-role)
// o al auditor (audit), filtramos los que sabemos que son falsos positivos
// por reglas conocidas. Sin esto el coder quemaba tokens intentando
// "arreglar" cosas que no están rotas.
//
// Dos mecanismos complementarios:
//   1. Rules estáticas: { rule, filePattern, reason } — match por reglaId
//      + patrón de path. Cargadas por defecto del catálogo de FALSE_POSITIVES
//      abajo + extensibles via config.sonar.false_positives.
//   2. Inline ignore: `// karajan-sonar-ignore: <ruleId>` en la línea del
//      issue (o la anterior) → suprime ese hit exacto.

import fs from "node:fs";

// Catálogo built-in de patrones conocidos. Cada entrada:
//   { rule: "javascript:S2699", filePattern: RegExp, reason: "..." }
// Ampliable via config.sonar.false_positives.
export const DEFAULT_FALSE_POSITIVES = [
  {
    rule: "javascript:S2699",
    filePattern: /tests\/architecture\//,
    reason: "Tests structurales fallan vía expect(offenders, msg).toEqual([]) — Sonar no detecta el assert con mensaje custom",
  },
];

/**
 * Comprueba si una línea del file contiene `// karajan-sonar-ignore: <ruleId>`.
 * Acepta la línea exacta del issue o la inmediatamente anterior.
 *
 * @param {string} filePath
 * @param {number} line - 1-indexed
 * @param {string} ruleId
 * @returns {boolean}
 */
export function hasInlineIgnore(filePath, line, ruleId) {
  if (!filePath || !line || !ruleId) return false;
  if (!fs.existsSync(filePath)) return false;
  try {
    const lines = fs.readFileSync(filePath, "utf8").split("\n");
    const idx = line - 1;
    const candidates = [lines[idx], lines[idx - 1]].filter(Boolean);
    const re = new RegExp(`karajan-sonar-ignore\\s*:\\s*${escapeRegex(ruleId)}\\b`);
    return candidates.some((l) => re.test(l));
  } catch {
    return false;
  }
}

function escapeRegex(s) {
  return String(s).replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Filtra issues de Sonar separando los reales de los falsos positivos.
 *
 * @param {object[]} issues - array de Sonar issues (shape: { rule, component, line, message, severity, ... })
 * @param {object} [opts]
 * @param {object[]} [opts.extraRules] - rules adicionales del config
 * @param {string} [opts.projectRoot] - para resolver component → ruta absoluta
 * @returns {{ kept: object[], suppressed: object[] }}
 */
export function filterFalsePositives(issues, opts = {}) {
  if (!Array.isArray(issues)) return { kept: [], suppressed: [] };
  const rules = [...DEFAULT_FALSE_POSITIVES, ...(opts.extraRules || [])].map((r) => ({
    ...r,
    filePattern: r.filePattern instanceof RegExp ? r.filePattern : new RegExp(String(r.filePattern || ".*")),
  }));
  const projectRoot = opts.projectRoot || process.cwd();
  const kept = [];
  const suppressed = [];

  for (const issue of issues) {
    const path = componentToPath(issue.component);
    let matched = null;

    // 1. Rules estáticas.
    for (const rule of rules) {
      if (issue.rule === rule.rule && rule.filePattern.test(path)) {
        matched = { rule: rule.rule, path, reason: rule.reason };
        break;
      }
    }

    // 2. Inline ignore (más caro — solo si la regla estática no matchea).
    if (!matched && issue.rule && issue.line && path) {
      const absPath = path.startsWith("/") ? path : `${projectRoot}/${path}`;
      if (hasInlineIgnore(absPath, issue.line, issue.rule)) {
        matched = { rule: issue.rule, path, reason: "inline `// karajan-sonar-ignore`" };
      }
    }

    if (matched) {
      suppressed.push({ ...issue, _suppressedBy: matched });
    } else {
      kept.push(issue);
    }
  }
  return { kept, suppressed };
}

/**
 * Sonar reporta component como `<projectKey>:<relativePath>`. Extrae el path.
 */
function componentToPath(component) {
  if (typeof component !== "string") return "";
  const colonIdx = component.indexOf(":");
  return colonIdx >= 0 ? component.slice(colonIdx + 1) : component;
}
