/**
 * `kj review --staged | --check | --range` (ENV-B1, KJC-TSK-0637) — the v4
 * cross-AI review gate. Unlike the legacy task-review mode, this reviews a
 * raw git diff with an AI DIFFERENT from the host agent and records the
 * verdict tied to the exact diff (verdict-store), so the pre-commit hook
 * (ENV-C) can verify it. Exit code 0 = approved, 1 = rejected/stale.
 */
import { existsSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { runCommand } from "../utils/process.js";
import { checkVerdict, diffHash } from "../review/verdict-store.js";
import { runOneShotReview } from "../review/one-shot-review.js";
import { runSolomonArbitration } from "../review/solomon-arbitration.js";
import { ensureGateTrackable } from "../review/gate-gitignore.js";
import { runSonarPregate, formatSonarFinding } from "../review/sonar-pregate.js";
import { checkCardFirst } from "../review/card-first.js";
import { checkTestsWithCode } from "../review/tests-with-code.js";
import { loadPrivacyList, scanText } from "../privacy/scan.js";
import { checkStagedDiff, loadPolicy } from "../policy/engine.js";
import { loadStandingExceptions, recordPolicyException } from "../policy/exceptions.js";
import { policyFileHash, recordGateDecision } from "../policy/decisions.js";
import { evaluatePolicyGate } from "../review/policy-gate.js";

// KJC-TSK-0686 (MG-A): card-first is a gate, not a habit. Runs on --staged
// (before spending sonar/reviewer effort) AND on --check — the pre-commit
// hook already calls --check, so existing projects gain the gate with a
// simple package update, no hook regeneration.
async function enforceCardFirst({ config, projectDir }) {
  const branchRes = await runCommand("git", ["rev-parse", "--abbrev-ref", "HEAD"]);
  const branch = branchRes.stdout?.trim() || "HEAD";
  const card = await checkCardFirst({ config, projectDir, branch });
  if (card.mode === "warn") console.log(`⚠ card-first: ${card.reason}`);
  // KJC-TSK-0732: the verification LEVEL is part of the verdict — a pass on
  // branch-ref alone must never read as a tracker-verified pass.
  if (card.note) console.log(`⚠ card-first: ${card.note}`);
  if (card.mode === "exempt" && card.reason.includes("KJ_ALLOW_NO_CARD")) console.log(`⚠ card-first exempt: ${card.reason}`);
  if (!card.ok) {
    console.log(`✗ card-first gate: ${card.reason}`);
    process.exitCode = 1;
  }
  return card;
}

// Raw git always — never a wrapped/compressing runner (KJC-BUG-0115).
async function rawDiff(range, extraArgs = []) {
  const args = range ? ["diff", range, ...extraArgs] : ["diff", "--cached", ...extraArgs];
  const res = await runCommand("git", args);
  if (res.exitCode !== 0) {
    throw new Error(res.stderr?.trim() || `git ${args.join(" ")} failed`);
  }
  return res.stdout;
}

function printVerdict(record) {
  if (record.verdict === "approved") {
    const ws = record.workspace ? ` [${record.workspace}]` : "";
    console.log(`✓ APPROVED by ${record.reviewer} (diff ${record.diffHash.slice(0, 12)})${ws}`);
    if (record.summary) console.log(`  ${record.summary}`);
    return;
  }
  console.log(`✗ REJECTED by ${record.reviewer} — ${record.issues.length} blocking issue(s):`);
  for (const issue of record.issues) {
    let where = "";
    if (issue.file) {
      const line = issue.line ? `:${issue.line}` : "";
      where = ` [${issue.file}${line}]`;
    }
    console.log(`  - (${issue.severity || "high"})${where} ${issue.description || issue.id}`);
    if (issue.suggested_fix) console.log(`    fix: ${issue.suggested_fix}`);
  }
  console.log("Fix the issues and run `kj review --staged` again — the verdict is tied to the exact diff.");
}

/**
 * `kj solomon --position "<why>"` (AB-E, KJC-TSK-0651) — the brain asks a
 * third AI to arbitrate a rejected verdict it disagrees with. Exit 0 =
 * approve (gate opens), 1 = reject (obey the reviewer and fix).
 */
export async function solomonCommand({ config, logger = null, flags = {} }) {
  const projectDir = config?.projectDir || process.cwd();
  const diff = await rawDiff(flags.range);
  // KJC-TSK-0734 (PL-B): un hallazgo de policy de clase seguridad no es
  // arbitrable — solomon se niega antes de gastar un token. Y una policy
  // inválida cierra el arbitraje en vez de abrirlo (fail closed, catch de
  // codex: un `sec` vacío por error de carga NO puede significar "adelante").
  const files = (await rawDiff(flags.range, ["--name-only"])).split("\n").map((f) => f.trim()).filter(Boolean);
  const pol = loadPolicy({ projectDir });
  if (pol.errors.length > 0) {
    for (const e of pol.errors) console.log(`✗ ${e}`);
    console.log("⚖ Solomon no arbitra con policy.yml inválida — corrígela primero: una regla que miente es peor que ninguna.");
    process.exitCode = 1;
    return { ruling: "reject", reasoning: "invalid policy.yml — arbitration refused (fail closed)" };
  }
  const sec = checkStagedDiff(pol.policy, { files, netLinesAdded: 0 }).filter((v) => v.class === "security" && v.enforcement === "deny");
  if (sec.length > 0) {
    for (const v of sec) {
      const where = v.file ? ` (${v.file})` : "";
      console.log(`✗ policy [${v.rule_id}] ${v.reason}${where}`);
    }
    console.log("⚖ Solomon no arbitra hallazgos de clase seguridad — resuélvelos; la regla no es negociable.");
    process.exitCode = 1;
    return { ruling: "reject", reasoning: "security-class policy denial — not arbitrable" };
  }
  const res = await runSolomonArbitration({ diff, position: flags.position, config, logger, projectDir });
  if (res.ruling === "approve") {
    console.log(`⚖ Solomon (${res.solomon}) rules for the brain — verdict recorded, the gate is open.`);
  } else {
    const who = res.solomon ? ` (${res.solomon})` : "";
    console.log(`⚖ Solomon${who} rules for the reviewer — obey and fix:`);
  }
  if (res.reasoning) console.log(`  ${res.reasoning}`);
  process.exitCode = res.ruling === "approve" ? 0 : 1;
  return res;
}

export async function reviewGateCommand({ config, logger = null, flags = {} }) {
  const projectDir = config?.projectDir || process.cwd();

  if (flags.installGate) {
    const fs = await import("node:fs/promises");
    const marker = join(projectDir, ".karajan", "review-gate");
    await fs.mkdir(join(projectDir, ".karajan"), { recursive: true });
    await fs.writeFile(marker, "# Cross-AI review gate enabled (ENV-C1). Commit this file so the whole team inherits the gate.\n");
    console.log("✓ review gate enabled — commits now require an approved cross-AI verdict (kj review --staged)");
    // KJC-TSK-0646: a `.karajan/` dir-exclude would silently keep the
    // contract out of git — rewrite it so the team actually inherits it.
    const gi = await ensureGateTrackable(projectDir);
    if (gi.changed) {
      console.log("✓ .gitignore adjusted: the gate contract (.karajan/review-gate, hooks) is now trackable — commit it");
    }
    const hookProbe = await runCommand("git", ["config", "core.hooksPath"]);
    if (!hookProbe.stdout?.trim()) {
      console.log("⚠ no core.hooksPath configured — run `kj harden` so the pre-commit hook enforces the gate");
    }
    return { installed: true };
  }

  const diff = await rawDiff(flags.range);

  const card = await enforceCardFirst({ config, projectDir });
  if (!card.ok) return { verdict: "rejected", reviewer: "card-first", issues: [{ severity: "high", description: card.reason }] };

  // KJC-TSK-0687 (MG-B): the verifiable half of TDD — sources without a
  // single test change warn (block via method_gates.tests_with_code).
  const changedFiles = (await rawDiff(flags.range, ["--name-only"])).split("\n").map((f) => f.trim()).filter(Boolean);

  // KJC-TSK-0688 (MG-C) + KJC-TSK-0691 (MG-E): oversized-diff policy.
  // Field case: a 522-line PR sailed past the warning with a
  // rationalization — where the project wants teeth, pr_size: "block"
  // rejects deterministically with a NAMED escape. Default stays warn.
  // PL-C (KJC-TSK-0735), fuente única de umbrales: si la policy declara el
  // invariante net_lines_added, SU max es el umbral — el mismo número que
  // aplican kj policy check y el tier C de CI; method_gates queda de fallback.
  const pol = loadPolicy({ projectDir });
  const locInv = pol.errors.length === 0
    ? (pol.policy.invariants || []).find((i) => i.kind === "diff-threshold" && i.metric === "net_lines_added")
    : null;
  const sizeWarn = locInv?.max ?? config?.method_gates?.pr_size_warn ?? 150;
  const sizeSource = locInv ? `policy [${locInv.id}]` : "method_gates";
  if (sizeWarn > 0) {
    const numstat = await rawDiff(flags.range, ["--numstat"]);
    const added = numstat.split("\n").reduce((acc, l) => acc + (Number(l.split("\t")[0]) || 0), 0);
    if (added > sizeWarn) {
      const sizePolicy = config?.method_gates?.pr_size || "warn";
      if (process.env.KJ_ALLOW_LARGE_PR === "1") {
        console.log(`⚠ pr-size exempt: ${added} lines added — KJ_ALLOW_LARGE_PR=1 (explicit escape hatch)`);
      } else if (sizePolicy === "block") {
        const reason = `${added} lines added exceeds the ${sizeWarn}-line budget (${sizeSource}; method_gates.pr_size: block) — partition the work, or get your user's explicit OK and re-run with KJ_ALLOW_LARGE_PR=1`;
        console.log(`✗ pr-size gate: ${reason}`);
        process.exitCode = 1;
        return { verdict: "rejected", reviewer: "pr-size", issues: [{ severity: "high", description: reason }] };
      } else {
        console.log(`⚠ pr-size: ${added} lines added (guideline ~${sizeWarn}, source: ${sizeSource}) — an oversized warning is not an opinion: partition, or ask your user (method_gates.pr_size: block to harden)`);
      }
    }
  }
  // KJC-TSK-0705 (PV-B): the outbound privacy boundary at commit time.
  // Denylist data rejects (KJ_ALLOW_PII=1 is the named escape); generic PII
  // warns (privacy.generic: "block" hardens). Added lines only — deletions
  // don't publish. In the SEA binary the privacy module is stubbed and
  // throws: the gate degrades with a note instead of crashing.
  try {
    const added = diff.split("\n").filter((l) => l.startsWith("+") && !l.startsWith("+++")).map((l) => l.slice(1)).join("\n");
    const findings = scanText(added, { list: loadPrivacyList(), source: "<staged diff>" });
    const blocks = findings.filter((f) => f.severity === "block");
    const warns = findings.filter((f) => f.severity === "warn");
    for (const f of warns) console.log(`⚠ privacy: [${f.type}] added line ${f.line} → ${f.masked} — personal data? move it out before it ships`);
    const hardened = config?.privacy?.generic === "block" && warns.length > 0;
    if (blocks.length > 0 || hardened) {
      if (process.env.KJ_ALLOW_PII === "1") {
        console.log(`⚠ privacy exempt: ${blocks.length} denylist hit(s) — KJ_ALLOW_PII=1 (explicit escape hatch)`);
      } else {
        for (const f of blocks) console.log(`✗ privacy: [${f.type}] on added line ${f.line} → ${f.masked}`);
        const reason = `${blocks.length || warns.length} personal-data finding(s) in the staged diff — this must not reach the repo (KJ_ALLOW_PII=1 to override consciously)`;
        console.log(`✗ privacy gate: ${reason}`);
        process.exitCode = 1;
        return { verdict: "rejected", reviewer: "privacy", issues: [{ severity: "high", description: reason }] };
      }
    }
  } catch (err) {
    // Known degradation: the SEA stub throws its install-from-npm message.
    // Anything else fails CLOSED — a silent skip would defeat the guarantee.
    if (/standalone binary/i.test(err?.message || "")) {
      console.log("⚠ privacy gate unavailable in this build — skipping");
    } else if (process.env.KJ_ALLOW_PII === "1") {
      console.log(`⚠ privacy gate errored (${err.message}) — KJ_ALLOW_PII=1 (explicit escape hatch)`);
    } else {
      const reason = `privacy gate error: ${err.message} — refusing to pass the boundary unchecked (KJ_ALLOW_PII=1 to override consciously)`;
      console.log(`✗ ${reason}`);
      process.exitCode = 1;
      return { verdict: "rejected", reviewer: "privacy", issues: [{ severity: "high", description: reason }] };
    }
  }

  const tests = checkTestsWithCode({ config, stagedFiles: changedFiles });
  if (tests.mode === "warn") console.log(`⚠ tests-with-code: ${tests.reason}`);
  if (tests.mode === "exempt") console.log(`⚠ tests-with-code exempt: ${tests.reason}`);
  if (!tests.ok) {
    console.log(`✗ tests-with-code gate: ${tests.reason}`);
    process.exitCode = 1;
    return { verdict: "rejected", reviewer: "tests-with-code", issues: [{ severity: "high", description: tests.reason }] };
  }

  // KJC-TSK-0734 (PL-B): la policy declarativa como gate determinista, en
  // --staged Y en --check — el pre-commit hereda los dientes sin regenerar
  // hooks. enforcement=warn avisa; deny cierra salvo excepción probatoria
  // (KJ_ALLOW_POLICY=1 + KJ_POLICY_REASON, registrada con identidad y hash
  // del diff); class=security cierra sin escape y sin arbitraje.
  let net = 0;
  for (const l of (await rawDiff(flags.range, ["--numstat"])).split("\n")) {
    const [a, r] = l.trim().split(/\s+/);
    if (a && a !== "-") net += Number(a) || 0;
    if (r && r !== "-") net -= Number(r) || 0;
  }
  // GOV-B (KJC-TSK-0746): las permanentes concedidas (kj policy grant)
  // eximen su regla mientras viven; el descarte de líneas corruptas se dice.
  const std = loadStandingExceptions(projectDir);
  if (std.discarded > 0) console.log(`⚠ policy: ${std.discarded} línea(s) corruptas descartadas en policy-exceptions.jsonl — revísalo`);
  const gate = evaluatePolicyGate({
    policy: pol.policy, errors: pol.errors, files: changedFiles, netLinesAdded: net,
    diffHashValue: diffHash(diff),
    recordException: (entry) => recordPolicyException({ projectDir, entry }),
    standingExceptions: std.standing,
  });
  const at = (v) => (v.file ? ` (${v.file})` : "");
  for (const w of gate.warns) console.log(`⚠ policy [${w.rule_id}] ${w.reason}${at(w)}`);
  for (const e of gate.exempted) {
    console.log(e.standing
      ? `⚠ policy standing [${e.rule_id}] — excepción permanente viva hasta ${e.standing.expiresAt} (${e.standing.justification || "sin justificación"})`
      : `⚠ policy exempt [${e.rule_id}] — excepción registrada en .karajan/policy-exceptions.jsonl (${e.justification})`);
  }
  // GOV-C (KJC-TSK-0747): las decisiones de chokepoint dejan rastro
  // hash-encadenado — cada deny, cada excepción, y el allow del commit.
  const chokepoint = flags.check ? "commit" : "review";
  const seal = (decision, extra = {}) =>
    recordGateDecision(projectDir, { decision, chokepoint, policy_hash: policyFileHash(projectDir), artifact_hash: diffHash(diff), ...extra });
  if (gate.exempted.length > 0) seal("exempt", { rule_ids: gate.exempted.map((e) => e.rule_id) });
  if (!gate.ok) {
    for (const d of gate.denials) {
      const sec = d.class === "security" ? " [security — sin escape ni arbitraje]" : "";
      console.log(`✗ policy [${d.rule_id}]${sec} ${d.reason}${at(d)}`);
    }
    seal("deny", { rule_ids: gate.denials.map((d) => d.rule_id) });
    const reason = gate.invalid
      ? "policy.yml inválida — una regla que miente es peor que ninguna: corrígela"
      : `${gate.denials.length} violación(es) de policy con enforcement=deny — el diff no entra`;
    console.log(`✗ policy gate: ${reason}`);
    process.exitCode = 1;
    return { verdict: "rejected", reviewer: "policy", issues: gate.denials.map((d) => ({ severity: "high", file: d.file, description: `[${d.rule_id}] ${d.reason}` })) };
  }

  if (flags.check) {
    // KJC-BUG-0132 (issue #1344): a PURE merge commit stages no content of
    // its own — everything it brings reached the parent branches already
    // reviewed, and there is no diff to bind a verdict to, so demanding one
    // deadlocks the merge. A merge WITH conflict resolutions stages real
    // content and still requires its verdict below.
    if (!flags.range && !diff.trim()) {
      const gitDirRaw = (await runCommand("git", ["rev-parse", "--git-dir"])).stdout?.trim();
      const gitDir = gitDirRaw && !isAbsolute(gitDirRaw) ? join(projectDir, gitDirRaw) : gitDirRaw;
      if (gitDir && existsSync(join(gitDir, "MERGE_HEAD"))) {
        console.log("✓ pure merge commit — empty staged diff, parents already reviewed; gate passes with trail");
        process.exitCode = 0;
        return { ok: true, merge: true, reason: "pure merge commit (MERGE_HEAD, empty staged diff)" };
      }
    }
    const res = await checkVerdict(projectDir, diff);
    console.log(res.ok
      ? `✓ verdict ok — approved by ${res.verdict.reviewer} (diff ${res.verdict.diffHash.slice(0, 12)})`
      : `✗ ${res.reason}`);
    // GOV-C: el allow del chokepoint de COMMIT es evidencia — se sella.
    if (res.ok) seal("allow");
    process.exitCode = res.ok ? 0 : 1;
    return res;
  }

  // KJC-TSK-0676: deterministic pre-gate — sonar findings on the changed
  // files come back BEFORE any AI opinion. Blocking severities reject
  // without spending reviewer tokens; the rest travel with the task so
  // the cross-AI reviewer weighs them. Unavailable sonar degrades loudly.
  let task = flags.task;
  if (flags.sonar !== false) {
    const pre = await runSonarPregate({ config, stagedFiles: changedFiles, logger });
    if (!pre.available) {
      console.log(`⚠ sonar pre-gate skipped: ${pre.reason}`);
    } else {
      const found = [...pre.blocking, ...pre.advisory];
      if (found.length > 0) {
        console.log(`Sonar on the changed files — ${pre.blocking.length} blocking, ${pre.advisory.length} advisory (project total: ${pre.totalProject}):`);
        for (const f of found) console.log(`  - ${formatSonarFinding(f)}`);
      }
      if (pre.blocking.length > 0) {
        console.log("✗ REJECTED by sonar (deterministic) — fix the blocking findings; the cross-AI reviewer was not invoked.");
        process.exitCode = 1;
        return {
          verdict: "rejected", reviewer: "sonar",
          issues: pre.blocking.map((i) => ({ severity: i.severity, file: undefined, description: formatSonarFinding(i) })),
        };
      }
      if (pre.advisory.length > 0) {
        task = `${task || "Review the following diff for correctness, security and maintainability."}\n\n`
          + `Deterministic Sonar findings on these files (fold them into your review):\n`
          + pre.advisory.map((f) => `- ${formatSonarFinding(f)}`).join("\n");
      }
    }
  }

  const record = await runOneShotReview({ diff, task, config, logger, projectDir });
  printVerdict(record);
  process.exitCode = record.verdict === "approved" ? 0 : 1;
  return record;
}
