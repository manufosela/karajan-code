import { readFileSync } from "node:fs";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import os from "node:os";
import path from "node:path";
import { runCommand } from "../utils/process.js";
import { exists } from "../utils/fs.js";
import { getConfigPath } from "../config.js";
import { isSonarReachable } from "../sonar/manager.js";
import { resolveRoleMdPath, loadFirstExisting } from "../roles/base-role.js";
import { ensureGitRepo } from "../utils/git.js";
import { checkBinary, KNOWN_AGENTS } from "../utils/agent-detect.js";
import { getInstallCommand } from "../utils/os-detect.js";

function getPackageVersion() {
  const pkgPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../package.json");
  return JSON.parse(readFileSync(pkgPath, "utf8")).version;
}

function checkKarajanVersion() {
  const version = getPackageVersion();
  return {
    name: "karajan",
    label: "Karajan Code",
    ok: true,
    detail: `v${version}`,
    fix: null
  };
}

async function checkConfigFile() {
  const configPath = getConfigPath();
  const configExists = await exists(configPath);
  return {
    name: "config",
    label: "Config file",
    ok: configExists,
    detail: configExists ? configPath : "Not found",
    fix: configExists ? null : "Run 'kj init' to create the config file."
  };
}

async function checkGitRepo() {
  let gitOk = false;
  try {
    gitOk = await ensureGitRepo();
  } catch { /* git check failed */
    gitOk = false;
  }
  return {
    name: "git",
    label: "Git repository",
    ok: gitOk,
    detail: gitOk ? "Inside a git repository" : "Not a git repository",
    fix: gitOk ? null : "Run 'git init' or navigate to a git-managed project."
  };
}

async function checkDocker() {
  const docker = await checkBinary("docker", "--version");
  return {
    name: "docker",
    label: "Docker",
    ok: docker.ok,
    detail: docker.ok ? docker.version : "Not found",
    fix: docker.ok ? null : "Install Docker: https://docs.docker.com/get-docker/"
  };
}

function sonarDetail(config, sonarOk, sonarHost) {
  if (config.sonarqube?.enabled === false) return "Disabled in config";
  if (sonarOk) return `Reachable at ${sonarHost}`;
  return `Not reachable at ${sonarHost}`;
}

async function checkSonarQube(config) {
  const sonarHost = config.sonarqube?.host || "http://localhost:9000";
  let sonarOk = false;
  if (config.sonarqube?.enabled !== false) {
    try {
      sonarOk = await isSonarReachable(sonarHost);
    } catch { /* sonar check failed */
      sonarOk = false;
    }
  }
  const isOkOrDisabled = sonarOk || config.sonarqube?.enabled === false;
  return {
    name: "sonarqube",
    label: "SonarQube",
    ok: isOkOrDisabled,
    detail: sonarDetail(config, sonarOk, sonarHost),
    fix: isOkOrDisabled
      ? null
      : "Run 'kj sonar start' or 'docker start karajan-sonarqube'. Use --no-sonar to skip."
  };
}

async function checkAgentCLIs() {
  const checks = [];
  for (const agent of KNOWN_AGENTS) {
    const result = await checkBinary(agent.name);
    checks.push({
      name: `agent:${agent.name}`,
      label: `Agent: ${agent.name}`,
      ok: result.ok,
      detail: result.ok ? `${result.version} (${result.path})` : "Not found",
      fix: result.ok ? null : `Install: ${agent.install}`
    });
  }
  return checks;
}

async function checkCoreBinaries() {
  const checks = [];
  for (const bin of ["node", "npm", "git"]) {
    const result = await checkBinary(bin);
    checks.push({
      name: bin,
      label: bin,
      ok: result.ok,
      detail: result.ok ? result.version : "Not found",
      fix: result.ok ? null : `Install ${bin} from its official website.`
    });
  }
  return checks;
}

async function checkSerena() {
  let serenaOk = false;
  try {
    const serenaCheck = await runCommand("serena", ["--version"]);
    serenaOk = serenaCheck.exitCode === 0;
  } catch { /* serena not installed */
    serenaOk = false;
  }
  return {
    name: "serena",
    label: "Serena MCP",
    ok: serenaOk,
    detail: serenaOk ? "Available" : "Not found (prompts will still include Serena instructions)",
    fix: serenaOk ? null : "Install Serena: uvx --from git+https://github.com/oraios/serena serena --help"
  };
}

