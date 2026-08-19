/**
 * `kj doctor` command. Runs the unified check runner and prints a
 * human-readable report by default. Supports flags:
 *
 *   --check-only   : only detect, do not apply fixes
 *   --yes / -y     : auto-confirm prompts for invasive remediations (CI mode)
 *   --json         : emit machine-readable JSON to stdout
 *   --verbose      : include fix hints and timing per check
 *
 * Exit code is 1 whenever any check ends with FAIL (including remediation
 * failures). WARN, OK, FIXED, SKIPPED and TIMEOUT do not fail the command.
 */

import readline from "node:readline";
import { runChecks as runCheckPipeline, toLegacyShape } from "../checks/runner.js";
import { collectGuaranteeFacts } from "../checks/guarantee-level.js";
import { STATUS } from "../checks/types.js";
import { getSystemChecks } from "../checks/system.js";
import { getConfigFileChecks } from "../checks/config-files.js";
import { getBinaryChecks } from "../checks/binaries.js";
import { getSonarChecks } from "../checks/sonar.js";
import { getOllamaChecks } from "../checks/ollama.js";
import { getHarnessScorecardChecks } from "../checks/harness-scorecard.js";
import { getCiChecks } from "../checks/ci.js";
import { getRtkChecks } from "../checks/rtk.js";
import { getSqueezrChecks } from "../checks/squeezr.js";
import { getAiTrashChecks } from "../checks/ai-trash.js";
import { getQmdChecks } from "../checks/qmd.js";
import { getRagHooksChecks } from "../checks/rag-hooks.js";
import { getNodeChecks } from "../checks/node.js";
import { getNativeBuildChecks } from "../checks/native-build.js";
import { getPortChecks } from "../checks/ports.js";
import { getTokenChecks } from "../checks/tokens.js";
import { getMcpHealthChecks } from "../checks/mcp-health.js";
import { getSkillsChecks } from "../checks/skills.js";
import { getDirSetupChecks } from "../checks/dir-setup.js";
import { getProjectChecks } from "../checks/project-checks.js";
import { getHardwareChecks } from "../checks/hardware.js";
import { getOrphanChecks } from "../checks/orphans.js";
import { getMethodChecks } from "../checks/method.js";

/**
 * Build the list of Check objects applicable to the current config.
 *
 * KJC-TSK-0393: cuando `projectOnly === true`, devuelve SOLO los project-aware
 * checks (signals, tools per signal, write perms, .env consistency, gh remote
 * access). Útil para validar un proyecto específico sin re-correr todos los
 * checks globales (CLIs, node, sonar, etc.).
 *
 * @param {Object} config
 * @param {{ projectOnly?: boolean }} [opts]
 * @returns {import("../checks/types.js").Check[]}
 */
function buildChecks(config, { projectOnly = false } = {}) {
  const projectDir = config?.projectDir || process.cwd();
  if (projectOnly) {
    return getProjectChecks({ projectDir });
  }
  return [
    ...getSystemChecks(),
    ...getNodeChecks(),
    ...getNativeBuildChecks(),
    ...getHardwareChecks(),
    ...getDirSetupChecks(),
    ...getConfigFileChecks(),
    ...getBinaryChecks(),
    ...getSonarChecks(),
    ...getOllamaChecks(),
    ...getHarnessScorecardChecks(),
    ...getPortChecks(),
    ...getTokenChecks(config),
    ...getMcpHealthChecks(),
    ...getSkillsChecks(),
    ...getCiChecks(),
    ...getRtkChecks(),
    ...getSqueezrChecks(),
    ...getAiTrashChecks(),
    ...getOrphanChecks(),
    ...getMethodChecks(),
    ...getQmdChecks(),
    ...getRagHooksChecks({ projectDir }),
    ...getProjectChecks({ projectDir }),
  ];
}

/**
 * Interactive terminal confirmation. Returns false when stdin is not a TTY
 * so non-interactive contexts don't hang forever.
 *
 * @param {string} describe
 * @returns {Promise<boolean>}
 */
function confirmViaTty(describe) {
  return new Promise((resolve) => {
    if (!process.stdin.isTTY) {
      resolve(false);
      return;
    }
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(`? ${describe} [y/N] `, (answer) => {
      rl.close();
      resolve(/^y(es)?$/i.test(answer.trim()));
    });
  });
}

/**
 * Run the full doctor pipeline without CLI formatting. Consumers that need
 * the raw report (preflight, status command) should use this.
 *
 * @param {{ config: Object, checkOnly?: boolean, yes?: boolean, onConfirm?: Function, logger?: Object }} args
 * @returns {Promise<import("../checks/types.js").RunReport>}
 */
async function runDoctor({ config, checkOnly = false, yes = false, onConfirm, logger, projectOnly = false }) {
  const checks = buildChecks(config, { projectOnly });
  return runCheckPipeline(checks, { config }, {
    mode: checkOnly ? "check-only" : "fix",
    yes,
    onConfirm: onConfirm ?? confirmViaTty,
    logger,
  });
}

/**
 * Legacy shape (backwards-compat for callers that still expect
 * {name,label,ok,detail,fix}). Kept public because tests and the CI gate
 * still rely on it.
 *
 * @param {{ config: Object }} args
 */
export async function runChecks({ config }) {
  const report = await runDoctor({ config });
  return toLegacyShape(report);
}

