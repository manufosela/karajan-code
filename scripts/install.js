#!/usr/bin/env node
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

const rl = readline.createInterface({ input, output });
const REGISTRY_PATH = path.join(os.homedir(), ".karajan", "instances.json");
const INSTALL_STATE_PATH = path.join(os.homedir(), ".karajan", "install-state.json");
const AGENT_META = {
  codex: { bin: "codex", installUrl: "https://developers.openai.com/codex/cli" },
  claude: { bin: "claude", installUrl: "https://docs.anthropic.com/en/docs/claude-code" },
  gemini: { bin: "gemini", installUrl: "https://github.com/google-gemini/gemini-cli" },
  aider: { bin: "aider", installUrl: "https://aider.chat/docs/install.html" }
};

function printHeader() {
  console.log("\nKarajan Code Installer\n");
}

function printHelp() {
  console.log(`Usage:
  ./scripts/install.sh [options]
  node scripts/install.js [options]

Options:
  --non-interactive               Run without prompts (CI-friendly)
  --instance-name <name>          Instance name (default: default)
  --instance-action <mode>        add | update | replace
  --recovery-action <mode>        continue | restart (if previous install was interrupted)
  --link-global <bool>            Run npm link (default: true interactive, false non-interactive)
  --kj-home <path>                KJ_HOME path
  --sonar-host <url>              SonarQube host (default: http://localhost:9000)
  --generate-sonar-token <bool>   Generate token using sonar admin credentials
  --sonar-user <user>             Sonar username (default: admin)
  --sonar-password <pass>         Sonar password
  --sonar-token-name <name>       Sonar token name (default: karajan-cli)
  --sonar-token <token>           Existing KJ_SONAR_TOKEN
  --coder <name>                  Default coder (default: codex)
  --reviewer <name>               Default reviewer (default: claude)
  --reviewer-fallback <name>      Default reviewer fallback (default: codex)
  --setup-mcp-claude <bool>       Configure Claude MCP
  --setup-mcp-codex <bool>        Configure Codex MCP
  --run-doctor <bool>             Run kj doctor at end
  --run-tests <bool>              Run tests at end (default: true)
  --help                          Show this help

Environment variable equivalents:
  KJ_INSTALL_NON_INTERACTIVE
  KJ_INSTALL_INSTANCE_NAME
  KJ_INSTALL_INSTANCE_ACTION
  KJ_INSTALL_RECOVERY_ACTION
  KJ_INSTALL_LINK_GLOBAL
  KJ_INSTALL_KJ_HOME
  KJ_INSTALL_SONAR_HOST
  KJ_INSTALL_GENERATE_SONAR_TOKEN
  KJ_INSTALL_SONAR_USER
  KJ_INSTALL_SONAR_PASSWORD
  KJ_INSTALL_SONAR_TOKEN_NAME
  KJ_SONAR_TOKEN
  KJ_INSTALL_CODER
  KJ_INSTALL_REVIEWER
  KJ_INSTALL_REVIEWER_FALLBACK
  KJ_INSTALL_SETUP_MCP_CLAUDE
  KJ_INSTALL_SETUP_MCP_CODEX
  KJ_INSTALL_RUN_DOCTOR
  KJ_INSTALL_RUN_TESTS
`);
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;

    const key = token.slice(2);
    if (key === "help") {
      out.help = true;
      continue;
    }

    if (key === "non-interactive") {
      out.nonInteractive = true;
      continue;
    }

    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      out[toCamelCase(key)] = true;
      continue;
    }

    out[toCamelCase(key)] = next;
    i += 1;
  }
  return out;
}

function toCamelCase(kebab) {
  return kebab.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

function parseBool(value, defaultValue = false) {
  if (value === undefined || value === null || value === "") return defaultValue;
  if (typeof value === "boolean") return value;
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "y", "si", "s"].includes(normalized)) return true;
  if (["0", "false", "no", "n"].includes(normalized)) return false;
  return defaultValue;
}

function pickSetting({ cli, cliKey, envKey, fallback }) {
  const cliValue = cli?.[cliKey];
  if (cliValue !== undefined) return cliValue;
  const envValue = process.env[envKey];
  if (envValue !== undefined) return envValue;
  return fallback;
}

