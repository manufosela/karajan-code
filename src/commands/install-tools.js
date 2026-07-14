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
import { getInstallHint, detectPackageManagers, appliesToStack } from "../utils/install-hints.js";
import { detectProjectStack } from "../utils/stack-detect.js";
import { resolveStandalone } from "../utils/binary-sources.js";
import { downloadBinary, binDir, runInstallCommand } from "../utils/tool-installer.js";
import { dockerInstallPlan } from "../utils/docker-install.js";

const execFileAsync = promisify(execFile);

const ALL_TOOLS = ["semgrep", "osv-scanner", "lighthouse", "docker", "sonar"];

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
  if (tool === "lighthouse") return (await checkBinary("lighthouse")).ok;
  if (tool === "docker") return (await checkBinary("docker")).ok;
  return (await checkBinary(tool)).ok;
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
      reason: "docker not available — sonar needs docker. Install docker first.",
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
    logger.warn?.(`✗ ${tool}: no package manager. Try: ${standalone.command}  (docs: ${manualUrl})`);
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
      logger.info?.(`▸ sonar: ${result.command || result.manualUrl}`);
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
      logger.warn?.(`✗ ${tool}: no compatible package manager. Manual: ${hint.manualUrl}`);
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

  const failures = results.filter((r) => r.action === "failed").length;
  return { results, exitCode: failures > 0 ? 1 : 0 };
}

export const __test = { parseOnlyList, isInstalled, ALL_TOOLS };
