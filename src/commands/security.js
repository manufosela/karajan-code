/**
 * kj security show|normal|max (KJC-TSK-0995, HUM-D, ADR 0018): the project's
 * security level. `show` says the level in force and where it comes from;
 * `max` is free; `normal` is the catalog act security-level-down, signed by
 * the phone (src/harden/security-level.js).
 */
import { isPhoneEnrolled } from "../harden/phone-sign.js";
import { lowerSecurityLevel, raiseSecurityLevel, readSecurityLevel, SECURITY_LEVEL_FILE } from "../harden/security-level.js";

const MEANING = {
  max: "máxima: todo acto del catálogo (sello, reglas, enrolar un móvil) se firma con el móvil",
  normal: "normal: las cuatro capas de ADR 0009 y un código tecleado; la garantía es menor",
};
const sourceLine = (level) => {
  if (level.source === "default") return "por defecto (sin registro)";
  if (level.source === "invalid") return `REGISTRO NO FIABLE: ${level.reason}`;
  return `registrado en ${SECURITY_LEVEL_FILE} desde ${level.since ?? "?"}${level.signer ? ", firmado por un móvil del padrón" : ""}`;
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
  if (action === "normal") {
    try {
      const res = await lowerSecurityLevel({ projectDir, home, kjVersion, env: deps.env ?? process.env, tty: deps.ttyHuman ?? process.stdout.isTTY, deps, logger: deps.logger ?? console });
      log(res.changed ? `kj security: nivel normal firmado y registrado en ${SECURITY_LEVEL_FILE} (commítealo). Desde ahora kj avisará en cada acto de que la garantía es menor; kj security max lo sube.` : "kj security: el nivel ya es normal");
      return 0;
    } catch (err) {
      log(`kj security normal: ${err.message}`);
      return 1;
    }
  }
  const level = readSecurityLevel({ projectDir, home });
  log(`nivel   ${MEANING[level.level]}`);
  log(`origen  ${sourceLine(level)}`);
  log(`móvil   ${isPhoneEnrolled({ home }) ? "enrolado" : "no enrolado (kj identity enroll-phone <clave pública de la app>)"}`);
  if (flags.json) log(JSON.stringify(level));
  return level.source === "invalid" ? 2 : 0;
}
