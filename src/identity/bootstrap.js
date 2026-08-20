/**
 * Identity lock — bootstrap (IDN-A, KJC-TSK-0762). Runs at the end of
 * `kj harden` (and therefore `kj env install`): if this clone has no declared
 * identity, capture it — but ONLY with a human confirming on a TTY. Headless
 * runs never bind blindly (the first real `set --yes` bound a clone to an
 * account another session had switched to); they report the pending step
 * with the exact command instead. Fail-loud, never a guess.
 */

import { readIdentity, writeIdentity } from "./store.js";
import { activeGhUser, effectiveGitEmail } from "./detect.js";
import { createWizard, isTTY } from "../utils/wizard.js";

/**
 * @param {{projectDir: string, logger?: object, deps?: object}} args
 * @returns {Promise<{declared: boolean, identity: object|null, pending: string|null}>}
 */
export async function ensureIdentity({ projectDir, logger = null, deps = {} }) {
  const existing = readIdentity(projectDir);
  if (existing) return { declared: true, identity: existing, pending: null };

  const gh = activeGhUser(deps.hostsPath ? { hostsPath: deps.hostsPath } : {});
  const email = effectiveGitEmail(projectDir, deps.gitFn ? { gitFn: deps.gitFn } : {});
  const hint = `kj identity set --gh ${gh ?? "<user>"} --email ${email ?? "<email>"}`;
  const tty = (deps.isTTY || isTTY)();

  if (!tty || !gh || !email) {
    const why = !gh || !email ? "no active gh session or git email" : "non-interactive run";
    const pending = `identity not declared for this clone (${why}) — run: ${hint}`;
    logger?.warn?.(`kj identity: ${pending}`);
    return { declared: false, identity: null, pending };
  }

  const wizard = (deps.makeWizard || createWizard)();
  try {
    const ok = await wizard.confirm(`Bind this clone to gh ${gh} / git ${email}? (other sessions may switch gh accounts — verify)`, true);
    if (!ok) {
      const pending = `identity not declared (declined) — run: ${hint}`;
      logger?.warn?.(`kj identity: ${pending}`);
      return { declared: false, identity: null, pending };
    }
  } finally {
    wizard.close();
  }
  const identity = writeIdentity(projectDir, { gh_user: gh, git_email: email });
  logger?.info?.(`kj identity: declared gh ${gh} / git ${email} → .karajan/identity.local.yml (ignored by git)`);
  return { declared: true, identity, pending: null };
}