/**
 * `kj doctor` CLI entrypoint. Returns the exit code (0 OK, 1 when FAIL).
 *
 * @param {{ config: Object, checkOnly?: boolean, yes?: boolean, json?: boolean, verbose?: boolean }} args
 * @returns {Promise<number>}
 */
export async function doctorCommand({ config, checkOnly = false, yes = false, json = false, verbose = false, projectOnly = false }) {
  const report = await runDoctor({ config, checkOnly, yes, projectOnly });
  // KJC-TSK-0756 (campo, Pedro): el guarantee level del host actual se
  // DECLARA en runtime — la doctrina no vive solo en el README.
  report.guarantee = collectGuaranteeFacts({ projectDir: config?.projectDir || process.cwd() });

  if (json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printHuman(report, { verbose });
    printGuaranteeLevel(report.guarantee);
  }

  return hasBlockingFailure(report) ? 1 : 0;
}

// KJC-TSK-0756: la seccion de guarantee level — consola es el medio del
// doctor (excepcion no-console de commands).
function printGuaranteeLevel(g) {
  const mark = (t) => (t.active ? "ACTIVE " : "OFF    ");
  console.log();
  console.log(`Guarantee level (host: ${g.host ?? "desconocido"}) — kj jamas finge una supervision que no puede aplicar:`);
  console.log(`  ${mark(g.tierA)} A tool-time (Sentinel en el turno): ${g.tierA.reason}`);
  console.log(`  ${mark(g.tierB)} B commit-time (git gates, el SUELO): ${g.tierB.reason}`);
  console.log(`  ${mark(g.tierC)} C merge-time (re-check en CI): ${g.tierC.reason}`);
}

function hasBlockingFailure(report) {
  return report.checks.some((c) => c.status === STATUS.FAIL || c.status === STATUS.TIMEOUT);
}

function statusIcon(status) {
  switch (status) {
    case STATUS.OK: return "OK   ";
    case STATUS.FIXED: return "FIXED";
    case STATUS.WARN: return "WARN ";
    case STATUS.FAIL: return "FAIL ";
    case STATUS.SKIPPED: return "SKIP ";
    case STATUS.TIMEOUT: return "TIME ";
    default: return "?    ";
  }
}

// The `kj` binary bundles no toolchain: it orchestrates external tools. So
// beyond the per-check wall, spell out what is *required* to run kj at all
// (git + at least one agent CLI) versus what is *optional* (enables extra
// features). We derive the verdict from the checks already collected rather
// than re-probing, so it always agrees with the lines printed above.
function printPrerequisites(report) {
  const git = report.checks.find((c) => c.name === "git");
  const agents = report.checks.filter((c) => c.name?.startsWith("agent:"));
  const okAgent = agents.find((c) => c.status === STATUS.OK);
  const mark = (ok) => (ok ? "OK" : "MISSING");

  const gitOk = git?.status === STATUS.OK;
  const agentLabel = okAgent
    ? `OK (${okAgent.label.replace(/^Agent:\s*/, "")})`
    : "MISSING — install Claude Code, Codex or Gemini";

  console.log();
  console.log("Prerequisites (kj orchestrates external tools, it bundles none):");
  console.log(`  Required: git ${mark(gitOk)}; agent CLI ${agentLabel}`);
  console.log("  Optional: Docker (local models, SonarQube); Node/npm (helper tools: Squeezr, qmd)");
}

function printHuman(report, { verbose }) {
  for (const check of report.checks) {
    console.log(`${statusIcon(check.status)} ${check.label}: ${check.detail}`);
    if (check.fix && (check.status === STATUS.FAIL || check.status === STATUS.WARN || verbose)) {
      console.log(`     -> ${check.fix}`);
    }
    if (verbose) {
      console.log(`     (${check.runMs}ms, strategy=${check.strategy})`);
    }
  }

  const s = report.summary;
  const total = s.ok + s.fixed + s.warn + s.fail + s.skipped + s.timeout;
  console.log();
  if (s.fail === 0 && s.timeout === 0) {
    const label = s.fixed > 0 ? `All checks passed (${s.fixed} auto-fixed)` : "All checks passed.";
    console.log(label);
  } else {
    console.log(
      `${s.fail + s.timeout} issue(s) found, ${s.fixed} auto-fixed, ${s.warn} warnings, ${s.skipped} skipped out of ${total}.`
    );
  }
  if (Object.keys(report.overrides).length > 0) {
    console.log(`Runtime overrides applied: ${JSON.stringify(report.overrides)}`);
  }

  printPrerequisites(report);

  // KJC-TSK v2.18 — if any external audit tool (semgrep, osv-scanner,
  // lighthouse) reported missing, surface the one-line remediation so
  // the user doesn't have to dig the fix lines out of the wall of
  // checks. The audit-tool checks emit names like "audit-tool:semgrep"
  // and embed { tool, suggested } in `extra` (see binaries.js).
  const installable = report.checks
    .filter((c) => c.name?.startsWith("audit-tool:") && c.status === STATUS.WARN && c.extra?.tool)
    .map((c) => c.extra.tool);
  if (installable.length > 0) {
    console.log();
    const list = installable.join(", ");
    const only = installable.length === 1 ? ` --only ${installable[0]}` : "";
    console.log(`Tip: run \`kj install-tools${only}\` to install: ${list}.`);
  }
}

export const __test = { printHuman, printPrerequisites };
