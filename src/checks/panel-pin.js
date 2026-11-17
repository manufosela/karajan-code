/**
 * HU-4536 (KJC-TSK-1665): a roles.<role>.provider that pins another agent than the declared
 * panel (`coder:` and `reviewer:` at the top of kj.config.yml) is said in kj doctor and on every
 * kj review, so a substitution made for lack of quota does not stay once the panel's agent can
 * act again: kj falls back by itself for one review and comes back (HU-4525).
 */
import { STRATEGY } from "./types.js";

const PANEL_ROLES = ["coder", "reviewer"];

/** @returns {{role: string, declared: string, pinned: string}[]} the roles pinned off the panel */
export function pinnedOffPanel(config) {
  return PANEL_ROLES.flatMap((role) => {
    const declared = config?.[role];
    const pinned = config?.roles?.[role]?.provider;
    return declared && pinned && pinned !== declared ? [{ role, declared, pinned }] : [];
  });
}

const detailOf = (off) => off.map((o) => `roles.${o.role}.provider pins ${o.pinned}; the panel says ${o.declared}`).join("; ");
const fixOf = (off) => off.map((o) => `if it was for lack of quota, set roles.${o.role}.provider: null in kj.config.yml`).join("; ");

/** The line kj review prints when a role is pinned off the panel; null when the panel is followed. */
export function pinnedRoleNotice(config) {
  const off = pinnedOffPanel(config);
  return off.length ? `⚠ ${detailOf(off)}: ${fixOf(off)} (kj falls back by itself when an agent has no quota).` : null;
}

export function getPanelPinChecks(config) {
  return [{
    name: "panel-pin",
    label: "Panel (coder, reviewer)",
    strategy: STRATEGY.MANUAL,
    async detect() {
      const off = pinnedOffPanel(config);
      if (off.length === 0) return { ok: true, severity: "info", detail: "every role runs the declared panel" };
      return { ok: false, severity: "warn", detail: detailOf(off), fix: fixOf(off) };
    },
  }];
}
