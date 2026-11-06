/**
 * KJC-TSK-0986 (HUM-F, ADR 0018): whoever runs kj without a phone enrolled
 * learns it once per version, not the day the maximum level (HUM-D) refuses a
 * seal. One text, used by the SessionStart notice, by `kj doctor` and, when
 * HUM-D lands, by the deny itself: what the signature protects, how to enroll,
 * and how one proceeds today without it.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import { isPhoneEnrolled } from "./phone-sign.js";
import { phoneTextFor } from "./phone-texts.js";
import { readSecurityLevel } from "./security-level.js";
import { STRATEGY } from "../checks/types.js";

export { PHONE_ENROLL, PHONE_INVITE, PHONE_REFUSED_AT_MAX } from "./phone-texts.js";

const markerPath = (home) => join(home ?? homedir(), ".karajan", "phone-invite.json");

/**
 * The invitation, once per kj version, or null (phone enrolled, or already said
 * for this version). Saying it records it; a marker that cannot be written
 * never silences the invitation.
 * @param {{home?: string, version?: string, level?: "max"|"normal"}} [opts]
 * @returns {string|null}
 */
export function phoneInvite({ home, version = "unknown", level = "max" } = {}) {
  if (isPhoneEnrolled({ home })) return null;
  let seen = null;
  try { seen = JSON.parse(readFileSync(markerPath(home), "utf8")).version; } catch { /* never invited */ }
  if (seen === version) return null;
  try {
    mkdirSync(dirname(markerPath(home)), { recursive: true });
    writeFileSync(markerPath(home), `${JSON.stringify({ version, at: new Date().toISOString() })}\n`, "utf8");
  } catch { /* the invitation still goes out */ }
  return phoneTextFor(level);
}

const projectLevel = (projectDir, home) => readSecurityLevel({ projectDir, home }).level;

/**
 * `kj doctor`: without a phone, a FAILURE at the max level (the default, where
 * the acts are refused) and a warning at the normal level (KJC-BUG-0360).
 */
export function createPhoneCheck({ home, projectDir = process.cwd(), readLevel = () => projectLevel(projectDir, home) } = {}) {
  return {
    name: "phone-enrolled",
    label: "móvil enrolado (firma de sellos y aprobaciones)",
    strategy: STRATEGY.MANUAL,
    describe: "Whether a phone's public key is enrolled for the supervisor seal and approvals (ADR 0018)",
    async detect() {
      if (isPhoneEnrolled({ home })) return { ok: true, severity: "info", detail: "clave pública en ~/.karajan/supervisor-phone.json" };
      const level = await readLevel();
      return { ok: false, severity: level === "normal" ? "warn" : "fail", detail: phoneTextFor(level), fix: "abre https://karajancode.com/sign en el móvil y kj identity enroll-phone <clave pública>" };
    },
  };
}

export const getPhoneChecks = (opts) => [createPhoneCheck(opts)];
