/**
 * `kj identity show|set` (IDN-A, KJC-TSK-0762, epic KJC-PCS-0079).
 *
 *   show  — declared identity vs what is ACTIVE now; exit 2 on mismatch or
 *           when nothing is declared (scriptable: the gate and hooks reuse it).
 *   set   — capture the effective gh account + git email (or --gh/--email),
 *           confirm on a TTY, write .karajan/identity.local.yml. Never invents:
 *           no session and no flags → exit 1.
 */

import { readIdentity, writeIdentity } from "../identity/store.js";
import { activeGhUser, effectiveGitEmail } from "../identity/detect.js";
import { compareIdentity } from "../identity/compare.js";
import { createWizard, isTTY } from "../utils/wizard.js";

export async function identityCommand({ action = "show", config, flags = {}, deps = {} }) {
  const projectDir = config?.projectDir || process.cwd();
  const log = deps.log || console.log;
  const tty = deps.isTTY || isTTY;
  const detectOpts = { hostsPath: deps.hostsPath, gitFn: deps.gitFn };
  const effective = {
    gh_user: activeGhUser(detectOpts.hostsPath ? { hostsPath: detectOpts.hostsPath } : {}),
    git_email: effectiveGitEmail(projectDir, detectOpts.gitFn ? { gitFn: detectOpts.gitFn } : {}),
  };

  if (action === "set") {
    const candidate = { gh_user: flags.gh || effective.gh_user, git_email: flags.email || effective.git_email };
    if (!candidate.gh_user || !candidate.git_email) {
      log(`kj identity: cannot declare — gh account: ${candidate.gh_user ?? "no session"}, git email: ${candidate.git_email ?? "none"}. Log in / set git config, or pass --gh <user> --email <email>.`);
      return 1;
    }
    if (tty() && !flags.yes) {
      const wizard = (deps.makeWizard || createWizard)();
      try {
        const ok = await wizard.confirm(`Bind this clone to gh ${candidate.gh_user} / git ${candidate.git_email}?`, true);
        if (!ok) { log("kj identity: not declared."); return 1; }
      } finally { wizard.close(); }
    } else if (!flags.gh || !flags.email) {
      // Proven live on day one: the active gh session had been flipped by
      // ANOTHER session, and --yes bound the clone to the wrong account.
      // Binding without confirmation is allowed, but never silent.
      log("kj identity: WARNING — binding the ACTIVE session as-is without confirmation (another session may have switched it); prefer --gh/--email explicitly and verify with `kj identity show`.");
    }
    writeIdentity(projectDir, candidate);
    log(`kj identity: declared gh ${candidate.gh_user} / git ${candidate.git_email} → .karajan/identity.local.yml (ignored by git).`);
    return 0;
  }

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
