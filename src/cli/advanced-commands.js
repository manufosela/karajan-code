// KJC-TSK-0582: the flat `kj --help` list had grown to 37 commands, which
// drowns the handful a newcomer actually needs. This module is the single
// source of truth for which commands are "core" (always shown in `kj --help`)
// vs "advanced/specialized" (grouped under `kj advanced`). Nothing is hidden
// or unregistered — every command stays top-level and invokable for
// back-compat; this only changes what the help listing surfaces by default.

/** The few commands a newcomer needs. Shown in `kj --help`. */
export const CORE_COMMANDS = [
  "start",
  "init",
  "run",
  "plan",
  "status",
  "doctor",
  "harden",
  "config",
  "update",
];

/** Navigation/built-ins that are neither core-basics nor advanced. */
export const META_COMMANDS = ["advanced", "help"];

/**
 * Advanced commands grouped by area, in display order. Every advanced
 * command MUST live in exactly one group — the parity test fails otherwise,
 * so a newly-registered command can never silently vanish from `kj advanced`.
 */
export const ADVANCED_GROUPS = [
  { title: "Pipeline (piezas sueltas)", commands: ["autorun", "code", "review", "solomon", "agent", "scan", "tournament"] },
  { title: "Análisis pre-run", commands: ["discover", "triage", "researcher", "architect", "onboard", "brief"] },
  { title: "Búsqueda / RAG", commands: ["rag", "qmd", "watch"] },
  { title: "Calidad / auditoría", commands: ["audit", "check", "mutate", "webperf", "sonar", "privacy", "release", "policy", "claims"] },
  { title: "Sesión / board", commands: ["resume", "report", "board", "hu", "adr", "worktree", "undo", "standby", "sentinel", "identity"] },
  { title: "Infra / setup", commands: ["install-tools", "ollama", "skills", "roles", "agents", "env"] },
  { title: "Mantenimiento", commands: ["clean", "sync", "telemetry", "report-issue"] },
];

/** Flat set of every advanced command name (for fast lookup / filtering). */
export const ADVANCED_COMMANDS = ADVANCED_GROUPS.flatMap((g) => g.commands);

const ADVANCED_SET = new Set(ADVANCED_COMMANDS);
const CORE_SET = new Set(CORE_COMMANDS);
const META_SET = new Set(META_COMMANDS);

/**
 * Classify a command name. Returns "core" | "advanced" | "meta" | "unknown".
 * "unknown" means the command is registered but not yet placed in this file —
 * the parity test treats that as a failure so the listing never drifts.
 */
export function classifyCommand(name) {
  if (CORE_SET.has(name)) return "core";
  if (ADVANCED_SET.has(name)) return "advanced";
  if (META_SET.has(name)) return "meta";
  return "unknown";
}

/** True when the command should be hidden from the flat `kj --help` list. */
export function isAdvancedCommand(name) {
  return ADVANCED_SET.has(name);
}
