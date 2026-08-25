import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { getConfigPath, getProjectConfigPath, loadConfig, writeConfig } from "../config.js";
import { sonarUp, checkVmMaxMapCount } from "../sonar/manager.js";
import { ollamaUp, waitForOllamaReady, normalizeOllamaConfig } from "../rag/ollama-manager.js";
import { checkOllamaCapability, pullOllamaModel } from "../rag/ollama-capability.js";
import { exists, ensureDir } from "../utils/fs.js";
import { ensureContractBlockPresent } from "../review/gate-gitignore.js";
import { getKarajanHome } from "../utils/paths.js";
import { getTemplatesRoot } from "../utils/templates-root.js";
import { detectAvailableAgents } from "../utils/agent-detect.js";
import { createWizard, isTTY } from "../utils/wizard.js";
import { runCommand } from "../utils/process.js";
import { getInstallCommand } from "../utils/os-detect.js";
import { detectOsLocale, SUPPORTED_LANGUAGES } from "../utils/locale.js";
import { buildTelemetryPayload, sendTelemetryEvent } from "../utils/telemetry.js";
import { detectRtk } from "../utils/rtk-detect.js";
import { installRtk } from "../utils/rtk-install.js";
import { detectSqueezr } from "../utils/squeezr-detect.js";
import { installSqueezr } from "../utils/squeezr-install.js";
import { detectAiTrash, installAiTrashHook } from "../utils/ai-trash.js";
import { detectQmd } from "../utils/qmd-detect.js";
import { installQmd } from "../utils/qmd-install.js";
import { registerQmdCollections } from "../utils/qmd-collection.js";
import { isGitRepo } from "../harden/harden-engine.js";
import { hardenCommand } from "./harden.js";
import { detectProjectStack } from "../utils/stack-detect.js";
import { bootstrapSonarToken } from "../sonar/token-bootstrap.js";

/**
 * Roles asked individually after coder/reviewer. Each entry:
 *   - key: config.roles.<key>.provider
 *   - pipelineKey: config.pipeline.<key>.enabled (omit when not gated by a flag)
 *   - default: which role's CLI to inherit ("coder" | "reviewer")
 *   - allowDisable: true if "off" is a valid choice
 *
 * Order matters — keep the most-impactful first so the wizard never hides
 * critical roles behind a long tail of opt-ins.
 */
const PER_ROLE_QUESTIONS = [
  { key: "planner",     pipelineKey: "planner",     default: "coder",    allowDisable: true,  label: "Planner (decomposes complex tasks into HUs)" },
  { key: "researcher",  pipelineKey: "researcher",  default: "coder",    allowDisable: true,  label: "Researcher (explores codebase before coding)" },
  { key: "architect",   pipelineKey: "architect",   default: "coder",    allowDisable: true,  label: "Architect (designs solution + contracts)" },
  { key: "tester",      pipelineKey: "tester",      default: "coder",    allowDisable: false, label: "Tester (verifies tests + coverage)" },
  { key: "security",    pipelineKey: "security",    default: "coder",    allowDisable: false, label: "Security (OWASP audit)" },
  { key: "solomon",     pipelineKey: "solomon",     default: "reviewer", allowDisable: false, label: "Solomon (judge AI for dilemmas)" },
  { key: "refactorer",  pipelineKey: "refactorer",  default: "coder",    allowDisable: true,  label: "Refactorer (clarity passes)" },
  { key: "impeccable",  pipelineKey: "impeccable",  default: "coder",    allowDisable: true,  label: "Impeccable (UI/UX audit — frontend only)" },
  { key: "perf",        pipelineKey: "perf",        default: "coder",    allowDisable: true,  label: "Perf (Core Web Vitals gate — frontend only)" },
  { key: "hu_reviewer", pipelineKey: "hu_reviewer", default: "reviewer", allowDisable: true,  label: "HU Reviewer (mandatory user-story certification)" },
];

// ---- Sub-asks ----

async function askAgents(wizard, available, config, logger) {
  if (available.length === 1) {
    const only = available[0].name;
    logger.info(`Only one agent available: ${only}. Using it for all roles.\n`);
    config.coder = only;
    config.reviewer = only;
    config.roles.coder.provider = only;
    config.roles.reviewer.provider = only;
    return { coder: only, reviewer: only };
  }

  const agentOptions = available.map((a) => ({
    label: `${a.name} (${a.version})`,
    value: a.name,
    available: true,
  }));

  const coder = await wizard.select("Select default CODER agent:", agentOptions);
  config.coder = coder;
  config.roles.coder.provider = coder;
  logger.info(`  -> Coder: ${coder}`);

  const reviewer = await wizard.select("Select default REVIEWER agent:", agentOptions);
  config.reviewer = reviewer;
  config.roles.reviewer.provider = reviewer;
  logger.info(`  -> Reviewer: ${reviewer}`);

  return { coder, reviewer };
}

/**
 * For each non-coder/non-reviewer role, ask: use coder default | use reviewer
 * default | pick a specific CLI | (when allowed) disable. The choice is
 * persisted as `config.roles.<role>.provider` (null means "inherit from
 * coder" at runtime). Pipeline-flag-gated roles also flip
 * `config.pipeline.<role>.enabled`.
 *
 * `available.length === 1` short-circuits: every role uses the only CLI
 * available, no point asking.
 */
