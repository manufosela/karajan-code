import fs from "node:fs/promises";
import { spawnSync } from "node:child_process";
import yaml from "js-yaml";
import { loadConfig, validateConfig, getConfigPath, writeConfig } from "../config.js";
import { ensureDir } from "../utils/fs.js";
import path from "node:path";

function resolveEditor() {
  const raw = process.env.VISUAL || process.env.EDITOR || "vi";
  const parts = raw.split(/\s+/);
  return { cmd: parts[0], args: parts.slice(1) };
}

export async function editConfigOnce(configPath) {
  const { cmd, args } = resolveEditor();
  const result = spawnSync(cmd, [...args, configPath], { stdio: "inherit" });

  if (result.status !== 0) {
    return { ok: false, error: `Editor exited with code ${result.status}` };
  }

  let raw;
  try {
    raw = await fs.readFile(configPath, "utf8");
  } catch (err) {
    return { ok: false, error: `Could not read config: ${err.message}` };
  }

  let parsed;
  try {
    parsed = yaml.load(raw);
  } catch (err) {
    return { ok: false, error: `Invalid YAML: ${err.message}` };
  }

  try {
    validateConfig(parsed || {});
  } catch (err) {
    return { ok: false, error: err.message };
  }

  return { ok: true, config: parsed };
}

export async function configCommand({ json = false, edit = false }) {
  if (edit) {
    const configPath = getConfigPath();
    await ensureDir(path.dirname(configPath));
    const { exists: configExists } = await loadConfig();
    if (!configExists) {
      const { config: defaults } = await loadConfig();
      await writeConfig(configPath, defaults);
    }

    const result = await editConfigOnce(configPath);
    if (result.ok) {
      console.log("Configuration saved and validated.");
    } else {
      console.error(`Validation error: ${result.error}`);
      process.exitCode = 1;
    }
    return;
  }

  const { config, path: cfgPath, exists } = await loadConfig();
  if (json) {
    console.log(JSON.stringify({ path: cfgPath, exists, config }, null, 2));
    return;
  }

  console.log(`Config path: ${cfgPath}`);
  console.log(`Exists: ${exists}`);
  console.log(JSON.stringify(config, null, 2));
}
