// `kj install-tools` — install the external audit tools that `kj audit`
// and `kj webperf` rely on but does not bundle.
//
// Covers semgrep, osv-scanner, lighthouse, docker, sonar. Picks the
// install command per tool from `getInstallHint` (HU1) so the command
// matches the package manager available on the user's system.
//
// Lighthouse is stack-gated: by default we only prompt about it when
// the project is frontend/fullstack. Pass `--only lighthouse` to bypass
// the gate.
//
// Docker and sonar are special cases — see TOOL_HANDLERS below.

import readline from "node:readline";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { checkBinary } from "../utils/agent-detect.js";
import { getInstallHint, detectPackageManagers, appliesToStack, gitInstallPlan } from "../utils/install-hints.js";
import { detectProjectStack } from "../utils/stack-detect.js";
import { resolveStandalone } from "../utils/binary-sources.js";
import { downloadBinary, binDir, runInstallCommand } from "../utils/tool-installer.js";
import { dockerInstallPlan } from "../utils/docker-install.js";
import { collectPending, renderPendingBlock, PENDING_EXIT_CODE } from "../utils/pending-user-action.js";

const execFileAsync = promisify(execFile);

// git and the agent CLI lead the list: both are `kj doctor` *required* tools,
// so a blank machine wants them before the optional audit tools.
// KJC-TSK-0657: rtk/squeezr/qmd (token+context optimizers, previously
// init-only) complete the list — one pass leaves the machine 100%
// operational, per the quality-default-on product rule.
const ALL_TOOLS = ["git", "agent-cli", "semgrep", "osv-scanner", "lighthouse", "docker", "sonar", "rtk", "squeezr", "qmd"];

// Optimizer tools reuse the init installers (same {ok, version, error} contract).
const OPTIMIZER_INSTALLERS = {
  rtk: () => import("../utils/rtk-install.js").then((m) => m.installRtk),
  squeezr: () => import("../utils/squeezr-install.js").then((m) => m.installSqueezr),
  qmd: () => import("../utils/qmd-install.js").then((m) => m.installQmd),
};

// The default pipeline is coder=claude, reviewer=codex, so `agent-cli` installs
// exactly those two. gemini stays out of the default: it is a supported
// reviewer, not a required one. Both ship as global npm packages.
const AGENT_CLIS = [
  { bin: "claude", pkg: "@anthropic-ai/claude-code", url: "https://docs.anthropic.com/en/docs/claude-code" },
  { bin: "codex", pkg: "@openai/codex", url: "https://github.com/openai/codex" },
];

function parseOnlyList(raw) {
  if (!raw) return null;
  const wanted = String(raw).split(",").map((t) => t.trim()).filter(Boolean);
  const invalid = wanted.filter((t) => !ALL_TOOLS.includes(t));
  if (invalid.length > 0) {
    throw new Error(`Unknown tool(s) in --only: ${invalid.join(", ")}. Valid: ${ALL_TOOLS.join(", ")}`);
  }
  return wanted;
}

function promptYesNo(question, defaultYes = true) {
  return new Promise((resolve) => {
    if (!process.stdin.isTTY) { resolve(defaultYes); return; } // non-TTY → assume default
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const hint = defaultYes ? "Y/n" : "y/N";
    rl.question(`${question} [${hint}] `, (answer) => {
      rl.close();
      const a = (answer || "").trim().toLowerCase();
      if (!a) return resolve(defaultYes);
      resolve(a === "y" || a === "yes");
    });
  });
}

async function isInstalled(tool) {
  // sonar is a Docker container, not a binary. We check it separately
  // by looking at running containers via `docker ps`.
  if (tool === "sonar") return checkSonarRunning();
  // agent-cli is "installed" only when BOTH default-pipeline CLIs are present;
  // a partial install (one of two) still routes to handleAgentCli.
  if (tool === "agent-cli") {
    const present = await Promise.all(AGENT_CLIS.map(async (c) => (await checkBinary(c.bin)).ok));
    return present.every(Boolean);
  }
  if (tool === "lighthouse") return (await checkBinary("lighthouse")).ok;
  if (tool === "docker") return (await checkBinary("docker")).ok;
  return (await checkBinary(tool)).ok;
}