async function askPerRoleProviders(wizard, available, config, { coder, reviewer }, logger, ask = true) {
  if (available.length <= 1) return;

  // Make sure containers exist for every role/pipeline key we touch —
  // older configs may have a sparser shape than DEFAULTS.
  config.roles = config.roles || {};
  config.pipeline = config.pipeline || {};

  // KJC-TSK-0571: per-role provider selection is advanced. By default every
  // role inherits its provider from coder/reviewer — a newcomer has no context
  // to pick an agent for "refactorer" or "perf". Only init the containers.
  if (!ask) {
    for (const role of PER_ROLE_QUESTIONS) {
      config.roles[role.key] = config.roles[role.key] || { provider: null, model: null };
      if (role.pipelineKey) config.pipeline[role.pipelineKey] = config.pipeline[role.pipelineKey] || { enabled: false };
    }
    logger.info("  Agent routing: every role inherits from your coder/reviewer (default).");
    return;
  }

  logger.info("");
  logger.info("Configure provider per role (Enter accepts the default):");

  for (const role of PER_ROLE_QUESTIONS) {
    config.roles[role.key] = config.roles[role.key] || { provider: null, model: null };
    if (role.pipelineKey) {
      config.pipeline[role.pipelineKey] = config.pipeline[role.pipelineKey] || { enabled: false };
    }

    const defaultLabel = role.default === "coder" ? `coder (${coder})` : `reviewer (${reviewer})`;
    const baseOptions = [
      { label: `Use ${defaultLabel} — default`, value: "__default__", available: true },
    ];
    for (const a of available) {
      if ((role.default === "coder" && a.name === coder) || (role.default === "reviewer" && a.name === reviewer)) continue;
      baseOptions.push({ label: a.name, value: a.name, available: true });
    }
    if (role.allowDisable) {
      baseOptions.push({ label: "Disable role", value: "__disabled__", available: true });
    }

    const choice = await wizard.select(`  ${role.label}:`, baseOptions);

    if (choice === "__disabled__") {
      if (role.pipelineKey) config.pipeline[role.pipelineKey].enabled = false;
      logger.info(`    -> ${role.key}: disabled`);
    } else if (choice === "__default__") {
      // Inherit from coder/reviewer at runtime — leave provider null.
      config.roles[role.key].provider = null;
      if (role.pipelineKey) config.pipeline[role.pipelineKey].enabled = true;
      logger.info(`    -> ${role.key}: ${defaultLabel}`);
    } else {
      config.roles[role.key].provider = choice;
      if (role.pipelineKey) config.pipeline[role.pipelineKey].enabled = true;
      logger.info(`    -> ${role.key}: ${choice}`);
    }
  }
}

/**
 * KJC-TSK-0415: Plan B — fallback chain. Cuando el provider primario se
 * queda sin créditos (QUOTA_EXHAUSTED_DAILY/MONTHLY) y el cooldown excede
 * max_wait_hours, Brain switchea al fallback en vez de hibernar.
 *
 * Solo pregunta si hay >= 2 providers disponibles (sin alternativas reales
 * no tiene sentido el fallback).
 */
async function askFallbackChain(wizard, available, config, { coder, reviewer }, logger) {
  if (available.length < 2) return;

  logger.info("");
  logger.info("Plan B — automatic fallback when a provider runs out of credits:");
  const enable = await wizard.confirm(
    "  Configure a fallback? (default 12h; if the cooldown exceeds it, switch to the alternate provider)",
    true
  );
  if (!enable) return;

  const maxHoursRaw = await wizard.input("  Max wait before falling back (hours):", "12");
  const maxHours = Number.parseFloat(maxHoursRaw) || 12;

  config.roles = config.roles || {};
  const KEY_ROLES = [
    { key: "coder", label: "coder", primary: coder },
    { key: "reviewer", label: "reviewer", primary: reviewer },
    { key: "planner", label: "planner", primary: coder },
  ];
  for (const role of KEY_ROLES) {
    config.roles[role.key] = config.roles[role.key] || {};
    const opts = [{ label: "No fallback (hibernate)", value: "__none__", available: true }];
    for (const a of available) {
      if (a.name === role.primary) continue;
      opts.push({ label: a.name, value: a.name, available: true });
    }
    const choice = await wizard.select(`  Fallback for ${role.label} when ${role.primary} runs out of credits:`, opts);
    if (choice === "__none__") {
      delete config.roles[role.key].fallback;
      logger.info(`    -> ${role.key}: no fallback (will hibernate)`);
    } else {
      config.roles[role.key].fallback = { provider: choice, max_wait_hours: maxHours };
      logger.info(`    -> ${role.key}: ${role.primary} → ${choice} (after ${maxHours}h)`);
    }
  }
}

async function askMethodology(wizard, config, logger) {
  const methodology = await wizard.select("Development methodology:", [
    { label: "TDD (test-driven development)", value: "tdd", available: true },
    { label: "Standard (no TDD enforcement)", value: "standard", available: true },
  ]);
  config.development.methodology = methodology;
  config.development.require_test_changes = methodology === "tdd";
  logger.info(`  -> Methodology: ${methodology}`);
}

