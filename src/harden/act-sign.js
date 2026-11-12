/**
 * KJC-TSK-0996 (HUM-D, ADR 0018): the security level applied to every act of
 * the catalog, in one place. With a phone enrolled the act is signed by it over
 * the exact bytes of what it does, and the request says what is done, why the
 * signature is asked and what would happen if another did it. Without a phone:
 * at `max` the act is refused and told how to enroll (never a typed code
 * instead), except the first enrollment, which nobody could sign; at `normal`
 * the four layers stand and the act says the guarantee is lesser.
 */
import { basename } from "node:path";

import { humanActOf } from "./human-act.js";
import { PHONE_ENROLL, PHONE_INVITE } from "./phone-texts.js";
import { anyAuthorizedPhone, isPhoneEnrolled, readPasskeyCredentials, requestPhoneSignature } from "./phone-sign.js";
import { readSecurityLevel } from "./security-level.js";
import { sealRepoOf } from "./seal-repo.js";

const EXPLAIN = {
  "supervisor-seal": [
    "Se sella el supervisor regenerado por kj harden: los hooks y guardias listados quedan como los bytes que firmas.",
    "Sin tu firma el CI no acepta la procedencia: nadie, ni el agente, da por bueno un supervisor que tú no viste.",
    "Quien altere un hook sin este sello deja la procedencia incompleta y CI lo rechaza.",
  ],
  "rules-approve": [
    "Se instalan las reglas compiladas de tus MD como gates del proyecto (.karajan/rules.yml).",
    "El agente propone cómo se compilan las reglas que le vigilan; solo tú las apruebas.",
    "Reglas instaladas sin tu firma no son tuyas: el agente podría aflojar las que le frenan.",
  ],
  "gates-loosen": [
    "Se afloja una regla ajustable del proyecto (kj gates set), por ejemplo un tamaño de PR mayor o un gate de bloqueo a aviso.",
    "El agente puede endurecer las reglas que le vigilan, pero aflojarlas solo puedes tú (ADR 0045).",
    "Una regla aflojada sin tu firma dejaría al agente rebajar lo que le frena.",
  ],
  "main-guard-except": [
    "Se firma una excepción para una PR que se mergea sin sus checks obligatorios (p. ej. un merge de admin en una transición), para su commit actual y con el motivo que ves.",
    "main-guard solo deja pasar ese merge con tu firma, y lo nombra en su informe con el motivo.",
    "Una excepción sin tu firma dejaría a cualquiera con tus credenciales saltarse los checks sin que saltara la alarma.",
  ],
  "phone-enroll": [
    "Entra una clave pública nueva en el padrón de móviles que pueden firmar en este proyecto.",
    "Quien está en el padrón sella, aprueba reglas y baja el nivel: solo un móvil ya enrolado admite a otro.",
    "Una clave añadida sin la firma de un móvil del padrón daría a otro tu poder de firma.",
  ],
  "hooks-set": [
    "Se fija o se suelta el comando de un paso de los hooks (kj hooks set|unset), que sustituye al paso de calidad detectado.",
    "El agente no puede cambiar qué comprueban los hooks que le vigilan: solo tú decides qué comando los ejecuta (ADR 0051).",
    "Un comando fijado sin tu firma dejaría al agente vaciar o falsear la comprobación que le frena.",
  ],
};

/** What the phone shows beside the files: what, why, and if another did it. */
export function explainAct(id) {
  const [what, why, other] = EXPLAIN[id] ?? [];
  if (!what) throw new Error(`"${id}" has no explanation for the phone (src/harden/act-sign.js, ADR 0018)`);
  return `Qué se va a hacer: ${what}\nPor qué se pide tu firma: ${why}\nSi lo hiciera otro: ${other}`;
}

/**
 * @param {string} id catalog id (src/harden/human-act.js)
 * @param {{projectDir: string, home?: string, kjVersion: string, files: {file: string, sha256: string}[],
 *   changes?: object[], branch?: string|null, bootstrap?: boolean, logger?: object, deps?: {phone?: object}}} opts
 *   `bootstrap`: the act may run with no phone enrolled even at max (the first enrollment).
 * @returns {Promise<{level: object, signature: object|null}>} the block to record, or null when no phone signed
 */
export async function signAct(id, { projectDir, home, kjVersion, files, changes = [], branch = null, bootstrap = false, logger = console, deps = {} }) {
  const act = humanActOf(id);
  const level = readSecurityLevel({ projectDir, home });
  if (level.source === "invalid") logger.warn?.(`${act.label}: ${level.reason}`);
  // HU-3887 (KJC-BUG-0551): at max a phone that can sign is any key of the roster, not only this
  // machine's. At normal the signed record itself puts a key in the roster, so there it stays this machine's.
  // HU-4016: a live roster passkey signs at both levels (HU-4019: at max, anyAuthorizedPhone counts it).
  const enrolled = level.level === "max" ? anyAuthorizedPhone : (where) => isPhoneEnrolled(where) || readPasskeyCredentials(where).length > 0;
  const phone = { enrolled, request: requestPhoneSignature, ...deps.phone };
  if (!phone.enrolled({ projectDir, home })) {
    // No key anywhere: enroll-phone runs as the bootstrap, so the refusal points there and nowhere that loops back.
    if (level.level === "max" && !bootstrap) {
      throw new Error(`${act.label}: con seguridad máxima este acto se firma con el móvil y no hay ninguno enrolado. ${PHONE_ENROLL}`);
    }
    logger.warn?.(`${act.label}: sin móvil enrolado solo valen las cuatro capas y la garantía es menor (ADR 0018). ${PHONE_INVITE}`);
    return { level, signature: null };
  }
  if (level.level === "normal") logger.warn?.(`${act.label}: seguridad normal, la garantía es menor que con la máxima; kj security max la sube`);
  const signed = await phone.request({
    // KJC-BUG-0506: the repo, which the verifier checks; the folder only where there is no origin.
    project: sealRepoOf(projectDir) ?? basename(projectDir), files, kjVersion, changes, branch, why: explainAct(id),
    origin: `${act.label} (kj ${kjVersion})`, logger,
    // HU-3912: the link of a new phone travels to another signer; give it 10 minutes.
    ...(id === "phone-enroll" ? { ttlMs: 600000 } : {}), deps: { projectDir, home },
  });
  if (!signed.ok) throw new Error(`${act.label}: firma del móvil rechazada (${signed.reason}); con móvil enrolado el acto exige su firma (ADR 0018)`);
  if (!signed.block) throw new Error(`${act.label}: el relé no devolvió una firma que kj pueda grabar; el acto no se aplica`);
  return { level, signature: signed.block };
}