/**
 * Agent-CLI handler. Installs whichever of the default-pipeline CLIs
 * (coder=claude, reviewer=codex) are missing, via global npm. Opt-in with the
 * exact command shown first. When npm itself is absent we surface the manual
 * commands + URLs rather than failing silently.
 */
async function handleAgentCli({ available, dryRun, yes, logger }) {
  const missing = [];
  for (const cli of AGENT_CLIS) {
    if (!(await checkBinary(cli.bin)).ok) missing.push(cli);
  }
  if (missing.length === 0) return { tool: "agent-cli", action: "already-installed" };

  if (!available.npm) {
    const commands = missing.map((c) => `npm install -g ${c.pkg}`);
    logger.warn?.(`✗ agent-cli: npm not found — install manually: ${commands.join(" ; ")}`);
    return { tool: "agent-cli", action: "manual", reason: "npm not available", missing: missing.map((c) => c.bin), commands, manualUrls: missing.map((c) => c.url) };
  }

  const installed = [];
  for (const cli of missing) {
    const command = `npm install -g ${cli.pkg}`;
    if (dryRun) {
      logger.info?.(`▸ ${cli.bin}: would run \`${command}\``);
      installed.push({ bin: cli.bin, action: "dry-run", command });
      continue;
    }
    const proceed = yes || await promptYesNo(`Install ${cli.bin} with: ${command}?`);
    if (!proceed) {
      logger.info?.(`⊘ ${cli.bin}: declined`);
      installed.push({ bin: cli.bin, action: "declined", command });
      continue;
    }
    logger.info?.(`▸ ${cli.bin}: running \`${command}\`...`);
    const r = await runInstallCommand(command, { interactive: false });
    if (r.ok) { logger.info?.(`✓ ${cli.bin}: installed`); installed.push({ bin: cli.bin, action: "installed", command }); }
    else { const err = r.error || `exit ${r.code}`; logger.warn?.(`✗ ${cli.bin}: install failed (${err})`); installed.push({ bin: cli.bin, action: "failed", command, error: err }); }
  }

  const action = dryRun ? "dry-run"
    : installed.some((r) => r.action === "failed") ? "failed"
    : installed.some((r) => r.action === "installed") ? "installed"
    : "declined";
  return { tool: "agent-cli", action, installed };
}

/**
 * git handler. git installs through the OS package manager; on Linux that
 * needs root, so those runs go through the interactive (tty-inherited) path
 * where sudo prompts the user directly — kj never captures the password. The
 * exact command is shown first and the install is opt-in, defaulting to NO for
 * the privileged case. When no package manager matches, we surface the manual
 * download URL instead of failing silently.
 */
async function handleGit({ available, dryRun, yes, logger }) {
  const plan = gitInstallPlan(available);
  if (!plan.command) {
    logger.warn?.(`✗ git: no supported package manager here — install manually: ${plan.manualUrl}`);
    return { tool: "git", action: "manual", reason: "no supported package manager found", manualUrl: plan.manualUrl };
  }
  if (dryRun) {
    logger.info?.(`▸ git: would run \`${plan.command}\` (manager: ${plan.manager}${plan.needsSudo ? ", needs sudo" : ""})`);
    return { tool: "git", action: "dry-run", command: plan.command, manager: plan.manager };
  }
  if (plan.needsSudo) {
    logger.warn?.("git: this step needs sudo — you'll be prompted for your password on your own terminal (kj never sees it).");
  }
  const proceed = yes || await promptYesNo(`Install git with: ${plan.command}?`, !plan.needsSudo);
  if (!proceed) {
    logger.info?.("⊘ git: declined");
    return { tool: "git", action: "declined", command: plan.command };
  }
  logger.info?.(`▸ git: running \`${plan.command}\`...`);
  const r = await runInstallCommand(plan.command, { interactive: plan.needsSudo });
  if (r.ok) {
    logger.info?.(`✓ git: installed via ${plan.manager}`);
    return { tool: "git", action: "installed", manager: plan.manager };
  }
  const err = r.error || `exit ${r.code}`;
  logger.warn?.(`✗ git: install failed (${err})`);
  return { tool: "git", action: "failed", command: plan.command, error: err };
}