async function askLanguages(wizard, config, logger) {
  const detectedLocale = detectOsLocale();
  const allLangEntries = Object.entries(SUPPORTED_LANGUAGES).map(([code, name]) => ({
    label: `${name} (${code})`,
    value: code,
    available: true,
  }));
  const languageOptions = [
    ...allLangEntries.filter((o) => o.value === detectedLocale),
    ...allLangEntries.filter((o) => o.value !== detectedLocale),
  ];

  const pipelineLang = await wizard.select("Language for agent messages and reports:", languageOptions);
  config.language = pipelineLang;
  logger.info(`  -> Pipeline language: ${pipelineLang}`);

  const huLangOptions = [
    ...allLangEntries.filter((o) => o.value === pipelineLang),
    ...allLangEntries.filter((o) => o.value !== pipelineLang),
  ];
  const huLang = await wizard.select("Language for user stories (HUs):", huLangOptions);
  config.hu_language = huLang;
  logger.info(`  -> User-story language: ${huLang}`);
}

async function askGitAutomation(wizard, config, logger) {
  config.git = config.git || {};
  const autoCommit = await wizard.confirm("Auto-commit per user story? (recommended for `kj run` so commits show up in git log)", false);
  config.git.auto_commit = autoCommit;
  logger.info(`  -> auto_commit: ${autoCommit}`);

  const autoPush = await wizard.confirm("Auto-push to remote after each commit?", false);
  config.git.auto_push = autoPush;
  logger.info(`  -> auto_push: ${autoPush}`);

  const autoPr = await wizard.confirm("Auto-open a Pull Request when the run finishes?", false);
  config.git.auto_pr = autoPr;
  logger.info(`  -> auto_pr: ${autoPr}`);

  // Branch prefix only worth asking when auto_commit is on; otherwise leave default.
  if (autoCommit) {
    const prefix = await wizard.ask("Branch prefix (e.g. feat/, kj/, ai/) [feat/]: ");
    config.git.branch_prefix = (prefix && prefix.trim()) || "feat/";
    logger.info(`  -> branch_prefix: ${config.git.branch_prefix}`);
  }
}

async function askBoardSecurity(wizard, config, logger) {
  if (!config.hu_board?.enabled) return;

  const bindChoice = await wizard.select(
    "HU Board bind host:",
    [
      { label: "127.0.0.1 (loopback only — recommended for personal laptops)", value: "127.0.0.1", available: true },
      { label: "0.0.0.0 (LAN exposure — token auth auto-enforced for non-loopback peers)", value: "0.0.0.0", available: true },
    ],
  );
  config.hu_board.bind = bindChoice;
  logger.info(`  -> HU Board bind: ${bindChoice}`);

  if (bindChoice === "0.0.0.0") {
    logger.info("     A secret token will be auto-generated on first start at ~/.karajan/hu-board/token (mode 0600).");
    logger.info("     Open the URL printed by `kj board start` to grab it.");
  }

  const portInput = await wizard.ask("HU Board port [4000]: ");
  const port = Number.parseInt(portInput, 10);
  config.hu_board.port = Number.isFinite(port) && port > 0 && port < 65536 ? port : 4000;
  logger.info(`  -> HU Board port: ${config.hu_board.port}`);
}

/**
 * Explicit, opt-in telemetry consent. We do NOT inherit a "Karajan-installed
 * users want to help" assumption — silence and missing config keys both mean
 * "no". The prompt is English to match the rest of the wizard (KJC-BUG-0088).
 * See src/utils/telemetry.js and the
 * "Privacy & Telemetry" section of README.md for what gets sent.
 */
async function askTelemetry(wizard, config, logger) {
  // English to stay consistent with the rest of the wizard (KJC-BUG-0088); the
  // user's chosen pipeline/HU language drives `kj run` output, not this prompt.
  const t = {
    question: "Help improve Karajan by sending anonymous telemetry to the project?",
    detail: "  (version, OS, commands, pipeline duration — no code, no tasks, no personal data)",
    previewIntro: "  Example of the exact payload sent when you run `kj run` (inspect more with `kj telemetry preview`):",
    enabled: "  -> Telemetry: enabled (thank you!)",
    disabled: "  -> Telemetry: disabled",
  };
  logger.info(t.detail);
  const example = buildTelemetryPayload("cli_command", { version: "x.y.z", command: "run" });
  logger.info(t.previewIntro);
  logger.info(`    ${JSON.stringify(example)}`);
  const enabled = await wizard.confirm(t.question, false);
  config.telemetry = enabled;
  logger.info(enabled ? t.enabled : t.disabled);
}