async function checkBecariaWorkflows(projectDir) {
  const checks = [];
  const workflowDir = path.join(projectDir, ".github", "workflows");
  const requiredWorkflows = ["becaria-gateway.yml", "automerge.yml", "houston-override.yml"];
  for (const wf of requiredWorkflows) {
    const wfPath = path.join(workflowDir, wf);
    const wfExists = await exists(wfPath);
    checks.push({
      name: `becaria:workflow:${wf}`,
      label: `BecarIA workflow: ${wf}`,
      ok: wfExists,
      detail: wfExists ? "Found" : "Not found",
      fix: wfExists ? null : `Run 'kj init --scaffold-becaria' or copy from karajan-code/templates/workflows/${wf}`
    });
  }
  return checks;
}

async function checkBecariaSecrets() {
  try {
    const { detectRepo } = await import("../becaria/repo.js");
    const repo = await detectRepo();
    if (!repo) return null;

    const secretsRes = await runCommand("gh", ["api", `repos/${repo}/actions/secrets`, "--jq", ".secrets[].name"]);
    if (secretsRes.exitCode !== 0) return null;

    const names = new Set(secretsRes.stdout.split("\n").map((s) => s.trim()));
    const hasAppId = names.has("BECARIA_APP_ID");
    const hasKey = names.has("BECARIA_APP_PRIVATE_KEY");
    const secretsOk = hasAppId && hasKey;
    const missing = [!hasAppId && "BECARIA_APP_ID", !hasKey && "BECARIA_APP_PRIVATE_KEY"].filter(Boolean).join(" ");
    return {
      name: "becaria:secrets",
      label: "BecarIA: GitHub secrets",
      ok: secretsOk,
      detail: secretsOk ? "BECARIA_APP_ID + BECARIA_APP_PRIVATE_KEY found" : `Missing: ${missing}`,
      fix: secretsOk ? null : "Add BECARIA_APP_ID and BECARIA_APP_PRIVATE_KEY as GitHub repository secrets"
    };
  } catch { /* GitHub API error */
    return null;
  }
}

async function checkBecariaInfra(config) {
  const checks = [];
  const projectDir = config.projectDir || process.cwd();

  checks.push(...await checkBecariaWorkflows(projectDir));

  const ghCheck = await checkBinary("gh");
  checks.push({
    name: "becaria:gh",
    label: "BecarIA: gh CLI",
    ok: ghCheck.ok,
    detail: ghCheck.ok ? ghCheck.version : "Not found",
    fix: ghCheck.ok ? null : "Install GitHub CLI: https://cli.github.com/"
  });

  const secretsCheck = await checkBecariaSecrets();
  if (secretsCheck) checks.push(secretsCheck);

  return checks;
}

async function checkRtk() {
  const installCmd = getInstallCommand("rtk");
  try {
    const res = await runCommand("rtk", ["--version"]);
    if (res.exitCode === 0) {
      return { name: "rtk", label: "RTK (Rust Token Killer)", ok: true, detail: `${res.stdout.trim()} — token savings active`, fix: null };
    }
  } catch { /* not installed */ }
  return {
    name: "rtk",
    label: "RTK (Rust Token Killer)",
    ok: false,
    detail: "Not found — 60-90% token savings available",
    fix: `Install: ${installCmd}`
  };
}

async function checkRuleFiles(config) {
  const projectDir = config.projectDir || process.cwd();
  const reviewRules = await loadFirstExisting(resolveRoleMdPath("reviewer", projectDir));
  const coderRules = await loadFirstExisting(resolveRoleMdPath("coder", projectDir));
  return [
    {
      name: "review-rules",
      label: "Reviewer rules (.md)",
      ok: Boolean(reviewRules),
      detail: reviewRules ? "Found" : "Not found (will use defaults)",
      fix: null
    },
    {
      name: "coder-rules",
      label: "Coder rules (.md)",
      ok: Boolean(coderRules),
      detail: coderRules ? "Found" : "Not found (will use defaults)",
      fix: null
    }
  ];
}

/**
 * Detect duplicate TOML table headers (e.g. [mcp_servers."karajan-mcp"] appearing twice).
 * Full TOML parsing would require a dependency — this catches the most common config error.
 */