async function checkSonarRunning() {
  try {
    const { stdout } = await execFileAsync("docker", ["ps", "--format", "{{.Names}}", "--filter", "name=sonarqube"], { timeout: 5000 });
    return stdout.trim().length > 0;
  } catch { return false; }
}

async function runInstall(command) {
  // Split on whitespace (commands here are simple, no nested quoting).
  const [bin, ...args] = command.split(/\s+/);
  try {
    const { stdout, stderr } = await execFileAsync(bin, args, { timeout: 300_000, maxBuffer: 32 * 1024 * 1024 });
    return { ok: true, stdout, stderr };
  } catch (err) {
    return { ok: false, error: err?.shortMessage || err?.message || String(err), stderr: err?.stderr };
  }
}

/**
 * Sonar handler: special case. Cannot install Sonar via package manager;
 * the install is `docker compose -f <our-template> up -d` if Docker is
 * available. Falls back to a manual URL otherwise.
 */
async function handleSonar({ available, dryRun }) {
  if (!available.docker) {
    return {
      tool: "sonar",
      action: "manual",
      reason: "SonarQube runs as a Docker container — install Docker first (kj install-tools --only docker), then re-run.",
      manualUrl: "https://docs.docker.com/get-docker/",
    };
  }
  const composePath = path.join(process.cwd(), "docker-compose.yml");
  let composeExists = false;
  try { await fs.access(composePath); composeExists = true; } catch { /* missing */ }
  const command = composeExists
    ? "docker compose up -d"
    : "docker run -d --name sonarqube -p 9000:9000 sonarqube:lts-community";
  return {
    tool: "sonar",
    action: dryRun ? "dry-run" : "ready",
    command,
    manualUrl: "https://docs.sonarsource.com/sonarqube-community-build/try-out-sonarqube/",
  };
}

/**
 * Docker handler. On macOS/Windows we never auto-install — point at the docs.
 * On Linux we offer the distro package manager (apt/dnf) or, failing that, the
 * official convenience script downloaded to a file. The install runs through
 * `sudo` on the user's own tty (kj never sees the password) and is opt-in,
 * defaulting to NO, with the exact command shown first.
 */
async function handleDocker({ available, dryRun, yes, logger }) {
  const plan = dockerInstallPlan(process.platform, available);
  if (plan.kind === "manual") {
    logger.info?.(`▸ docker: ${plan.suggested || plan.manualUrl}`);
    return { tool: "docker", action: "manual", reason: "Docker install is platform-specific — see official docs.", manualUrl: plan.manualUrl, suggested: plan.suggested };
  }

  const shownCommand = plan.kind === "package" ? plan.command : `sudo sh <get-docker.sh from ${plan.url}>`;
  if (dryRun) {
    logger.info?.(`▸ docker: would run \`${shownCommand}\` (invasive, needs sudo)`);
    return { tool: "docker", action: "dry-run", command: shownCommand, via: plan.kind };
  }

  logger.warn?.("docker: this step is invasive and needs sudo — you'll be prompted for your password on your own terminal (kj never sees it).");
  const proceed = yes || await promptYesNo(`Install Docker with: ${shownCommand}?`, false);
  if (!proceed) {
    logger.info?.("⊘ docker: declined");
    return { tool: "docker", action: "declined", command: shownCommand };
  }

  if (plan.kind === "package") {
    logger.info?.(`▸ docker: running \`${plan.command}\`...`);
    const r = await runInstallCommand(plan.command, { interactive: true });
    if (r.ok) { logger.info?.(`✓ docker: installed via ${plan.manager}`); return { tool: "docker", action: "installed", via: "package", manager: plan.manager }; }
    const err = r.error || `exit ${r.code}`;
    logger.warn?.(`✗ docker: install failed (${err})`);
    return { tool: "docker", action: "failed", via: "package", error: err };
  }

  // script route: download to a temp file, then run with sudo — never `curl | sh`.
  const dl = await downloadBinary({ url: plan.url, name: "get-docker.sh", dir: os.tmpdir() });
  if (!dl.ok) { logger.warn?.(`✗ docker: script download failed (${dl.error})`); return { tool: "docker", action: "failed", via: "script", error: dl.error }; }
  logger.info?.(`▸ docker: running \`sudo sh ${dl.dest}\`...`);
  const r = await runInstallCommand(`sudo sh ${dl.dest}`, { interactive: true });
  if (r.ok) { logger.info?.("✓ docker: installed via get.docker.com"); return { tool: "docker", action: "installed", via: "script", dest: dl.dest }; }
  const err = r.error || `exit ${r.code}`;
  logger.warn?.(`✗ docker: install failed (${err})`);
  return { tool: "docker", action: "failed", via: "script", error: err };
}