async function runWizard(config, logger) {
  const agents = await detectAvailableAgents();
  const available = agents.filter((a) => a.available);
  const unavailable = agents.filter((a) => !a.available);

  logger.info("\n=== Karajan Code Setup Wizard ===\n");

  if (available.length === 0) {
    logger.warn("No AI agents detected. Install at least one:");
    for (const agent of unavailable) {
      logger.warn(`  ${agent.name}: ${agent.install}`);
    }
    logger.info("\nGenerating config with defaults (claude). You can change it later in kj.config.yml.\n");
    return config;
  }

  logger.info("Detected agents:");
  for (const agent of available) {
    logger.info(`  OK   ${agent.name} (${agent.version})`);
  }
  for (const agent of unavailable) {
    logger.info(`  MISS ${agent.name}`);
  }
  logger.info("");

  const wizard = createWizard();
  try {
    const { coder, reviewer } = await askAgents(wizard, available, config, logger);

    const enableTriage = await wizard.confirm("Enable triage (auto-pick a lighter pipeline for simple tasks)?", false);
    config.pipeline.triage = config.pipeline.triage || {};
    config.pipeline.triage.enabled = enableTriage;
    logger.info(`  -> Triage: ${enableTriage ? "enabled" : "disabled"}`);

    const enableSonar = await wizard.confirm("Enable SonarQube analysis?", true);
    config.sonarqube.enabled = enableSonar;
    logger.info(`  -> SonarQube: ${enableSonar ? "enabled" : "disabled"}`);

    const enableHuBoard = await wizard.confirm("Enable the HU Board — a local web UI to track user stories (HUs)?", false);
    config.hu_board = config.hu_board || {};
    config.hu_board.enabled = enableHuBoard;
    if (enableHuBoard) {
      config.hu_board.port = 4000;
      config.hu_board.auto_start = true;
    }
    logger.info(`  -> HU Board: ${enableHuBoard ? "enabled (auto-start on kj run)" : "disabled"}`);

    // KJC-TSK-0571: per-role providers + fallback chains are advanced and
    // collapse a newcomer's first run by ~12 questions. Ask one gate; default
    // off → every role inherits from coder/reviewer.
    const advancedRouting =
      available.length > 1 &&
      (await wizard.confirm(
        "Configure advanced agent routing (a different AI per role + fallback chains)? Most users don't need this.",
        false
      ));
    await askPerRoleProviders(wizard, available, config, { coder, reviewer }, logger, advancedRouting);
    if (advancedRouting) {
      await askFallbackChain(wizard, available, config, { coder, reviewer }, logger);
    }
    await askMethodology(wizard, config, logger);
    await askLanguages(wizard, config, logger);

    logger.info("");
    logger.info("Git automation:");
    await askGitAutomation(wizard, config, logger);

    // Iteration gate (KJC-TSK-0628): opt-in step mode, default no.
    config.session = config.session || {};
    const stepMode = await wizard.confirm(
      "Pause after each iteration with a report and ask before continuing (step mode)?",
      false,
    );
    config.session.iteration_gate = stepMode;
    logger.info(`  -> iteration_gate: ${stepMode}`);

    if (enableHuBoard) {
      logger.info("");
      logger.info("HU Board security:");
      await askBoardSecurity(wizard, config, logger);
    }

    logger.info("");
    logger.info("Privacy:");
    await askTelemetry(wizard, config, logger);

    logger.info("");
  } finally {
    wizard.close();
  }

  return config;
}

/**
 * Backwards-compatible alias for `writeConfig`. Pre-KJC-BUG-0036 this
 * wrapper was the *only* writer that stripped `sonarqube.enabled`
 * before serialising — we needed it because the global `writeConfig`
 * would happily persist the wizard's transient hint. KJC-BUG-0036
 * moved that strip (and the equivalent `_deprecated` strip) into
 * `writeConfig` itself, so this is now a thin alias kept around to
 * keep callers and tests stable. Prefer `writeConfig` in new code.
 *
 * @param {string} configPath
 * @param {object} config
 */
export async function writeInitConfig(configPath, config) {
  await writeConfig(configPath, config);
}

async function handleConfigSetup({ config, configExists, interactive, configPath, logger }) {
  if (configExists && interactive) {
    const wizard = createWizard();
    try {
      const reconfigure = await wizard.confirm("Config already exists. Reconfigure?", false);
      if (reconfigure) {
        const updated = await runWizard(config, logger);
        await writeInitConfig(configPath, updated);
        logger.info(`Updated ${configPath}`);
      } else {
        logger.info("Keeping existing config.");
      }
    } finally {
      wizard.close();
    }
  } else if (!configExists && interactive) {
    const updated = await runWizard(config, logger);
    await writeInitConfig(configPath, updated);
    logger.info(`Created ${configPath}`);
  } else if (!configExists) {
    await writeInitConfig(configPath, config);
    logger.info(`Created ${configPath}`);
  }
}

async function ensureReviewRules(reviewRulesPath, logger) {
  if (await exists(reviewRulesPath)) return;
  await fs.writeFile(
    reviewRulesPath,
    "# Review Rules\n\n- Focus on security, correctness, and test coverage.\n",
    "utf8"
  );
  logger.info("Created .karajan/review-rules.md");
}

async function ensureCoderRules(coderRulesPath, logger) {
  if (await exists(coderRulesPath)) return;
  const templatePath = path.join(getTemplatesRoot(), "coder-rules.md");
  let content;
  try {
    content = await fs.readFile(templatePath, "utf8");
  } catch { /* template not found, use inline default */
    content = [
      "# Coder Rules",
      "",
      "## File modification safety",
      "",
      "- NEVER overwrite existing files entirely. Always make targeted, minimal edits.",
      "- After each edit, verify with `git diff` that ONLY the intended lines changed.",
      "- Do not modify code unrelated to the task.",
      ""
    ].join("\n");
  }
  await fs.writeFile(coderRulesPath, content, "utf8");
  logger.info("Created .karajan/coder-rules.md");
}