async function run(command, args = [], options = {}) {
  const { cwd, env, timeout } = options;
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd,
      env,
      shell: false
    });

    let stdout = "";
    let stderr = "";
    let killedByTimeout = false;
    let timer = null;

    if (timeout) {
      timer = setTimeout(() => {
        killedByTimeout = true;
        child.kill("SIGKILL");
      }, Number(timeout));
    }

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      if (timer) clearTimeout(timer);
      resolve({ exitCode: 1, stdout, stderr: `${stderr}${error.message}` });
    });
    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      if (killedByTimeout) {
        resolve({ exitCode: 143, stdout, stderr: `${stderr}Command timed out` });
        return;
      }
      resolve({ exitCode: code ?? 1, stdout, stderr });
    });
  });
}

async function ensureCommand(name, checkArgs = ["--version"]) {
  const res = await run(name, checkArgs);
  return res.exitCode === 0;
}

async function ask(question, defaultValue = "") {
  const suffix = defaultValue ? ` [${defaultValue}]` : "";
  const value = (await rl.question(`${question}${suffix}: `)).trim();
  return value || defaultValue;
}

async function askBool(question, defaultYes = true) {
  const hint = defaultYes ? "Y/n" : "y/N";
  const raw = (await rl.question(`${question} (${hint}): `)).trim().toLowerCase();
  if (!raw) return defaultYes;
  return ["y", "yes", "s", "si"].includes(raw);
}

async function askChoice(question, options) {
  console.log(question);
  for (let i = 0; i < options.length; i += 1) {
    console.log(`${i + 1}) ${options[i].label}`);
  }
  const raw = (await rl.question("Selecciona una opcion: ")).trim();
  const idx = Number(raw) - 1;
  if (!Number.isFinite(idx) || idx < 0 || idx >= options.length) {
    return options[0].value;
  }
  return options[idx].value;
}

async function readJson(file) {
  const raw = await fs.readFile(file, "utf8");
  return JSON.parse(raw);
}

