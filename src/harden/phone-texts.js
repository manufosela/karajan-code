/**
 * What kj says about the phone (ADR 0018). Apart from phone-invite.js so that
 * security-level.js and act-sign.js can use the texts while phone-invite.js
 * reads the security level, with no import cycle.
 */
// KJC-BUG-0508: whoever updated kj never ran init, so this text is where they learn the steps.
export const PHONE_ENROLL =
  "Para enrolarlo: abre https://karajancode.com/sign en el móvil (crea la clave y te enseña la pública) y, desde TU terminal, kj identity enroll-phone <clave pública> --label <nombre>. Cada acto queda atado a tu clave privada, que nunca sale del móvil (ADR 0018).";

/** KJC-BUG-0508: the way out while no phone is enrolled (ADR 0020). */
export const PHONE_OR_NORMAL = "Si prefieres no usar el móvil, kj security normal baja el nivel desde tu terminal mientras no hay ninguno enrolado (ADR 0020).";

/** HU-3887 (KJC-BUG-0551): a phone of the repo roster signs from wherever its owner is. */
export const PHONE_REMOTE_SIGNER =
  "esta máquina no tiene móvil en el padrón: firma el dueño de un móvil del padrón del repo (.karajan/supervisor-signers.json); envíale el enlace.";

/** Normal level: without a phone the acts are signed with a typed code. */
export const PHONE_INVITE =
  `El móvil no está enrolado: los sellos (kj harden --commit), las aprobaciones y los comandos del catálogo se firman hoy con un código tecleado, con menos garantía. ${PHONE_ENROLL}`;

/** KJC-BUG-0360: max level, the default: without a phone the acts are REFUSED, not signed with a code. */
export const PHONE_REFUSED_AT_MAX =
  `El móvil no está enrolado y la seguridad es máxima (la de por defecto): kj harden --commit, kj rules approve y enrolar otro móvil se rechazan hasta enrolarlo. ${PHONE_ENROLL} ${PHONE_OR_NORMAL}`;

export const phoneTextFor = (level) => (level === "normal" ? PHONE_INVITE : PHONE_REFUSED_AT_MAX);