async function setupSonarQube(config, logger, { interactive } = {}) {
  if (config.sonarqube?.enabled === false) {
    logger.info("SonarQube disabled — skipping container setup.");
    return;
  }

  // Check Docker first — if not available, disable sonar gracefully
  const dockerCheck = await runCommand("docker", ["--version"]);
  if (dockerCheck.exitCode !== 0) {
    logger.info("Docker not found — disabling SonarQube. Install Docker to enable it later.");
    config.sonarqube.enabled = false;
    return;
  }

  const vmCheck = await checkVmMaxMapCount(os.platform());
  if (!vmCheck.ok) {
    logger.warn(`vm.max_map_count check failed: ${vmCheck.reason}`);
    if (vmCheck.fix) {
      logger.warn(`Fix: ${vmCheck.fix}`);
    }
  }

  const sonar = await sonarUp();
  if (sonar.exitCode !== 0) {
    logger.info(`SonarQube could not be started — disabling for now. You can enable it later with 'kj sonar start'.`);
    config.sonarqube.enabled = false;
    return;
  }

  logger.info("SonarQube container started");

  // KJC-TSK-0367: try to bootstrap the analysis token automatically. The
  // bootstrapper logs in with admin/admin, rotates the password if it's
  // still the default, and POSTs to /api/user_tokens/generate. On 401 or
  // any other failure, we fall back to the manual flow that was the only
  // option before this card.
  if (interactive) {
    logger.info("Bootstrapping SonarQube token automatically...");
    const result = await bootstrapSonarToken({
      host: config.sonarqube.host || "http://localhost:9000",
      configPath: getConfigPath(),
    });
    if (result.ok) {
      config.sonarqube.token = result.token;
      logger.info(`  -> Sonar token saved to ${result.savedTo}`);
      if (result.passwordRotated) {
        logger.info(`  -> Sonar admin password rotated. New value at ${result.passwordSavedTo}`);
      } else if (result.passwordRotationError) {
        // KJC-BUG-0035: rotation failed but token generation succeeded.
        // admin/admin is still live — surface it loudly so the user can
        // fix it manually before someone else exploits it.
        logger.warn(`  -> SonarQube admin password NOT rotated: ${result.passwordRotationError}`);
        logger.warn("     admin/admin remains active. Rotate it manually at http://localhost:9000/account/security");
      }
      return;
    }
    logger.warn(`Could not auto-generate Sonar token: ${result.reason}`);
    logger.info("Falling back to manual flow:");
  }

  logger.info("");
  logger.info("To configure the SonarQube token manually:");
  logger.info("  1. Open http://localhost:9000");
  logger.info("  2. Log in (default credentials: admin / admin)");
  logger.info("  3. Go to: My Account > Security > Generate Token");
  logger.info("  4. Name: karajan-cli, Type: Global Analysis Token");
  logger.info("  5. Set the token in ~/.karajan/kj.config.yml under sonarqube.token");
  logger.info('     or export KJ_SONAR_TOKEN="<your-token>"');
}

async function scaffoldCiGateway(config, flags, logger) {
  if (!config.ci?.enabled && !flags.scaffoldCi) return;
  const projectDir = process.cwd();
  const workflowDir = path.join(projectDir, ".github", "workflows");
  await ensureDir(workflowDir);

  const templatesDir = path.join(getTemplatesRoot(), "workflows");
  const workflows = ["kj-ci-gateway.yml", "automerge.yml", "houston-override.yml"];

  for (const wf of workflows) {
    const destPath = path.join(workflowDir, wf);
    if (await exists(destPath)) {
      logger.info(`${wf} already exists — skipping`);
    } else {
      const srcPath = path.join(templatesDir, wf);
      try {
        const content = await fs.readFile(srcPath, "utf8");
        await fs.writeFile(destPath, content, "utf8");
        logger.info(`Created ${path.relative(projectDir, destPath)}`);
      } catch (err) {
        logger.warn(`Could not scaffold ${wf}: ${err.message}`);
      }
    }
  }

  logger.info("");
  logger.info("Karajan CI Gateway scaffolded. Next steps:");
  logger.info("  1. Create a GitHub App named 'kj-reviewer' with pull_request write permissions");
  logger.info("  2. Install the App on your repository");
  logger.info("  3. Add secrets: KJ_CI_APP_ID and KJ_CI_PRIVATE_KEY");
  logger.info("  4. Push the workflow files and enable 'kj run --enable-ci'");
}

