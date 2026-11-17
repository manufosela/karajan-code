/**
 * HU-4524: which agent acts in each role of the panel right now, for kj stage. Only a
 * substitution is recorded (who replaces whom, why and since when), in the kj home, because a
 * quota belongs to the machine's account and not to a project. The panel's own agent acting
 * again clears it, so the record never outlives the outage (HU-4525).
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { getKarajanHome } from "../utils/paths.js";
import { resolveRole } from "../config/role-resolver.js";

export const ACTIVE_PANEL_FILE = "active-panel.json";
const PANEL_ROLES = ["coder", "reviewer", "solomon"];
const pathOf = (home) => join(home ?? getKarajanHome(), ACTIVE_PANEL_FILE);

/** The roles whose panel agent is replaced right now; empty when the file is absent or unreadable. */
export function readSubstitutions({ home } = {}) {
  try {
    const { substitutions } = JSON.parse(readFileSync(pathOf(home), "utf8"));
    return substitutions && typeof substitutions === "object" ? substitutions : {};
  } catch {
    return {};
  }
}

/** HU-4539: the panel the config declares, resolved as kj resolves each role, with the substitutions in force. */
export function activePanel(config, { home } = {}) {
  const declared = Object.fromEntries(PANEL_ROLES.map((role) => [role, resolveRole(config, role).provider]));
  return { ...declared, substitutions: readSubstitutions({ home }) };
}

/** Records that `acting` did the work of `role`: a substitution when it is not `declared`. */
export function recordRoleActing({ role, declared, acting, reason = "quota", now = new Date(), home } = {}) {
  const substitutions = readSubstitutions({ home });
  const current = substitutions[role];
  if (acting === declared) {
    if (!current) return;
    delete substitutions[role];
  } else if (current?.declared === declared && current?.acting === acting) {
    return;
  } else {
    substitutions[role] = { declared, acting, reason, since: now.toISOString() };
  }
  const file = pathOf(home);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify({ substitutions }, null, 2)}\n`);
}
