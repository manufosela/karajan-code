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

async function main() {
  printHeader();

  const rootDir = process.cwd();
  const kjHomeDefault = path.join(rootDir, ".karajan");

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

  const linkGlobal = await askBool("Link karajan binaries globally with npm link", true);
  if (linkGlobal) {
    res = await run("npm", ["link"], { cwd: rootDir });
    if (res.exitCode !== 0) throw new Error(res.stderr || res.stdout || "npm link failed");
  }

  const kjHome = await ask("KJ_HOME directory", kjHomeDefault);
  const sonarHost = await ask("SonarQube host", "http://localhost:9000");

  const createSonarToken = await askBool("Generate Sonar token now with admin credentials", true);
  let sonarToken = "";
  if (createSonarToken) {
    const sonarUser = await ask("Sonar username", "admin");
    const sonarPassword = await ask("Sonar password", "");
    const tokenName = await ask("Sonar token name", "karajan-cli");
    if (!sonarPassword) {
      console.log("No Sonar password provided. Skipping automatic token generation.");
      sonarToken = await ask("Paste existing KJ_SONAR_TOKEN (optional)", "");
    } else {
      sonarToken = await generateSonarToken({
        host: sonarHost,
        user: sonarUser,
        password: sonarPassword,
        tokenName
      });
      console.log("Sonar token generated.");
    }
  } else {
    sonarToken = await ask("Paste existing KJ_SONAR_TOKEN (optional)", "");
  }

  const coder = await ask("Default coder", "codex");
  const reviewer = await ask("Default reviewer", "claude");
  const reviewerFallback = await ask("Reviewer fallback", "codex");

  const envPath = await writeKarajanEnv({ kjHome, sonarToken, sonarHost });
  const configPath = await bootstrapKjConfig({
    rootDir,
    kjHome,
    sonarToken,
    sonarHost,
    coder,
    reviewer,
    reviewerFallback
  });

  const setupMcpClaude = await askBool("Configure Claude MCP automatically", true);
  let claudePath = "";
  if (setupMcpClaude) {
    claudePath = await setupClaudeMcp({ rootDir, kjHome });
  }

  const setupMcpCodex = await askBool("Configure Codex MCP automatically", true);
  let codexPath = "";
  if (setupMcpCodex) {
    codexPath = await setupCodexMcp({ rootDir, kjHome });
  }

  const runDoctor = await askBool("Run kj doctor now", true);
  if (runDoctor) {
    const env = { ...process.env, KJ_HOME: kjHome };
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