// KJC-TSK-0436 — RAG embedder bootstrap. Default-on, opt-out with
// `--no-ollama`. Skipped automatically when the host can't run it
// (no Docker, daemon down, < 4 GB free RAM) — a one-line warning
// tells the user how to wire an external embedder instead.
async function bootstrapOllama({ flags, config, logger, interactive }) {
  // Commander maps `--no-ollama` to `flags.ollama=false`.
  const skip = flags?.noOllama === true || flags?.ollama === false;
  if (skip) {
    logger.info("Ollama bootstrap skipped (--no-ollama). RAG embedder will be unavailable until you configure one.");
    return;
  }
  const cap = await checkOllamaCapability();
  if (!cap.capable) {
    logger.warn(`Ollama bootstrap skipped: ${cap.reasons.join("; ")}.`);
    logger.warn("  Wire an external embedder via `config.rag.embedder` or rerun `kj init` after fixing the cause.");
    return;
  }
  const result = await ollamaUp(config?.rag?.embedder || null);
  if (result.exitCode !== 0) {
    logger.warn(`Ollama bootstrap failed: ${result.stderr || result.stdout}`);
    return;
  }
  if (result.reusedHost) {
    logger.info(`Reusing existing Ollama at ${result.reusedHost}.`);
  } else {
    logger.info("Ollama container started. Waiting for /api/tags...");
    const ollamaCfg = normalizeOllamaConfig(config?.rag?.embedder || {});
    const ready = await waitForOllamaReady(ollamaCfg.host, ollamaCfg.timeouts.readyMs);
    if (!ready) {
      logger.warn(`Ollama did not become ready within ${ollamaCfg.timeouts.readyMs} ms. Continuing — pull the model manually with \`kj ollama pull nomic-embed-text\`.`);
      return;
    }
  }
  const model = config?.rag?.embedder?.model || "nomic-embed-text";
  logger.info(`Pulling embedder model ${model} (first run downloads ~270 MB)...`);
  const pull = await pullOllamaModel(model, { containerName: config?.rag?.embedder?.container_name });
  if (pull.exitCode === 0) {
    logger.info(`  -> ${model} ready. RAG embedder available.`);
    if (interactive) logger.info("  -> Enable pre-loop retrieval with `yq -i '.rag.preload.enabled = true' " + getConfigPath() + "`");
  } else {
    logger.warn(`Model pull failed: ${pull.stderr || pull.stdout}. Retry with \`kj ollama pull ${model}\`.`);
  }
}

async function installSkills(logger, interactive) {
  const projectDir = process.cwd();
  const commandsDir = path.join(projectDir, ".claude", "commands");
  const skillsTemplateDir = path.join(getTemplatesRoot(), "skills");

  let doInstall = true;
  if (interactive) {
    const wizard = createWizard();
    try {
      doInstall = await wizard.confirm("Install Karajan skills as slash commands (/kj-code, /kj-review, etc.)?", true);
    } finally {
      wizard.close();
    }
  }

  if (!doInstall) {
    logger.info("Skills installation skipped.");
    return;
  }

  await ensureDir(commandsDir);

  let installed = 0;
  try {
    const files = await fs.readdir(skillsTemplateDir);
    for (const file of files) {
      if (!file.endsWith(".md")) continue;
      const src = path.join(skillsTemplateDir, file);
      const dest = path.join(commandsDir, file);
      if (await exists(dest)) {
        logger.info(`  ${file} already exists — skipping`);
        continue;
      }
      const content = await fs.readFile(src, "utf8");
      await fs.writeFile(dest, content, "utf8");
      installed += 1;
    }
  } catch (err) {
    logger.warn(`Could not install skills: ${err.message}`);
    return;
  }

  if (installed > 0) {
    logger.info(`Installed ${installed} Karajan skill(s) in .claude/commands/`);
    logger.info("Available as slash commands: /kj-run, /kj-code, /kj-review, /kj-test, /kj-security, /kj-discover, /kj-architect, /kj-sonar, /kj-rag-query");
  } else {
    logger.info("All skills already installed.");
  }
}

const GITIGNORE_ENTRIES = [
  { pattern: ".kj/", comment: "Karajan runtime (logs, worktrees)" },
  { pattern: ".agent/", comment: "Agent skills (OpenSkills)" },
  { pattern: ".scannerwork/", comment: "SonarQube scanner temp" },
  { pattern: ".reviews/", comment: "Legacy review artifacts" },
];

async function ensureGitignoreEntries(projectDir, logger) {
  const gitignorePath = path.join(projectDir, ".gitignore");
  let content;
  try {
    content = await fs.readFile(gitignorePath, "utf8");
  } catch {
    // No .gitignore yet — will create one
  }
  if (!content) content = "";

  const missing = GITIGNORE_ENTRIES.filter(e => !content.includes(e.pattern));
  if (missing.length > 0) {
    const block = [
      "",
      "# Karajan Code",
      ...missing.map(e => e.pattern)
    ].join("\n") + "\n";
    await fs.appendFile(gitignorePath, block, "utf8");
    logger.info(`Added to .gitignore: ${missing.map(e => e.pattern).join(", ")}`);
  }

  // KJC-BUG-0123 (issue #1268): the .karajan entries were missing entirely —
  // and they must land as the CONTRACT BLOCK (`.karajan/*` + re-includes),
  // never a bare `.karajan/` dir-exclude, or git cannot re-include the
  // review-gate/hooks/adrs the whole team inherits (KJC-TSK-0646).
  const res = await ensureContractBlockPresent(projectDir);
  if (res.changed) logger.info("Added the .karajan contract block to .gitignore (verdicts stay local; gate/hooks/adrs tracked)");
}