async function writeJson(file, obj) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(obj, null, 2)}\n`, "utf8");
}

async function loadRegistry() {
  try {
    return await readJson(REGISTRY_PATH);
  } catch {
    return { instances: {} };
  }
}

async function saveRegistry(registry) {
  await writeJson(REGISTRY_PATH, registry);
}

async function loadInstallState() {
  try {
    return await readJson(INSTALL_STATE_PATH);
  } catch {
    return null;
  }
}

async function saveInstallState(state) {
  await writeJson(INSTALL_STATE_PATH, state);
}

async function clearInstallState() {
  await fs.rm(INSTALL_STATE_PATH, { force: true });
}

function upsertCodexMcpBlock(toml, block) {
  const begin = "# BEGIN karajan-mcp";
  const end = "# END karajan-mcp";
  const startIdx = toml.indexOf(begin);
  const endIdx = toml.indexOf(end);
  let base = toml;

  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    base = `${toml.slice(0, startIdx).trimEnd()}\n\n${toml.slice(endIdx + end.length).trimStart()}`;
  }

  return `${base.trimEnd()}\n\n${begin}\n${block}\n${end}\n`;
}

async function setupCodexMcp({ rootDir, kjHome }) {
  const codexConfigPath = path.join(os.homedir(), ".codex", "config.toml");
  let toml = "";
  try {
    toml = await fs.readFile(codexConfigPath, "utf8");
  } catch {
    toml = "";
  }

  const block = [
    '[mcp_servers."karajan-mcp"]',
    'command = "node"',
    `args = ["${path.join(rootDir, "src", "mcp", "server.js")}"]`,
    `cwd = "${rootDir}"`,
    '[mcp_servers."karajan-mcp".env]',
    `KJ_HOME = "${kjHome}"`
  ].join("\n");

  const updated = upsertCodexMcpBlock(toml, block);
  await fs.mkdir(path.dirname(codexConfigPath), { recursive: true });
  await fs.writeFile(codexConfigPath, updated, "utf8");
  return codexConfigPath;
}

async function setupClaudeMcp({ rootDir, kjHome }) {
  const claudeJsonPath = path.join(os.homedir(), ".claude.json");
  let config = {};
  try {
    config = await readJson(claudeJsonPath);
  } catch {
    config = {};
  }

  config.mcpServers = config.mcpServers || {};
  config.mcpServers["karajan-mcp"] = {
    type: "stdio",
    command: "node",
    args: [path.join(rootDir, "src", "mcp", "server.js")],
    cwd: rootDir,
    env: { KJ_HOME: kjHome }
  };

  await writeJson(claudeJsonPath, config);
  return claudeJsonPath;
}

async function generateSonarToken({ host, user, password, tokenName }) {
  const url = `${host.replace(/\/$/, "")}/api/user_tokens/generate?name=${encodeURIComponent(tokenName)}`;
  const res = await run("curl", ["-s", "-u", `${user}:${password}`, "-X", "POST", url]);
  if (res.exitCode !== 0) {
    throw new Error(res.stderr || res.stdout || "Could not generate Sonar token");
  }

  const parsed = JSON.parse(res.stdout || "{}");
  if (!parsed.token) {
    throw new Error(`Unexpected Sonar response: ${res.stdout}`);
  }

  return parsed.token;
}

const SHELL_SOURCE_MARKER = "# karajan-code env";

async function addSourceToShellProfile(envPath) {
  const home = os.homedir();
  const profiles = [path.join(home, ".bashrc"), path.join(home, ".zshrc")];
  const sourceLine = `${SHELL_SOURCE_MARKER}\n[ -f "${envPath}" ] && source "${envPath}"`;
  const updated = [];

  for (const profile of profiles) {
    let content = "";
    try {
      content = await fs.readFile(profile, "utf8");
    } catch {
      continue;
    }

    if (content.includes(SHELL_SOURCE_MARKER)) {
      const lines = content.split("\n");
      const filtered = [];
      let skip = false;
      for (const line of lines) {
        if (line.trim() === SHELL_SOURCE_MARKER.trim()) {
          skip = true;
          continue;
        }
        if (skip) {
          skip = false;
          continue;
        }
        filtered.push(line);
      }
      content = filtered.join("\n");
    }

    const newContent = `${content.trimEnd()}\n\n${sourceLine}\n`;
    await fs.writeFile(profile, newContent, "utf8");
    updated.push(profile);
  }

  return updated;
}

async function writeKarajanEnv({ kjHome, sonarToken, sonarHost }) {
  const envPath = path.join(kjHome, "karajan.env");
  const lines = [
    `export KJ_HOME=\"${kjHome}\"`,
    sonarToken ? `export KJ_SONAR_TOKEN=\"${sonarToken}\"` : "",
    sonarHost ? `export KJ_SONAR_HOST=\"${sonarHost}\"` : ""
  ].filter(Boolean);

  await fs.mkdir(kjHome, { recursive: true });
  await fs.writeFile(envPath, `${lines.join("\n")}\n`, { mode: 0o600 });
  return envPath;
}

async function bootstrapKjConfig({ rootDir, kjHome, sonarToken, sonarHost, coder, reviewer, reviewerFallback }) {
  const env = { ...process.env, KJ_HOME: kjHome };
  if (sonarToken) env.KJ_SONAR_TOKEN = sonarToken;

  const initRes = await run("node", [path.join(rootDir, "src", "cli.js"), "init"], {
    cwd: rootDir,
    env
  });

  if (initRes.exitCode !== 0) {
    throw new Error(`kj init failed: ${initRes.stderr || initRes.stdout}`);
  }

  const configPath = path.join(rootDir, "kj.config.yml");
  let config = await fs.readFile(configPath, "utf8");
  config = config.replace(/^coder:\s.*$/m, `coder: ${coder}`);
  config = config.replace(/^reviewer:\s.*$/m, `reviewer: ${reviewer}`);
  config = config.replace(/^\s*fallback_reviewer:\s.*$/m, `  fallback_reviewer: ${reviewerFallback}`);
  config = config.replace(/^\s*max_iteration_minutes:\s.*$/m, "  max_iteration_minutes: 5");
  config = config.replace(/^\s*host:\s.*$/m, `  host: ${sonarHost}`);
  config = config.replace(/^\s*token:\s.*$/m, "  token: null");
  await fs.writeFile(configPath, config, "utf8");

  return configPath;
}

