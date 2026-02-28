import { runCommand } from "../utils/process.js";
import { resolveBin } from "../agents/resolve-bin.js";
import { exists } from "../utils/fs.js";
import { getConfigPath } from "../config.js";
import { isSonarReachable } from "../sonar/manager.js";
import { resolveRoleMdPath, loadFirstExisting } from "../roles/base-role.js";
import { ensureGitRepo } from "../utils/git.js";

async function checkBinary(name, versionArg = "--version") {
  const resolved = resolveBin(name);
  const res = await runCommand(resolved, [versionArg]);
  const version = (res.stdout || res.stderr || "").split("\n")[0].trim();
  return { ok: res.exitCode === 0, version, path: resolved };
}

export async function runChecks({ config }) {
  const checks = [];

  // 1. Config file
  const configPath = getConfigPath();
  const configExists = await exists(configPath);
  checks.push({
    name: "config",
    label: "Config file",
    ok: configExists,
    detail: configExists ? configPath : "Not found",
    fix: configExists ? null : "Run 'kj init' to create the config file."
  });

  // 2. Git repository
  let gitOk = false;
  try {
    gitOk = await ensureGitRepo();
  } catch {
    gitOk = false;
  }
  checks.push({
    name: "git",
    label: "Git repository",
    ok: gitOk,
    detail: gitOk ? "Inside a git repository" : "Not a git repository",
    fix: gitOk ? null : "Run 'git init' or navigate to a git-managed project."
  });

  // 3. Docker
  const docker = await checkBinary("docker", "--version");
  checks.push({
    name: "docker",
    label: "Docker",
    ok: docker.ok,
    detail: docker.ok ? docker.version : "Not found",
    fix: docker.ok ? null : "Install Docker: https://docs.docker.com/get-docker/"
  });

  // 4. SonarQube reachability
  const sonarHost = config.sonarqube?.host || "http://localhost:9000";
  let sonarOk = false;
  if (config.sonarqube?.enabled !== false) {
    try {
      sonarOk = await isSonarReachable(sonarHost);
    } catch {
      sonarOk = false;
    }
  }
  checks.push({
    name: "sonarqube",
    label: "SonarQube",
    ok: sonarOk || config.sonarqube?.enabled === false,
    detail: config.sonarqube?.enabled === false
      ? "Disabled in config"
      : sonarOk
        ? `Reachable at ${sonarHost}`
        : `Not reachable at ${sonarHost}`,
    fix: sonarOk || config.sonarqube?.enabled === false
      ? null
      : "Run 'kj sonar start' or 'docker start karajan-sonarqube'. Use --no-sonar to skip."
  });

  // 5. Agent CLIs
  const agents = [
    ["claude", "Install: npm install -g @anthropic-ai/claude-code"],
    ["codex", "Install: npm install -g @openai/codex"],
    ["gemini", "Install: npm install -g @anthropic-ai/gemini-code (or check Gemini CLI docs)"],
    ["aider", "Install: pip install aider-chat"]
  ];
  for (const [agent, fixHint] of agents) {
    const result = await checkBinary(agent);
    checks.push({
      name: `agent:${agent}`,
      label: `Agent: ${agent}`,
      ok: result.ok,
      detail: result.ok ? `${result.version} (${result.path})` : "Not found",
      fix: result.ok ? null : fixHint
    });
  }

  // 6. Core binaries
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

  // 7. Serena MCP
  if (config.serena?.enabled) {
    let serenaOk = false;
    try {
      const serenaCheck = await runCommand("serena", ["--version"]);
      serenaOk = serenaCheck.exitCode === 0;
    } catch {
      serenaOk = false;
    }
    checks.push({
      name: "serena",
      label: "Serena MCP",
      ok: serenaOk,
      detail: serenaOk ? "Available" : "Not found (prompts will still include Serena instructions)",
      fix: serenaOk ? null : "Install Serena: uvx --from git+https://github.com/oraios/serena serena --help"
    });
  }

  // 8. Review rules / Coder rules
  const projectDir = config.projectDir || process.cwd();
  const reviewRules = await loadFirstExisting(resolveRoleMdPath("reviewer", projectDir));
  const coderRules = await loadFirstExisting(resolveRoleMdPath("coder", projectDir));
  checks.push({
    name: "review-rules",
    label: "Reviewer rules (.md)",
    ok: Boolean(reviewRules),
    detail: reviewRules ? "Found" : "Not found (will use defaults)",
    fix: null
  });
  checks.push({
    name: "coder-rules",
    label: "Coder rules (.md)",
    ok: Boolean(coderRules),
    detail: coderRules ? "Found" : "Not found (will use defaults)",
    fix: null
  });

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
