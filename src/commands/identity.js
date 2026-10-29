/**
 * `kj identity show|set` (IDN-A, KJC-TSK-0762, epic KJC-PCS-0079).
 *
 *   show  — declared identity vs what is ACTIVE now; exit 2 on mismatch or
 *           when nothing is declared (scriptable: the gate and hooks reuse it).
 *   set   — capture the effective gh account + git email (or --gh/--email),
 *           confirm on a TTY, write .karajan/identity.local.yml. Never invents:
 *           no session and no flags → exit 1.
 */

import { createHash } from "node:crypto";

import { signAct } from "../harden/act-sign.js";
import { enrollPhone, isPhoneEnrolled, readEnrolledKey, readEnrolledKeys, validatePhonePublicKey } from "../harden/phone-sign.js";
import { admitSigner, redeemRecoveryCode } from "../harden/roster.js";
import { phoneInvite } from "../harden/phone-invite.js";
import { readSecurityLevel } from "../harden/security-level.js";
import { humanAct } from "../harden/human-act.js";
import { readIdentity, writeIdentity } from "../identity/store.js";
import { activeGhUser, effectiveGitEmail } from "../identity/detect.js";
import { compareIdentity } from "../identity/compare.js";
import { createWizard, isTTY } from "../utils/wizard.js";

const SIGNERS_FILE = ".karajan/supervisor-signers.json";

// Reading the effective identity never throws: both readers answer null when unknown.
const effectiveIdentity = (projectDir, deps) => ({
  gh_user: activeGhUser(deps.hostsPath ? { hostsPath: deps.hostsPath } : {}),
  git_email: effectiveGitEmail(projectDir, deps.gitFn ? { gitFn: deps.gitFn } : {}),
});

// KJC-TSK-0999 (HUM-B2, ADR 0018): a lost phone is replaced with the recovery
// code, never by reinstalling: its proof is the admission and the lost phone
// is not asked to sign. The code is checked BEFORE anything else happens.
// The lost phone is REVOKED by the same code: the one named with --replaces, or the one this machine had enrolled.
function recoveryOf({ projectDir, log, flags, deps }) {
  const recovered = flags.recovery ? redeemRecoveryCode(flags.recovery, { projectDir }) : null;
  if (!recovered) return { recovered: null, lost: null };
  const lost = flags.replaces ?? (isPhoneEnrolled({ home: deps.home }) ? readEnrolledKey({ home: deps.home }) : null);
  if (!lost) throw new Error("di qué móvil se pierde: --replaces <su clave pública> (esta máquina no tiene ninguno enrolado)");
  log(`recuperación con el código: el móvil perdido (${lost.slice(0, 8)}…) queda revocado y no firma; el código gastado es la admisión del nuevo`);
  return { recovered, lost };
}

// Returns the recovery code the roster issues for the new key.
async function admitPhone(ctx) {
  const { projectDir, log, kjVersion, flags, deps } = ctx;
  // KJC-TSK-0966 (HUM-C, ADR 0018): enrolar es un acto del catálogo; hasta hoy
  // solo lo frenaba el Sentinel, y un kj fuera de Claude no tiene Sentinel.
  humanAct("phone-enroll", { env: deps.env ?? process.env, tty: deps.ttyHuman ?? process.stdout.isTTY, ancestry: deps.ancestry ?? {}, confirm: deps.confirm });
  // KJC-TSK-0998 (HUM-D, ADR 0018): a phone of the roster signs the key that
  // enters; the FIRST one has nobody to sign it (bootstrap) and runs on the four layers.
  const key = validatePhonePublicKey(flags.publicKeyBase64);
  const { recovered, lost } = recoveryOf(ctx);
  const { signature } = await signAct("phone-enroll", {
    projectDir, home: deps.home, kjVersion, logger: { warn: log, info: log },
    deps: recovered ? { ...deps, phone: { enrolled: () => false } } : deps,
    bootstrap: recovered !== null || readEnrolledKeys({ projectDir, home: deps.home }).size === 0,
    files: [{ file: SIGNERS_FILE, sha256: createHash("sha256").update(key).digest("hex") }],
    changes: [{ file: SIGNERS_FILE, status: "modified", added: 1, removed: 0, summary: `Entra la clave ${flags.label ?? "(sin etiqueta)"}`, diff: `+ ${key}`, truncated: false }],
  });
  // KJC-TSK-0831 (ADR 0010): the versioned roster, now with the admission CI
  // verifies (HUM-B); the legacy key in ~/.karajan stays.
  const { recoveryCode } = admitSigner({ projectDir, publicKey: key, label: flags.label ?? null, admission: recovered ?? signature, replaces: lost });
  enrollPhone(key, { home: deps.home });
  return recoveryCode;
}