async function resolveInstance(rootDir, parsedArgs, registry, nonInteractive) {
  const existingNames = Object.keys(registry.instances || {});

  if (nonInteractive) {
    const instanceName = String(
      pickSetting({ cli: parsedArgs, cliKey: "instanceName", envKey: "KJ_INSTALL_INSTANCE_NAME", fallback: "default" })
    );
    const action = String(
      pickSetting({ cli: parsedArgs, cliKey: "instanceAction", envKey: "KJ_INSTALL_INSTANCE_ACTION", fallback: "" })
    );
    const exists = Boolean(registry.instances?.[instanceName]);
    const resolvedAction = action || (exists ? "update" : "add");

    if (!["add", "update", "replace"].includes(resolvedAction)) {
      throw new Error("--instance-action must be one of: add, update, replace");
    }
    if (resolvedAction === "add" && exists) {
      throw new Error(`Instance '${instanceName}' already exists. Use --instance-action update|replace`);
    }
    if ((resolvedAction === "update" || resolvedAction === "replace") && !exists) {
      throw new Error(`Instance '${instanceName}' does not exist. Use --instance-action add`);
    }

    const defaultKjHome = exists
      ? registry.instances[instanceName].kjHome
      : path.join(rootDir, instanceName === "default" ? ".karajan" : `.karajan-${instanceName}`);

    return { instanceName, action: resolvedAction, defaultKjHome, existing: registry.instances[instanceName] || null };
  }

  if (existingNames.length === 0) {
    const instanceName = await ask("Nombre de instancia", "default");
    const defaultKjHome = path.join(rootDir, instanceName === "default" ? ".karajan" : `.karajan-${instanceName}`);
    return { instanceName, action: "add", defaultKjHome, existing: null };
  }

  console.log("\nInstancias detectadas:");
  for (const name of existingNames) {
    const item = registry.instances[name];
    console.log(`- ${name} (KJ_HOME: ${item.kjHome})`);
  }

  const action = await askChoice("\nSe detecta una instalacion previa. ¿Que quieres hacer?", [
    { value: "update", label: "actualizar (editar configuracion de una instancia existente)" },
    { value: "replace", label: "reemplazar (eliminar lo que hay y configurarlo todo de nuevo)" },
    { value: "add", label: "anadir nueva (crear otra instancia mas de KJ)" }
  ]);

  if (action === "add") {
    const suggested = `instance-${existingNames.length + 1}`;
    const instanceName = await ask("Nombre de nueva instancia", suggested);
    if (registry.instances[instanceName]) {
      throw new Error(`La instancia '${instanceName}' ya existe.`);
    }
    const defaultKjHome = path.join(rootDir, `.karajan-${instanceName}`);
    return { instanceName, action, defaultKjHome, existing: null };
  }

  const selected = await ask("Instancia objetivo", existingNames[0]);
  if (!registry.instances[selected]) {
    throw new Error(`No existe la instancia '${selected}'.`);
  }
  return {
    instanceName: selected,
    action,
    defaultKjHome: registry.instances[selected].kjHome,
    existing: registry.instances[selected]
  };
}

async function resolveRecoveryAction(parsedArgs, nonInteractive) {
  const prev = await loadInstallState();
  if (!prev || prev.status !== "in_progress") {
    return { action: "none", previous: null };
  }

  if (nonInteractive) {
    const recoveryAction = String(
      pickSetting({
        cli: parsedArgs,
        cliKey: "recoveryAction",
        envKey: "KJ_INSTALL_RECOVERY_ACTION",
        fallback: "continue"
      })
    );
    if (!["continue", "restart"].includes(recoveryAction)) {
      throw new Error("--recovery-action must be continue or restart");
    }
    return { action: recoveryAction, previous: prev };
  }

  const action = await askChoice(
    `\nSe detecto una instalacion interrumpida (${prev.instanceName || "desconocida"}). ¿Que quieres hacer?`,
    [
      { value: "continue", label: "continuar (retomar e intentar completar desde el estado actual)" },
      { value: "restart", label: "comenzar desde el principio (borrando lo generado para esa instancia)" }
    ]
  );
  return { action, previous: prev };
}

