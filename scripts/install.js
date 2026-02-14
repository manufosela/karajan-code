#!/usr/bin/env node
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

const rl = readline.createInterface({ input, output });

function printHeader() {
  console.log("\nKarajan Code Installer\n");
}

function printHelp() {
  console.log(`Usage:
  ./scripts/install.sh [options]
  node scripts/install.js [options]

Options:
  --non-interactive               Run without prompts (CI-friendly)
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
  --help                          Show this help

Environment variable equivalents:
  KJ_INSTALL_NON_INTERACTIVE
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

async function readJson(file) {
  const raw = await fs.readFile(file, "utf8");
  return JSON.parse(raw);
}

async function writeJson(file, obj) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(obj, null, 2)}\n`, "utf8");
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
  const claudeSettingsPath = path.join(os.homedir(), ".claude", "settings.json");
  let settings = {};
  try {
    settings = await readJson(claudeSettingsPath);
  } catch {
    settings = {};
  }

  settings.mcpServers = settings.mcpServers || {};
  settings.mcpServers["karajan-mcp"] = {
    command: "node",
    args: [path.join(rootDir, "src", "mcp", "server.js")],
    cwd: rootDir,
    env: {
      KJ_HOME: kjHome
    }
  };

  await writeJson(claudeSettingsPath, settings);
  return claudeSettingsPath;
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

async function collectSettings(rootDir, parsedArgs) {
  const kjHomeDefault = path.join(rootDir, ".karajan");
  const nonInteractive = parseBool(
    pickSetting({
      cli: parsedArgs,
      cliKey: "nonInteractive",
      envKey: "KJ_INSTALL_NON_INTERACTIVE",
      fallback: false
    }),
    false
  );

  if (nonInteractive) {
    return {
      nonInteractive,
      linkGlobal: parseBool(
        pickSetting({ cli: parsedArgs, cliKey: "linkGlobal", envKey: "KJ_INSTALL_LINK_GLOBAL", fallback: false }),
        false
      ),
      kjHome: pickSetting({ cli: parsedArgs, cliKey: "kjHome", envKey: "KJ_INSTALL_KJ_HOME", fallback: kjHomeDefault }),
      sonarHost: pickSetting({
        cli: parsedArgs,
        cliKey: "sonarHost",
        envKey: "KJ_INSTALL_SONAR_HOST",
        fallback: "http://localhost:9000"
      }),
      createSonarToken: parseBool(
        pickSetting({
          cli: parsedArgs,
          cliKey: "generateSonarToken",
          envKey: "KJ_INSTALL_GENERATE_SONAR_TOKEN",
          fallback: false
        }),
        false
      ),
      sonarUser: pickSetting({ cli: parsedArgs, cliKey: "sonarUser", envKey: "KJ_INSTALL_SONAR_USER", fallback: "admin" }),
      sonarPassword: pickSetting({
        cli: parsedArgs,
        cliKey: "sonarPassword",
        envKey: "KJ_INSTALL_SONAR_PASSWORD",
        fallback: ""
      }),
      sonarTokenName: pickSetting({
        cli: parsedArgs,
        cliKey: "sonarTokenName",
        envKey: "KJ_INSTALL_SONAR_TOKEN_NAME",
        fallback: "karajan-cli"
      }),
      sonarToken: pickSetting({ cli: parsedArgs, cliKey: "sonarToken", envKey: "KJ_SONAR_TOKEN", fallback: "" }),
      coder: pickSetting({ cli: parsedArgs, cliKey: "coder", envKey: "KJ_INSTALL_CODER", fallback: "codex" }),
      reviewer: pickSetting({ cli: parsedArgs, cliKey: "reviewer", envKey: "KJ_INSTALL_REVIEWER", fallback: "claude" }),
      reviewerFallback: pickSetting({
        cli: parsedArgs,
        cliKey: "reviewerFallback",
        envKey: "KJ_INSTALL_REVIEWER_FALLBACK",
        fallback: "codex"
      }),
      setupMcpClaude: parseBool(
        pickSetting({
          cli: parsedArgs,
          cliKey: "setupMcpClaude",
          envKey: "KJ_INSTALL_SETUP_MCP_CLAUDE",
          fallback: true
        }),
        true
      ),
      setupMcpCodex: parseBool(
        pickSetting({
          cli: parsedArgs,
          cliKey: "setupMcpCodex",
          envKey: "KJ_INSTALL_SETUP_MCP_CODEX",
          fallback: true
        }),
        true
      ),
      runDoctor: parseBool(
        pickSetting({ cli: parsedArgs, cliKey: "runDoctor", envKey: "KJ_INSTALL_RUN_DOCTOR", fallback: true }),
        true
      )
    };
  }

  const settings = {};
  settings.nonInteractive = false;
  settings.linkGlobal = await askBool("Link karajan binaries globally with npm link", true);
  settings.kjHome = await ask("KJ_HOME directory", kjHomeDefault);
  settings.sonarHost = await ask("SonarQube host", "http://localhost:9000");
  settings.createSonarToken = await askBool("Generate Sonar token now with admin credentials", true);
  settings.sonarUser = "admin";
  settings.sonarPassword = "";
  settings.sonarTokenName = "karajan-cli";
  settings.sonarToken = "";
  if (settings.createSonarToken) {
    settings.sonarUser = await ask("Sonar username", "admin");
    settings.sonarPassword = await ask("Sonar password", "");
    settings.sonarTokenName = await ask("Sonar token name", "karajan-cli");
  } else {
    settings.sonarToken = await ask("Paste existing KJ_SONAR_TOKEN (optional)", "");
  }

  settings.coder = await ask("Default coder", "codex");
  settings.reviewer = await ask("Default reviewer", "claude");
  settings.reviewerFallback = await ask("Reviewer fallback", "codex");
  settings.setupMcpClaude = await askBool("Configure Claude MCP automatically", true);
  settings.setupMcpCodex = await askBool("Configure Codex MCP automatically", true);
  settings.runDoctor = await askBool("Run kj doctor now", true);
  return settings;
}

async function main() {
  const parsedArgs = parseArgs(process.argv.slice(2));
  if (parsedArgs.help) {
    printHelp();
    return;
  }

  printHeader();

  const rootDir = process.cwd();

  console.log("Checking base requirements...");
  const required = ["node", "npm", "git", "docker", "curl"];
  for (const cmd of required) {
    const ok = await ensureCommand(cmd);
    if (!ok) {
      throw new Error(`Missing required command: ${cmd}`);
    }
  }

  const codexOk = await ensureCommand("codex");
  const claudeOk = await ensureCommand("claude");
  if (!codexOk || !claudeOk) {
    throw new Error("Both codex and claude CLIs are required for this setup");
  }

  console.log("Installing dependencies...");
  let res = await run("npm", ["install"], { cwd: rootDir });
  if (res.exitCode !== 0) throw new Error(res.stderr || res.stdout || "npm install failed");

  const settings = await collectSettings(rootDir, parsedArgs);

  if (settings.linkGlobal) {
    res = await run("npm", ["link"], { cwd: rootDir });
    if (res.exitCode !== 0) throw new Error(res.stderr || res.stdout || "npm link failed");
  }

  let sonarToken = settings.sonarToken || "";
  if (settings.createSonarToken) {
    if (!settings.sonarPassword) {
      if (settings.nonInteractive) {
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
  if (settings.setupMcpClaude) {
    claudePath = await setupClaudeMcp({ rootDir, kjHome: settings.kjHome });
  }

  let codexPath = "";
  if (settings.setupMcpCodex) {
    codexPath = await setupCodexMcp({ rootDir, kjHome: settings.kjHome });
  }

  if (settings.runDoctor) {
    const env = { ...process.env, KJ_HOME: settings.kjHome };
    if (sonarToken) env.KJ_SONAR_TOKEN = sonarToken;
    const doctor = await run("node", [path.join(rootDir, "src", "cli.js"), "doctor"], { env, cwd: rootDir });
    console.log(doctor.stdout || doctor.stderr);
  }

  console.log("\nSetup completed.\n");
  console.log(`- Env file: ${envPath}`);
  console.log(`- Project config: ${configPath}`);
  if (claudePath) console.log(`- Claude MCP configured: ${claudePath}`);
  if (codexPath) console.log(`- Codex MCP configured: ${codexPath}`);
  console.log("\nBefore opening Claude/Codex, load environment variables in your shell:");
  console.log(`  source ${envPath}`);
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
