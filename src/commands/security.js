/**
 * kj security show|normal|max (KJC-TSK-0995, HUM-D, ADR 0018): the project's
 * security level. `show` says the level in force and where it comes from;
 * `max` is free; `normal` is the catalog act security-level-down, signed by
 * the phone (src/harden/security-level.js).
 */
import { anyAuthorizedPhone, isPhoneEnrolled, readPasskeyCredentials, readSigners } from "../harden/phone-sign.js";
import { lowerSecurityLevel, raiseSecurityLevel, readSecurityLevel, SECURITY_LEVEL_FILE } from "../harden/security-level.js";

const MEANING = {
  max: "máxima: todo acto del catálogo (sello, reglas, enrolar un móvil) se firma con el móvil",
  critical: "critical: el móvil firma lo que cambia quién gobierna (enrolar, bajar el nivel, aflojar un gate, excepción de main-guard); el resto se confirma en tu terminal",
  normal: "normal: las cuatro capas de ADR 0009 y un código tecleado; la garantía es menor",
};
const sourceLine = (level) => {
  if (level.source === "default") return "por defecto (sin registro)";
  if (level.source === "invalid") return `REGISTRO NO FIABLE: ${level.reason}`;
  return `registrado en ${SECURITY_LEVEL_FILE} desde ${level.since ?? "?"}${level.signer ? ", firmado por un móvil del padrón" : ""}`;
};
// HU-3887 (KJC-BUG-0551): this machine's phone and the repo's signers are two facts, said apart.
const phoneLine = ({ projectDir, home }) => {
  // HU-4019: a live roster passkey is a repo signer too.
  const signers = readSigners({ projectDir }).length + readPasskeyCredentials({ projectDir }).length;
  const line = `en esta máquina: ${isPhoneEnrolled({ home }) ? "sí" : "no"} · firmantes del repo: ${signers}`;
  return anyAuthorizedPhone({ projectDir, home }) ? line : `${line} (abre https://karajancode.com/sign en el móvil y kj identity enroll-phone <clave pública>)`;
};

/** @returns {Promise<0|1|2>} 2 when the record cannot be trusted */
export async function securityCommand({ action = "show", config, kjVersion, flags = {}, deps = {}, log = console.log }) {
  const projectDir = config?.projectDir || process.cwd();
  const home = deps.home;
  if (action === "max") {
    const res = raiseSecurityLevel({ projectDir, home });
    log(res.changed ? `kj security: nivel máxima registrado en ${SECURITY_LEVEL_FILE} (commítealo: viaja con el repo)` : "kj security: el nivel ya es máxima");
    return 0;
  }
  // KJC-TSK-1654 (ADR 0060): critical, like normal, is reached through the signed act.
  if (action === "normal" || action === "critical") {
    try {
      const res = await lowerSecurityLevel({ projectDir, home, kjVersion, to: action, env: deps.env ?? process.env, tty: deps.ttyHuman ?? process.stdout.isTTY, deps, logger: deps.logger ?? console });
      if (!res.changed) {
        log(`kj security: el nivel ya es ${action}`);
        return 0;
      }
      const how = res.level.unsigned ? "sin firma" : "firmado";
      log(`kj security: nivel ${action} ${how} y registrado en ${SECURITY_LEVEL_FILE} (commítealo). ${MEANING[action]}; kj security max lo sube.`);
      return 0;
    } catch (err) {
      log(`kj security ${action}: ${err.message}`);
      return 1;
    }
  }
  const level = readSecurityLevel({ projectDir, home });
  log(`nivel   ${MEANING[level.level]}`);
  log(`origen  ${sourceLine(level)}`);
  log(`móvil   ${phoneLine({ projectDir, home })}`);
  if (flags.json) log(JSON.stringify(level));
  return level.source === "invalid" ? 2 : 0;
}
