// Compress role outputs before passing as context to the next role.
// Reduces token usage by extracting essentials and dropping verbose explanations.

/**
 * Compression strategies per role output type.
 */
const COMPRESSORS = {
  researcher: compressResearcher,
  architect: compressArchitect,
  planner: compressPlanner,
  reviewer: compressReviewer,
  tester: compressTester,
  security: compressSecurity,
  sonar: compressSonar,
  default: compressDefault
};

/**
 * Extract essentials from researcher output.
 */
function compressResearcher(output) {
  if (!output || typeof output !== "object") return output;
  const parts = [];
  if (output.affected_files?.length) parts.push(`Files: ${output.affected_files.join(", ")}`);
  if (output.patterns?.length) parts.push(`Patterns: ${output.patterns.join(", ")}`);
  if (output.risks?.length) parts.push(`Risks: ${output.risks.join(", ")}`);
  if (output.constraints?.length) parts.push(`Constraints: ${output.constraints.join(", ")}`);
  return parts.join("\n");
}

/**
 * Extract essentials from architect output.
 */
function compressArchitect(output) {
  if (!output || typeof output !== "object") return output;
  const arch = output.architecture || output;
  const parts = [];
  if (arch.type) parts.push(`Type: ${arch.type}`);
  if (arch.layers?.length) parts.push(`Layers: ${arch.layers.join(" → ")}`);
  if (arch.patterns?.length) parts.push(`Patterns: ${arch.patterns.join(", ")}`);
  const entities = arch.dataModel?.entities;
  if (entities?.length) {
    const names = entities.map(e => typeof e === "string" ? e : e.name).filter(Boolean);
    if (names.length) parts.push(`Entities: ${names.join(", ")}`);
  }
  if (output.verdict) parts.push(`Verdict: ${output.verdict}`);
  return parts.join("\n");
}

/**
 * Extract essentials from planner output — keep numbered steps only.
 */
function compressPlanner(output) {
  if (!output || typeof output !== "object") return output;
  const plan = output.plan || output;
  if (typeof plan !== "string") return JSON.stringify(plan);

  // Keep only numbered steps, drop prose
  const lines = plan.split("\n").filter(l => l.trim());
  const steps = lines.filter(l => /^\s*\d+[.)]\s/.test(l) || /^\s*[-*]\s/.test(l));
  if (steps.length >= 3) return steps.join("\n");
  return plan.slice(0, 1500);
}

/**
 * Compress reviewer output — drop non-blocking suggestions, keep blocking.
 */
function compressReviewer(output) {
  if (!output || typeof output !== "object") return output;
  const blocking = output.blocking_issues || [];
  if (!blocking.length) return `Approved${output.summary ? `: ${output.summary.slice(0, 200)}` : ""}`;

  const items = blocking.map((x, i) => {
    const sev = x.severity ? `[${x.severity}]` : "";
    const loc = x.file ? ` (${x.file}${x.line ? `:${x.line}` : ""})` : "";
    return `${i + 1}. ${sev}${loc} ${x.description || "no description"}${x.suggested_fix ? ` — Fix: ${x.suggested_fix}` : ""}`;
  });
  return `Rejected (${blocking.length} blocking):\n${items.join("\n")}`;
}

/**
 * Compress tester output — keep verdict + coverage + missing scenarios.
 */
function compressTester(output) {
  if (!output || typeof output !== "object") return output;
  const parts = [];
  parts.push(`Verdict: ${output.verdict || "unknown"}`);
  if (output.coverage?.overall != null) parts.push(`Coverage: ${output.coverage.overall}%`);
  if (output.missing_scenarios?.length) {
    parts.push(`Missing: ${output.missing_scenarios.slice(0, 5).join("; ")}`);
  }
  if (output.quality_issues?.length) {
    parts.push(`Quality: ${output.quality_issues.slice(0, 3).join("; ")}`);
  }
  return parts.join("\n");
}

/**
 * Compress security output — keep verdict + grouped vulnerabilities.
 */
function compressSecurity(output) {
  if (!output || typeof output !== "object") return output;
  const vulns = output.vulnerabilities || [];
  if (vulns.length === 0) return `Verdict: ${output.verdict || "pass"}; no vulnerabilities`;

  const bySev = {};
  for (const v of vulns) {
    const sev = v.severity || "unknown";
    bySev[sev] = bySev[sev] || [];
    bySev[sev].push(`${v.file || "?"}${v.line ? `:${v.line}` : ""} ${v.description}`);
  }

  const sevOrder = ["critical", "high", "medium", "low"];
  const lines = [`Verdict: ${output.verdict || "fail"}`];
  for (const sev of sevOrder) {
    if (bySev[sev]?.length) lines.push(`${sev}: ${bySev[sev].slice(0, 3).join("; ")}`);
  }
  return lines.join("\n");
}

/**
 * Compress sonar output — keep gate status + top issues.
 */
function compressSonar(output) {
  if (!output || typeof output !== "object") return output;
  const parts = [];
  if (output.gateStatus) parts.push(`Gate: ${output.gateStatus}`);
  if (output.issues?.length) {
    parts.push(`${output.issues.length} issue(s)`);
    const top = output.issues.slice(0, 5).map(i => `${i.severity}: ${i.message}`);
    parts.push(top.join("; "));
  }
  return parts.join("\n");
}

/**
 * Default compression: truncate long strings, drop noise.
 */
function compressDefault(output) {
  if (!output) return "";
  if (typeof output === "string") {
    return output.length > 2000 ? output.slice(0, 2000) + "...[truncated]" : output;
  }
  if (typeof output === "object") {
    const str = JSON.stringify(output, null, 2);
    return str.length > 2000 ? str.slice(0, 2000) + "...[truncated]" : str;
  }
  return String(output);
}

/**
 * Compress a role output.
 * @param {string} roleName - e.g. "researcher", "reviewer"
 * @param {*} output - role's result object
 * @returns {string} compressed text
 */
export function compressRoleOutput(roleName, output) {
  const compressor = COMPRESSORS[roleName] || COMPRESSORS.default;
  try {
    return compressor(output);
  } catch {
    return COMPRESSORS.default(output);
  }
}

/**
 * Estimate token count for a compressed string (rough: chars/4).
 */
export function estimateTokens(text) {
  if (!text) return 0;
  return Math.ceil(String(text).length / 4);
}

/**
 * Measure compression ratio.
 */
export function measureCompression(original, compressed) {
  const origTokens = estimateTokens(typeof original === "string" ? original : JSON.stringify(original));
  const compTokens = estimateTokens(compressed);
  const saved = origTokens - compTokens;
  const ratio = origTokens > 0 ? saved / origTokens : 0;
  return {
    originalTokens: origTokens,
    compressedTokens: compTokens,
    savedTokens: saved,
    savedPct: Number((ratio * 100).toFixed(1))
  };
}

export { COMPRESSORS };