/**
 * Standalone route when no package manager matched: download a static binary
 * (osv-scanner) or surface a concrete command to run (semgrep).
 */
async function handleStandalone({ tool, standalone, manualUrl, dryRun, yes, logger }) {
  if (standalone.kind === "command") {
    logger.warn?.(`✗ ${tool}: no package manager here. Try: ${standalone.command}  ·  \`kj doctor\` shows what's missing (docs: ${manualUrl})`);
    return { tool, action: "manual", reason: "no package manager — suggested route below", suggested: standalone.command, via: standalone.via, manualUrl };
  }
  // kind === "binary"
  const { url, name } = standalone;
  if (dryRun) {
    logger.info?.(`▸ ${tool}: would download ${url} → ${binDir()}`);
    return { tool, action: "dry-run", command: `download ${url}`, via: "binary" };
  }
  const proceed = yes || await promptYesNo(`Download ${tool} from ${url} into ${binDir()}?`);
  if (!proceed) {
    logger.info?.(`⊘ ${tool}: declined`);
    return { tool, action: "declined", command: `download ${url}` };
  }
  logger.info?.(`▸ ${tool}: downloading static binary...`);
  const r = await downloadBinary({ url, name });
  if (r.ok) {
    logger.info?.(`✓ ${tool}: installed → ${r.dest} (ensure ${binDir()} is on PATH)`);
    return { tool, action: "installed", via: "binary", dest: r.dest };
  }
  logger.warn?.(`✗ ${tool}: download failed (${r.error})`);
  return { tool, action: "failed", via: "binary", error: r.error };
}

/**
 * Plan + (optionally execute) the install of every requested tool.
 *
 * @param {Object} opts
 * @param {string|null} [opts.only] - comma-separated subset
 * @param {boolean} [opts.yes] - skip prompts
 * @param {boolean} [opts.dryRun] - plan-only, no execution
 * @param {Object} [opts.logger]
 * @returns {Promise<{ results: Array<Object>, exitCode: number }>}
 */
