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
import { STRATEGY } from "../checks/types.js";

export const PHONE_INVITE =
  "El móvil no está enrolado: los sellos (kj harden --commit), las aprobaciones y los comandos del catálogo se firman hoy con un código tecleado, con menos garantía. Enrólalo con kj identity enroll-phone <clave pública de la app>: cada acto queda atado a tu clave privada, que nunca sale del móvil (ADR 0018).";

const markerPath = (home) => join(home ?? homedir(), ".karajan", "phone-invite.json");

/**
 * The invitation, once per kj version, or null (phone enrolled, or already said
 * for this version). Saying it records it; a marker that cannot be written
 * never silences the invitation.
 * @param {{home?: string, version?: string}} [opts]
 * @returns {string|null}
 */
export function phoneInvite({ home, version = "unknown" } = {}) {
  if (isPhoneEnrolled({ home })) return null;
  let seen = null;
  try { seen = JSON.parse(readFileSync(markerPath(home), "utf8")).version; } catch { /* never invited */ }
  if (seen === version) return null;
  try {
    mkdirSync(dirname(markerPath(home)), { recursive: true });
    writeFileSync(markerPath(home), `${JSON.stringify({ version, at: new Date().toISOString() })}\n`, "utf8");
  } catch { /* the invitation still goes out */ }
  return PHONE_INVITE;
}

/** `kj doctor`: WARN while the phone is not enrolled, with the same text. */
export function createPhoneCheck({ home } = {}) {
  return {
    name: "phone-enrolled",
    label: "móvil enrolado (firma de sellos y aprobaciones)",
    strategy: STRATEGY.MANUAL,
    describe: "Whether a phone's public key is enrolled for the supervisor seal and approvals (ADR 0018)",
    async detect() {
      if (isPhoneEnrolled({ home })) return { ok: true, severity: "info", detail: "clave pública en ~/.karajan/supervisor-phone.json" };
      return { ok: false, severity: "warn", detail: PHONE_INVITE, fix: "kj identity enroll-phone <clave pública de la app>" };
    },
  };
}

export const getPhoneChecks = (opts) => [createPhoneCheck(opts)];