/**
 * KJC-TSK-0395: decide where the config is written based on the flags
 * and (when interactive) a wizard prompt. Returns { configPath, scope }.
 * Throws when both --global and --local are passed (mutually exclusive).
 */
export async function resolveConfigScope({ flags, interactive }) {
  if (flags?.global && flags?.local) {
    throw new Error("Cannot pass both --global and --local — pick one scope for the config.");
  }
  if (flags?.global) return { configPath: getConfigPath(), scope: "global" };
  if (flags?.local) return { configPath: getProjectConfigPath(process.cwd()), scope: "local" };
  if (interactive) {
    const globalPath = getConfigPath();
    // KJC-BUG-0087: on a true first run (no global config yet) there is no
    // meaningful choice — set up the global config and skip a cold question a
    // newcomer has no context to answer. Only when a global already exists is
    // "override just for this project?" an actual decision worth asking.
    if (!(await exists(globalPath))) {
      return { configPath: globalPath, scope: "global" };
    }
    const wizard = createWizard();
    try {
      const choice = await wizard.select(
        "You already have a global Karajan config. For this project, do you want to…",
        [
          { value: "global", label: "Use the global config (your default for every project)" },
          { value: "local", label: `Override it just for this project (${getProjectConfigPath(process.cwd())})` },
        ]
      );
      return { configPath: choice === "local" ? getProjectConfigPath(process.cwd()) : globalPath, scope: choice };
    } finally {
      wizard.close();
    }
  }
  // Non-interactive + no flags → legacy behaviour: global. Keeps CI scripts working.
  return { configPath: getConfigPath(), scope: "global" };
}