function findDuplicateTomlKeys(content) {
  const tableHeaders = [];
  const duplicates = [];
  for (const line of content.split("\n")) {
    const match = line.match(/^\s*\[([^\]]+)\]\s*$/);
    if (match) {
      const key = match[1].trim();
      if (tableHeaders.includes(key)) {
        duplicates.push(key);
      } else {
        tableHeaders.push(key);
      }
    }
  }
  return duplicates;
}

async function checkAgentConfigs() {
  const checks = [];
  const home = os.homedir();

  // Claude: ~/.claude.json
  const claudeJsonPath = path.join(home, ".claude.json");
  try {
    const raw = await fs.readFile(claudeJsonPath, "utf8");
    JSON.parse(raw);
    checks.push({ name: "agent-config:claude", label: "Agent config: claude (~/.claude.json)", ok: true, detail: "Valid JSON", fix: null });
  } catch (err) {
    if (err.code === "ENOENT") {
      // File doesn't exist — not an error, Claude may not be configured
    } else {
      checks.push({
        name: "agent-config:claude",
        label: "Agent config: claude (~/.claude.json)",
        ok: false,
        detail: `Invalid JSON: ${err.message.split("\n")[0]}`,
        fix: "Fix the JSON syntax in ~/.claude.json. Common issues: trailing commas, missing quotes."
      });
    }
  }

  // Codex: ~/.codex/config.toml
  const codexTomlPath = path.join(home, ".codex", "config.toml");
  try {
    const raw = await fs.readFile(codexTomlPath, "utf8");
    const duplicates = findDuplicateTomlKeys(raw);
    if (duplicates.length > 0) {
      checks.push({
        name: "agent-config:codex",
        label: "Agent config: codex (~/.codex/config.toml)",
        ok: false,
        detail: `Duplicate TOML keys: ${duplicates.join(", ")}`,
        fix: `Remove duplicate entries in ~/.codex/config.toml: ${duplicates.join(", ")}`
      });
    } else {
      checks.push({ name: "agent-config:codex", label: "Agent config: codex (~/.codex/config.toml)", ok: true, detail: "Valid TOML (no duplicate keys)", fix: null });
    }
  } catch (err) {
    if (err.code !== "ENOENT") {
      checks.push({
        name: "agent-config:codex",
        label: "Agent config: codex (~/.codex/config.toml)",
        ok: false,
        detail: `Cannot read: ${err.message.split("\n")[0]}`,
        fix: "Check file permissions on ~/.codex/config.toml"
      });
    }
  }

  // KJ config: ~/.karajan/kj.config.yml (validate YAML)
  const kjConfigPath = getConfigPath();
  try {
    const raw = await fs.readFile(kjConfigPath, "utf8");
    const yaml = await import("js-yaml");
    yaml.default.load(raw);
    checks.push({ name: "agent-config:karajan", label: "Agent config: karajan (kj.config.yml)", ok: true, detail: "Valid YAML", fix: null });
  } catch (err) {
    if (err.code !== "ENOENT") {
      checks.push({
        name: "agent-config:karajan",
        label: "Agent config: karajan (kj.config.yml)",
        ok: false,
        detail: `Invalid YAML: ${err.message.split("\n")[0]}`,
        fix: `Fix YAML syntax in ${kjConfigPath}. Run 'kj init' to regenerate if needed.`
      });
    }
  }

  return checks;
}

export async function runChecks({ config }) {
  const checks = [];

  checks.push(
    checkKarajanVersion(),
    await checkConfigFile(),
    await checkGitRepo(),
    await checkDocker(),
    await checkSonarQube(config),
    ...await checkAgentCLIs(),
    ...await checkCoreBinaries()
  );

  if (config.serena?.enabled) {
    checks.push(await checkSerena());
  }

  if (config.becaria?.enabled) {
    checks.push(...await checkBecariaInfra(config));
  }

  checks.push(...await checkAgentConfigs());
  checks.push(...await checkRuleFiles(config));
  checks.push(await checkRtk());

  return checks;
}

export async function doctorCommand({ config }) {
  const checks = await runChecks({ config });

  for (const check of checks) {
    const icon = check.ok ? "OK  " : "MISS";
    console.log(`${icon} ${check.label}: ${check.detail}`);
    if (check.fix) {
      console.log(`     -> ${check.fix}`);
    }
  }

  const failures = checks.filter((c) => !c.ok && c.fix);
  if (failures.length === 0) {
    console.log("\nAll checks passed.");
  } else {
    console.log(`\n${failures.length} issue(s) found.`);
  }

  return checks;
}