async function checkSelectedAgents(settings) {
  const selected = new Set([settings.coder, settings.reviewer, settings.reviewerFallback].filter(Boolean));
  const missing = [];

  for (const agent of selected) {
    const meta = AGENT_META[agent];
    if (!meta) continue;
    const ok = await ensureCommand(meta.bin);
    if (!ok) {
      missing.push({ agent, ...meta });
    }
  }

  return missing;
}

async function collectSettings(rootDir, parsedArgs, instanceContext, nonInteractive) {
  const defaults = {
    linkGlobal: nonInteractive ? false : true,
    kjHome: instanceContext.defaultKjHome,
    sonarHost: instanceContext.existing?.sonarHost || "http://localhost:9000",
    createSonarToken: false,
    sonarUser: "admin",
    sonarPassword: "",
    sonarTokenName: "karajan-cli",
    sonarToken: "",
    coder: instanceContext.existing?.coder || "codex",
    reviewer: instanceContext.existing?.reviewer || "claude",
    reviewerFallback: instanceContext.existing?.reviewerFallback || "codex",
    setupMcpClaude: true,
    setupMcpCodex: true,
    runDoctor: true,
    runTests: true
  };

  if (nonInteractive) {
    return {
      linkGlobal: parseBool(pickSetting({ cli: parsedArgs, cliKey: "linkGlobal", envKey: "KJ_INSTALL_LINK_GLOBAL", fallback: defaults.linkGlobal }), defaults.linkGlobal),
      kjHome: pickSetting({ cli: parsedArgs, cliKey: "kjHome", envKey: "KJ_INSTALL_KJ_HOME", fallback: defaults.kjHome }),
      sonarHost: pickSetting({ cli: parsedArgs, cliKey: "sonarHost", envKey: "KJ_INSTALL_SONAR_HOST", fallback: defaults.sonarHost }),
      createSonarToken: parseBool(pickSetting({ cli: parsedArgs, cliKey: "generateSonarToken", envKey: "KJ_INSTALL_GENERATE_SONAR_TOKEN", fallback: defaults.createSonarToken }), defaults.createSonarToken),
      sonarUser: pickSetting({ cli: parsedArgs, cliKey: "sonarUser", envKey: "KJ_INSTALL_SONAR_USER", fallback: defaults.sonarUser }),
      sonarPassword: pickSetting({ cli: parsedArgs, cliKey: "sonarPassword", envKey: "KJ_INSTALL_SONAR_PASSWORD", fallback: defaults.sonarPassword }),
      sonarTokenName: pickSetting({ cli: parsedArgs, cliKey: "sonarTokenName", envKey: "KJ_INSTALL_SONAR_TOKEN_NAME", fallback: defaults.sonarTokenName }),
      sonarToken: pickSetting({ cli: parsedArgs, cliKey: "sonarToken", envKey: "KJ_SONAR_TOKEN", fallback: defaults.sonarToken }),
      coder: pickSetting({ cli: parsedArgs, cliKey: "coder", envKey: "KJ_INSTALL_CODER", fallback: defaults.coder }),
      reviewer: pickSetting({ cli: parsedArgs, cliKey: "reviewer", envKey: "KJ_INSTALL_REVIEWER", fallback: defaults.reviewer }),
      reviewerFallback: pickSetting({ cli: parsedArgs, cliKey: "reviewerFallback", envKey: "KJ_INSTALL_REVIEWER_FALLBACK", fallback: defaults.reviewerFallback }),
      setupMcpClaude: parseBool(pickSetting({ cli: parsedArgs, cliKey: "setupMcpClaude", envKey: "KJ_INSTALL_SETUP_MCP_CLAUDE", fallback: defaults.setupMcpClaude }), defaults.setupMcpClaude),
      setupMcpCodex: parseBool(pickSetting({ cli: parsedArgs, cliKey: "setupMcpCodex", envKey: "KJ_INSTALL_SETUP_MCP_CODEX", fallback: defaults.setupMcpCodex }), defaults.setupMcpCodex),
      runDoctor: parseBool(pickSetting({ cli: parsedArgs, cliKey: "runDoctor", envKey: "KJ_INSTALL_RUN_DOCTOR", fallback: defaults.runDoctor }), defaults.runDoctor),
      runTests: parseBool(pickSetting({ cli: parsedArgs, cliKey: "runTests", envKey: "KJ_INSTALL_RUN_TESTS", fallback: defaults.runTests }), defaults.runTests)
    };
  }

  return {
    linkGlobal: await askBool("Link karajan binaries globally with npm link", defaults.linkGlobal),
    kjHome: await ask("KJ_HOME directory", defaults.kjHome),
    sonarHost: await ask("SonarQube host", defaults.sonarHost),
    createSonarToken: await askBool("Generate Sonar token now with admin credentials", defaults.createSonarToken),
    sonarUser: await ask("Sonar username", defaults.sonarUser),
    sonarPassword: await ask("Sonar password", defaults.sonarPassword),
    sonarTokenName: await ask("Sonar token name", defaults.sonarTokenName),
    sonarToken: await ask("Paste existing KJ_SONAR_TOKEN (optional)", defaults.sonarToken),
    coder: await ask("Default coder", defaults.coder),
    reviewer: await ask("Default reviewer", defaults.reviewer),
    reviewerFallback: await ask("Reviewer fallback", defaults.reviewerFallback),
    setupMcpClaude: await askBool("Configure Claude MCP automatically", defaults.setupMcpClaude),
    setupMcpCodex: await askBool("Configure Codex MCP automatically", defaults.setupMcpCodex),
    runDoctor: await askBool("Run kj doctor now", defaults.runDoctor),
    runTests: await askBool("Run tests now", defaults.runTests)
  };
}