export async function initCommand({ logger, flags = {} }) {
  // AB-B (KJC-TSK-0656): with --json, stdout is a machine contract — every
  // human log moves to stderr so the only stdout line is the summary object.
  if (flags.json) {
    const toStderr = (...args) => console.error(...args);
    logger = { ...logger, info: toStderr, warn: toStderr, error: toStderr };
  }
  const karajanHome = getKarajanHome();
  await ensureDir(karajanHome);
  logger.info(`Ensured ${karajanHome} exists`);

  const interactive = flags.noInteractive !== true && isTTY();
  // AB-B (KJC-TSK-0656): the agent is the UI. When there is no TTY the
  // wizard silently used defaults — say so, so a brain (or a CI log
  // reader) knows WHY nothing was asked and which flags override what.
  if (!interactive && flags.noInteractive !== true) {
    logger.info("No TTY detected — running non-interactive with defaults (pass flags to override; see kj init --help)");
  }
  const { configPath, scope } = await resolveConfigScope({ flags, interactive });
  logger.info(`Config scope: ${scope} → ${configPath}`);
  const karajanDir = path.join(process.cwd(), ".karajan");
  await ensureDir(karajanDir);
  const reviewRulesPath = path.resolve(karajanDir, "review-rules.md");
  const coderRulesPath = path.resolve(karajanDir, "coder-rules.md");

  const { config } = await loadConfig();
  // KJC-BUG-0087: ask "reconfigure?" only when a config exists AT THE CHOSEN
  // scope path — not when the global cascade has one. Picking local scope in a
  // fresh dir must not report the unrelated global config as "already exists".
  const configExists = await exists(configPath);

  // Auto-detect language from OS locale for non-interactive mode
  if (!interactive && !configExists) {
    const detectedLocale = detectOsLocale();
    config.language = detectedLocale;
    config.hu_language = detectedLocale;
  }

  await handleConfigSetup({ config, configExists, interactive, configPath, logger });
  await ensureReviewRules(reviewRulesPath, logger);
  await ensureCoderRules(coderRulesPath, logger);
  await ensureGitignoreEntries(process.cwd(), logger);
  await installSkills(logger, interactive);
  await bootstrapOllama({ flags, config, logger, interactive });

  // Auto-detect project stack and preconfigure
  const stack = await detectProjectStack(process.cwd());
  if (stack.frameworks.length > 0 || stack.language) {
    const parts = [];
    if (stack.frameworks.length > 0) parts.push(stack.frameworks.join(" + "));
    if (stack.language) parts.push(stack.language);
    const stackType = stack.isFullstack ? "fullstack" : stack.isFrontend ? "frontend" : stack.isBackend ? "backend" : "unknown";
    logger.info(`Detected stack: ${parts.join(" / ")} (${stackType})`);

    if (stack.suggestions.impeccable) {
      config.impeccable = config.impeccable || {};
      config.impeccable.enabled = true;
      logger.info("  -> Impeccable design audit enabled (frontend detected)");
    }

    if (stack.suggestions.skills.length > 0) {
      logger.info(`  -> Suggested skills: ${stack.suggestions.skills.join(", ")}`);
    }

    if (stack.language && !configExists) {
      config.development = config.development || {};
      config.development.methodology = config.development.methodology || "tdd";
    }

    await writeInitConfig(configPath, config);
  } else {
    logger.info("No project stack detected — using default configuration.");
  }

  // Check RTK availability — auto-install if missing (opt-out: --no-rtk)
  const skipRtk = flags?.noRtk === true || flags?.rtk === false;
  if (skipRtk) {
    logger.info("RTK setup skipped (--no-rtk). Bash outputs will not be token-optimized.");
  } else {
    const rtk = await detectRtk();
    if (rtk.available) {
      logger.info(`RTK ${rtk.version || ""} detected.`);
    } else {
      const installResult = await installRtk(logger);
      if (!installResult.ok) {
        logger.warn("RTK install failed — Bash outputs will not be token-optimized.");
        logger.warn(`  Manual install: ${getInstallCommand("rtk")}`);
      }
    }
  }

  // Check Squeezr availability — auto-install if missing (opt-out: --no-squeezr)
  const skipSqueezr = flags?.noSqueezr === true || flags?.squeezr === false;
  if (skipSqueezr) {
    logger.info("Squeezr setup skipped (--no-squeezr). Tool outputs will not be compressed.");
  } else {
    const squeezr = await detectSqueezr();
    if (squeezr.available) {
      logger.info(`Squeezr ${squeezr.version || ""} detected.`);
    } else {
      const installResult = await installSqueezr(logger);
      if (!installResult.ok) {
        logger.warn("Squeezr install failed — tool outputs will not be compressed.");
        logger.warn(`  Manual install: ${getInstallCommand("squeezr")}`);
      }
    }
  }

  // Check ai-trash availability — register PreToolUse hook if binary present
  // (opt-out: --no-ai-trash). The binary itself ships with karajan-code.
  const skipAiTrash = flags?.noAiTrash === true || flags?.aiTrash === false;
  if (skipAiTrash) {
    logger.info("ai-trash setup skipped (--no-ai-trash). Destructive ops will run unprotected.");
  } else {
    const aiTrash = await detectAiTrash();
    if (aiTrash.available) {
      await installAiTrashHook(logger);
    } else {
      logger.warn("ai-trash kj-trash binary not found — destructive ops unprotected.");
      logger.warn("  Install karajan-code globally (npm i -g @karajan-family/code) so kj-trash is on PATH.");
    }
  }

  // Check QMD availability — auto-install if missing and register project
  // collections (docs/, .reviews/, .karajan/plans/). Opt-out: --no-qmd.
  const skipQmd = flags?.noQmd === true || flags?.qmd === false;
  if (skipQmd) {
    logger.info("QMD setup skipped (--no-qmd). Semantic wiki indexing disabled.");
  } else {
    const qmd = await detectQmd();
    if (qmd.available) {
      logger.info(`QMD ${qmd.version || ""} detected.`);
    } else {
      const installResult = await installQmd(logger);
      if (!installResult.ok) {
        logger.warn("QMD install failed — semantic wiki unavailable.");
        logger.warn(`  Manual install: ${getInstallCommand("qmd")}`);
      }
    }
    const recheck = await detectQmd();
    if (recheck.available) {
      await registerQmdCollections(process.cwd(), logger);
    }
  }

  await setupSonarQube(config, logger, { interactive });
  await scaffoldCiGateway(config, flags, logger);

  // Install the quality harness (git hooks, lint/format/commit config, CI
  // quality gates, agent guidelines) through the SAME engine as `kj harden`,
  // so init and harden never drift. Opt-out: --no-harden. Needs a git repo.
  const skipHarden = flags?.noHarden === true || flags?.harden === false;
  if (skipHarden) {
    logger.info("Quality harness skipped (--no-harden).");
  } else if (isGitRepo(process.cwd())) {
    logger.info("Installing quality harness (kj harden)...");
    await hardenCommand({ projectDir: process.cwd(), logger });
  } else {
    logger.info("Not a git repository — run `kj harden` after `git init` to add the quality harness.");
  }

  // Persist any changes setupSonarQube made (token, etc.) back to disk.
  // Use writeInitConfig so the deprecated `sonarqube.enabled` key —
  // which setupSonarQube still mutates as an in-memory hint — never
  // reaches the YAML file.
  await writeInitConfig(configPath, config);

  // Telemetry: anonymous install event (non-blocking)
  const { readFileSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  try {
    // TSK-0340: use the already-static `path` default import for resolve/dirname.
    const pkgPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../package.json");
    const version = JSON.parse(readFileSync(pkgPath, "utf8")).version;
    sendTelemetryEvent("install", { version }, config).catch(() => {});
  } catch { /* non-blocking */ }

  // AB-B (KJC-TSK-0656): machine contract for brains — one JSON object with
  // what init actually did, instead of parsing the human log.
  if (flags.json) {
    console.log(JSON.stringify({
      ok: true, configPath, scope, interactive,
      skipped: ["ollama", "rtk", "squeezr", "qmd", "harden"].filter((t) => flags[t] === false),
    }));
    return;
  }

  // Clear close so a first-time user knows setup finished and what to do next,
  // instead of being left at the end of a wall of detection logs (KJC-BUG-0088).
  logger.info("");
  logger.info("✓ Karajan is set up in this project.");
  logger.info('  Next:  kj run "describe what to build or fix"');
  logger.info("  More:  kj --help   ·   kj doctor (check your setup)");
}

// Internal exports for unit testing (KJC-TSK-0367)
export const __test__ = {
  askAgents,
  askPerRoleProviders,
  askMethodology,
  askLanguages,
  askGitAutomation,
  askBoardSecurity,
  PER_ROLE_QUESTIONS,
};