// KJC-TSK-0822: enrola la clave PÚBLICA del móvil (la privada nunca toca esta máquina).
async function enrollPhoneAction(ctx) {
  const { log } = ctx;
  let recoveryCode;
  try {
    recoveryCode = await admitPhone(ctx);
  } catch (err) {
    log(`kj identity enroll-phone: ${err.message}`);
    return 1;
  }
  log("Móvil enrolado: la clave pública se añadió al padrón .karajan/supervisor-signers.json (commítealo) y a ~/.karajan/supervisor-phone.json. Sellar el supervisor pedirá la firma de un móvil del padrón.");
  if (recoveryCode) {
    log(`\nCÓDIGO DE RECUPERACIÓN, se enseña UNA sola vez. Guárdalo fuera de esta máquina:\n\n    ${recoveryCode}\n`);
    log("Sirve para enrolar un móvil nuevo si pierdes este: kj identity enroll-phone <clave nueva> --recovery <código>. Es de un solo uso: al usarlo se emite otro. Sin móvil y sin código no hay recuperación: el padrón se rehace por fuera de CI, a la vista de todos (ADR 0018).");
  }
  return 0;
}

// KJC-TSK-0986 (HUM-F): the once-per-version invitation to enroll the phone,
// printed for the SessionStart hook (which cannot import kj) and for scripts.
function phoneInviteAction({ log, flags, deps }) {
  // KJC-BUG-0360: the text depends on the level; at max (the default) the acts are refused.
  const { level } = readSecurityLevel({ projectDir: deps.projectDir ?? process.cwd(), home: deps.home });
  const text = phoneInvite({ home: deps.home, version: flags.version, level });
  if (text) log(text);
  return 0;
}

// Resolves true when the binding may go ahead.
async function confirmBinding(candidate, { log, flags, deps }) {
  const tty = deps.isTTY || isTTY;
  if (tty() && !flags.yes) {
    const wizard = (deps.makeWizard || createWizard)();
    try {
      const ok = await wizard.confirm(`Bind this clone to gh ${candidate.gh_user} / git ${candidate.git_email}?`, true);
      if (!ok) log("kj identity: not declared.");
      return ok;
    } finally { wizard.close(); }
  }
  if (!flags.gh || !flags.email) {
    // Proven live on day one: the active gh session had been flipped by
    // ANOTHER session, and --yes bound the clone to the wrong account.
    // Binding without confirmation is allowed, but never silent.
    log("kj identity: WARNING — binding the ACTIVE session as-is without confirmation (another session may have switched it); prefer --gh/--email explicitly and verify with `kj identity show`.");
  }
  return true;
}

async function setAction(ctx) {
  const { projectDir, log, flags, deps } = ctx;
  const effective = effectiveIdentity(projectDir, deps);
  const candidate = { gh_user: flags.gh || effective.gh_user, git_email: flags.email || effective.git_email };
  if (!candidate.gh_user || !candidate.git_email) {
    log(`kj identity: cannot declare — gh account: ${candidate.gh_user ?? "no session"}, git email: ${candidate.git_email ?? "none"}. Log in / set git config, or pass --gh <user> --email <email>.`);
    return 1;
  }
  if (!(await confirmBinding(candidate, ctx))) return 1;
  writeIdentity(projectDir, candidate);
  log(`kj identity: declared gh ${candidate.gh_user} / git ${candidate.git_email} → .karajan/identity.local.yml (ignored by git).`);
  return 0;
}

function showAction({ projectDir, log, deps }) {
  const effective = effectiveIdentity(projectDir, deps);
  const declared = readIdentity(projectDir);
  const result = compareIdentity(declared, effective);
  if (!declared) {
    log("kj identity: no identity declared for this clone — run `kj identity set`.");
    return 2;
  }
  const mark = (field) => (result.mismatches.some((m) => m.field === field) ? "DISTINTA" : "ACTIVA");
  log(`gh_user    ${declared.gh_user}  [${mark("gh_user")}: ${effective.gh_user ?? "no session"}]`);
  log(`git_email  ${declared.git_email}  [${mark("git_email")}: ${effective.git_email ?? "none"}]`);
  for (const m of result.mismatches) log(`  → ${m.remedy}`);
  return result.ok ? 0 : 2;
}

// Any other action shows the identity, as before.
const ACTIONS = { "enroll-phone": enrollPhoneAction, "phone-invite": phoneInviteAction, set: setAction };

export async function identityCommand({ action = "show", config, kjVersion = "unknown", flags = {}, deps = {} }) {
  const ctx = { projectDir: config?.projectDir || process.cwd(), log: deps.log || console.log, kjVersion, flags, deps };
  const run = Object.hasOwn(ACTIONS, action) ? ACTIONS[action] : showAction;
  return run(ctx);
}