export async function installToolsCommand(opts = {}) {
  const only = parseOnlyList(opts.only);
  const yes = !!opts.yes;
  const dryRun = !!opts.dryRun;
  const logger = opts.logger || console;

  const targetTools = only || ALL_TOOLS;
  const available = await detectPackageManagers();
  const stack = await detectProjectStack(process.cwd()).catch(() => null);

  const results = [];
  for (const tool of targetTools) {
    // Stack gating — lighthouse on backend-only projects is skipped
    // UNLESS the user passed --only lighthouse explicitly.
    if (tool === "lighthouse" && !only && !appliesToStack(tool, stack)) {
      results.push({ tool, action: "skipped", reason: "no frontend stack detected" });
      logger.info?.(`⊘ ${tool}: skipped (no frontend stack detected; use --only lighthouse to force)`);
      continue;
    }

    if (await isInstalled(tool)) {
      results.push({ tool, action: "already-installed" });
      logger.info?.(`✓ ${tool}: already installed`);
      continue;
    }

    if (tool === "sonar") {
      const result = await handleSonar({ available, dryRun });
      results.push(result);
      if (result.action === "manual") logger.warn?.(`✗ sonar: ${result.reason}`);
      else logger.info?.(`▸ sonar: ${result.command}`);
      if (!dryRun && result.action === "ready") {
        const proceed = yes || await promptYesNo(`Start SonarQube with: ${result.command}?`);
        if (proceed) {
          const r = await runInstall(result.command);
          result.action = r.ok ? "installed" : "failed";
          if (!r.ok) result.error = r.error;
        }
      }
      continue;
    }

    if (OPTIMIZER_INSTALLERS[tool]) {
      if (dryRun) {
        results.push({ tool, action: "planned", command: `kj install-tools --only ${tool}` });
        logger.info?.(`▸ ${tool}: would install (init installer)`);
        continue;
      }
      const proceed = yes || await promptYesNo(`Install ${tool}?`);
      if (!proceed) { results.push({ tool, action: "declined" }); continue; }
      const install = await OPTIMIZER_INSTALLERS[tool]();
      const r = await install(logger);
      results.push(r.ok
        ? { tool, action: "installed", version: r.version }
        : { tool, action: "failed", error: r.error });
      continue;
    }

    if (tool === "git") {
      const result = await handleGit({ available, dryRun, yes, logger });
      results.push(result);
      continue;
    }

    if (tool === "agent-cli") {
      const result = await handleAgentCli({ available, dryRun, yes, logger });
      results.push(result);
      continue;
    }

    if (tool === "docker") {
      const result = await handleDocker({ available, dryRun, yes, logger });
      results.push(result);
      continue;
    }

    // semgrep / osv-scanner / lighthouse — package-manager driven.
    const hint = await getInstallHint(tool, available);
    if (!hint.command || !hint.manager) {
      // No package manager matched — try a standalone route (static binary
      // for osv-scanner, a concrete command for semgrep) before giving up.
      const standalone = resolveStandalone(tool, available);
      if (standalone) {
        const result = await handleStandalone({ tool, standalone, manualUrl: hint.manualUrl, dryRun, yes, logger });
        results.push(result);
        continue;
      }
      results.push({ tool, action: "manual", reason: "no compatible package manager found", manualUrl: hint.manualUrl, suggested: hint.command });
      logger.warn?.(`✗ ${tool}: no automatic install route here. Run \`kj doctor\` for options, or install manually: ${hint.manualUrl}`);
      continue;
    }
    if (dryRun) {
      results.push({ tool, action: "dry-run", command: hint.command, manager: hint.manager });
      logger.info?.(`▸ ${tool}: would run \`${hint.command}\` (manager: ${hint.manager})`);
      continue;
    }
    const proceed = yes || await promptYesNo(`Install ${tool} with: ${hint.command}?`);
    if (!proceed) {
      results.push({ tool, action: "declined", command: hint.command });
      logger.info?.(`⊘ ${tool}: declined`);
      continue;
    }
    logger.info?.(`▸ ${tool}: running \`${hint.command}\`...`);
    const r = await runInstall(hint.command);
    if (r.ok) {
      results.push({ tool, action: "installed", command: hint.command, manager: hint.manager });
      logger.info?.(`✓ ${tool}: installed via ${hint.manager}`);
    } else {
      results.push({ tool, action: "failed", command: hint.command, error: r.error });
      logger.warn?.(`✗ ${tool}: install failed (${r.error})`);
    }
  }

  // KJC-TSK-0659 stop-on-sudo: anything that still needs the user's hands
  // becomes ONE block with the exact per-OS commands, and a distinctive exit
  // code so a driving agent stops and waits instead of continuing degraded.
  const pending = dryRun ? [] : collectPending(results, { yes });
  if (pending.length > 0) {
    logger.warn?.(renderPendingBlock(pending));
    return { results, pending, exitCode: PENDING_EXIT_CODE };
  }
  const failures = results.filter((r) => r.action === "failed").length;
  return { results, pending, exitCode: failures > 0 ? 1 : 0 };
}

export const __test = { parseOnlyList, isInstalled, ALL_TOOLS };