async function main() {
  const parsedArgs = parseArgs(process.argv.slice(2));
  if (parsedArgs.help) {
    printHelp();
    return;
  }

  printHeader();

  const rootDir = process.cwd();
  const nonInteractive = parseBool(
    pickSetting({ cli: parsedArgs, cliKey: "nonInteractive", envKey: "KJ_INSTALL_NON_INTERACTIVE", fallback: false }),
    false
  );

  console.log("Checking base requirements...");
  const required = ["node", "npm", "git", "docker", "curl"];
  for (const cmd of required) {
    const ok = await ensureCommand(cmd);
    if (!ok) throw new Error(`Missing required command: ${cmd}`);
  }

  console.log("Installing dependencies...");
  let res = await run("npm", ["install"], { cwd: rootDir });
  if (res.exitCode !== 0) throw new Error(res.stderr || res.stdout || "npm install failed");

  const recovery = await resolveRecoveryAction(parsedArgs, nonInteractive);
  if (recovery.action === "restart" && recovery.previous?.kjHome) {
    console.log(`Reiniciando instalacion previa. Limpiando ${recovery.previous.kjHome} ...`);
    await fs.rm(recovery.previous.kjHome, { recursive: true, force: true });
    await fs.rm(path.join(rootDir, "kj.config.yml"), { force: true });
    await fs.rm(path.join(rootDir, "review-rules.md"), { force: true });
  }

  const registry = await loadRegistry();
  const instance = await resolveInstance(rootDir, parsedArgs, registry, nonInteractive);
  const settings = await collectSettings(rootDir, parsedArgs, instance, nonInteractive);

  await saveInstallState({
    status: "in_progress",
    startedAt: new Date().toISOString(),
    rootDir,
    instanceName: instance.instanceName,
    action: instance.action,
    kjHome: settings.kjHome
  });

  if (instance.action === "replace") {
    console.log(`Reemplazando instancia '${instance.instanceName}'...`);
    await fs.rm(settings.kjHome, { recursive: true, force: true });
    await fs.rm(path.join(rootDir, "kj.config.yml"), { force: true });
    await fs.rm(path.join(rootDir, "review-rules.md"), { force: true });
  }

  const missingAgents = await checkSelectedAgents(settings);
  if (missingAgents.length > 0) {
    console.warn("\nWARNING: Faltan CLIs de IA seleccionados. La instalacion continua, pero kj fallara al ejecutar esos agentes.\n");
    for (const item of missingAgents) {
      console.warn(`- ${item.agent}: comando '${item.bin}' no encontrado`);
      console.warn(`  Instala aqui: ${item.installUrl}`);
    }
    console.warn("");
  }

  if (settings.linkGlobal) {
    res = await run("npm", ["link"], { cwd: rootDir });
    if (res.exitCode !== 0) throw new Error(res.stderr || res.stdout || "npm link failed");
  }

  let sonarToken = settings.sonarToken || "";
  if (settings.createSonarToken) {
    if (!settings.sonarPassword) {
      if (nonInteractive) {
        throw new Error("Non-interactive mode requires --sonar-password when --generate-sonar-token=true");
      }
      console.log("No Sonar password provided. Skipping automatic token generation.");
      sonarToken = await ask("Paste existing KJ_SONAR_TOKEN (optional)", "");
    } else {
      sonarToken = await generateSonarToken({
        host: settings.sonarHost,
        user: settings.sonarUser,
        password: settings.sonarPassword,
        tokenName: settings.sonarTokenName
      });
      console.log("Sonar token generated.");
    }
  }

  const envPath = await writeKarajanEnv({ kjHome: settings.kjHome, sonarToken, sonarHost: settings.sonarHost });
  const configPath = await bootstrapKjConfig({
    rootDir,
    kjHome: settings.kjHome,
    sonarToken,
    sonarHost: settings.sonarHost,
    coder: settings.coder,
    reviewer: settings.reviewer,
    reviewerFallback: settings.reviewerFallback
  });

  let claudePath = "";
  if (settings.setupMcpClaude) claudePath = await setupClaudeMcp({ rootDir, kjHome: settings.kjHome });

  let codexPath = "";
  if (settings.setupMcpCodex) codexPath = await setupCodexMcp({ rootDir, kjHome: settings.kjHome });

  if (settings.runDoctor) {
    const env = { ...process.env, KJ_HOME: settings.kjHome };
    if (sonarToken) env.KJ_SONAR_TOKEN = sonarToken;
    const doctor = await run("node", [path.join(rootDir, "src", "cli.js"), "doctor"], { env, cwd: rootDir });
    console.log(doctor.stdout || doctor.stderr);
  }

  if (settings.runTests) {
    console.log("Running tests...");
    const testRes = await run("npm", ["test"], { cwd: rootDir });
    console.log(testRes.stdout || testRes.stderr);
    if (testRes.exitCode !== 0) {
      console.warn("WARNING: Some tests failed. Review the output above.");
    }
  }

  registry.instances = registry.instances || {};
  registry.instances[instance.instanceName] = {
    name: instance.instanceName,
    kjHome: settings.kjHome,
    sonarHost: settings.sonarHost,
    coder: settings.coder,
    reviewer: settings.reviewer,
    reviewerFallback: settings.reviewerFallback,
    repoPath: rootDir,
    updatedAt: new Date().toISOString()
  };
  await saveRegistry(registry);
  await clearInstallState();

  const shellProfiles = await addSourceToShellProfile(envPath);

  console.log("\nSetup completed.\n");
  console.log(`- Instance: ${instance.instanceName}`);
  console.log(`- Action: ${instance.action}`);
  console.log(`- Env file: ${envPath}`);
  console.log(`- Project config: ${configPath}`);
  if (claudePath) console.log(`- Claude MCP configured: ${claudePath}`);
  if (codexPath) console.log(`- Codex MCP configured: ${codexPath}`);
  console.log(`- Registry: ${REGISTRY_PATH}`);
  if (shellProfiles.length > 0) {
    console.log(`- Shell env auto-loaded in: ${shellProfiles.join(", ")}`);
    console.log("\nReload your shell or run:");
    console.log(`  source ${envPath}`);
  } else {
    console.log("\nNo shell profile found. Add this to your shell profile manually:");
    console.log(`  source ${envPath}`);
  }
  console.log("\nThen you can ask either assistant to run tasks through MCP tools (kj_run, kj_scan, ...).\n");
}

main()
  .catch((error) => {
    console.error(`\nInstaller failed: ${error.message}`);
    process.exit(1);
  })
  .finally(async () => {
    await rl.close();
  });
