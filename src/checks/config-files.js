/**
 * Config and rule-file checks.
 *
 * Covers:
 *   - kj.config.yml existence (strategy: prompt — offer to run kj init)
 *   - Review / coder rules discovery (strategy: none, informational)
 *   - Agent config files: ~/.claude.json, ~/.codex/config.toml,
 *     ~/.karajan/kj.config.yml (strategy: manual — structural fixes needed)
 */

import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { exists } from "../utils/fs.js";
import { getConfigPath } from "../config.js";
import { resolveRoleMdPath, loadFirstExisting } from "../roles/base-role.js";
import { withDocLink } from "../utils/doc-links.js";
import { STRATEGY } from "./types.js";

/**
 * kj.config.yml presence check.
 */
function createConfigFileCheck() {
  return {
    name: "config",
    label: "Config file",
    strategy: STRATEGY.PROMPT,
    describe: "Run 'kj init' to scaffold a default kj.config.yml",
    async detect() {
      const configPath = getConfigPath();
      const configExists = await exists(configPath);
      return {
        ok: configExists,
        severity: "fail",
        detail: configExists ? configPath : "Not found",
        fix: configExists ? undefined : withDocLink("Run 'kj init' to create the config file.", "config_missing"),
      };
    },
  };
}

/**
 * Review rules (.md) informational check.
 */
function createReviewRulesCheck() {
  return {
    name: "review-rules",
    label: "Reviewer rules (.md)",
    strategy: STRATEGY.NONE,
    async detect({ config }) {
      const projectDir = config.projectDir || process.cwd();
      const paths = resolveRoleMdPath("reviewer", projectDir);
      const rules = await loadFirstExisting(paths);
      return {
        ok: true,
        severity: "info",
        detail: rules ? "Found" : "Not found (will use defaults)",
      };
    },
  };
}

/**
 * Coder rules (.md) informational check.
 */
function createCoderRulesCheck() {
  return {
    name: "coder-rules",
    label: "Coder rules (.md)",
    strategy: STRATEGY.NONE,
    async detect({ config }) {
      const projectDir = config.projectDir || process.cwd();
      const paths = resolveRoleMdPath("coder", projectDir);
      const rules = await loadFirstExisting(paths);
      return {
        ok: true,
        severity: "info",
        detail: rules ? "Found" : "Not found (will use defaults)",
      };
    },
  };
}

/**
 * Detect duplicate TOML table headers (e.g. [mcp_servers."karajan-mcp"] twice).
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

/**
 * Claude config (~/.claude.json) validity.
 */
function createClaudeConfigCheck() {
  return {
    name: "agent-config:claude",
    label: "Agent config: claude (~/.claude.json)",
    strategy: STRATEGY.MANUAL,
    async detect() {
      const home = os.homedir();
      const claudeJsonPath = path.join(home, ".claude.json");
      try {
        const raw = await fs.readFile(claudeJsonPath, "utf8");
        JSON.parse(raw);
        return { ok: true, severity: "info", detail: "Valid JSON" };
      } catch (err) {
        if (err.code === "ENOENT") {
          // Not configured: Claude may not be in use. Informational skip.
          return { ok: true, severity: "info", detail: "Not present (skipped)" };
        }
        return {
          ok: false,
          severity: "warn",
          detail: `Invalid JSON: ${err.message.split("\n")[0]}`,
          fix: "Fix the JSON syntax in ~/.claude.json. Common issues: trailing commas, missing quotes.",
        };
      }
    },
  };
}

/**
 * KJC-BUG-0171: the karajan-mcp server path registered in ~/.claude.json.
 * Returns the args entry that points at the MCP server (…/mcp/server.js), or
 * null when karajan-mcp is not registered.
 */
export function karajanMcpServerPath(config) {
  const server = config?.mcpServers?.["karajan-mcp"];
  const args = Array.isArray(server?.args) ? server.args : [];
  return args.find((a) => typeof a === "string" && /[\\/]mcp[\\/]server\.js$/.test(a)) ?? null;
}

/**
 * Repair a stale karajan-mcp registration in place: re-point it to this
 * install's server when that server exists, or drop the dead entry when this
 * install has no bundled server (the standalone binary). `serverExists` is
 * injectable for tests. Mutates `config`; returns "repointed" | "removed" | null.
 */
export function repairKarajanMcpPath(config, correctServerPath, serverExists) {
  const server = config?.mcpServers?.["karajan-mcp"];
  if (!server) return null;
  if (correctServerPath && serverExists(correctServerPath)) {
    server.args = [correctServerPath];
    server.cwd = path.resolve(path.dirname(correctServerPath), "..", "..");
    return "repointed";
  }
  delete config.mcpServers["karajan-mcp"];
  return "removed";
}

/**
 * karajan-mcp registration path validity (~/.claude.json) — KJC-BUG-0171.
 * A verify/temp install used to register the MCP at a throwaway prefix; once
 * cleaned, the path 404s and every session's MCP fails with CONNECTION_CLOSED,
 * and the health check never caught it (it spawns its OWN bundled server).
 */
function createStaleMcpPathCheck() {
  return {
    name: "agent-config:karajan-mcp-path",
    label: "MCP registration path (~/.claude.json)",
    strategy: STRATEGY.PROMPT,
    describe: "Re-point karajan-mcp in ~/.claude.json to this install's server (or drop a dead entry)",
    async detect() {
      const claudeJsonPath = path.join(os.homedir(), ".claude.json");
      let config;
      try {
        config = JSON.parse(await fs.readFile(claudeJsonPath, "utf8"));
      } catch {
        return { ok: true, severity: "info", detail: "Not present or unparseable (skipped)" };
      }
      const registered = karajanMcpServerPath(config);
      if (!registered) return { ok: true, severity: "info", detail: "karajan-mcp not registered (skipped)" };
      if (await exists(registered)) return { ok: true, severity: "info", detail: "karajan-mcp path valid" };
      const correct = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "mcp", "server.js");
      return {
        ok: false,
        severity: "warn",
        detail: `karajan-mcp points at a path that no longer exists: ${registered} — this is the CONNECTION_CLOSED cause`,
        fix: `Re-point karajan-mcp to ${correct} (or remove the entry) in ~/.claude.json`,
        extra: { claudeJsonPath, correct },
      };
    },
    async remediate({ extra }) {
      try {
        const config = JSON.parse(await fs.readFile(extra.claudeJsonPath, "utf8"));
        const action = repairKarajanMcpPath(config, extra.correct, existsSync);
        if (!action) return { fixed: false, detail: "karajan-mcp entry vanished before repair" };
        await fs.writeFile(extra.claudeJsonPath, `${JSON.stringify(config, null, 2)}\n`);
        return {
          fixed: true,
          detail: action === "repointed" ? `Re-pointed karajan-mcp to ${extra.correct}` : "Removed the dead karajan-mcp entry",
        };
      } catch (err) {
        return { fixed: false, detail: `Failed to repair ~/.claude.json: ${err.message}` };
      }
    },
  };
}

/**
 * Codex config (~/.codex/config.toml) validity.
 */
function createCodexConfigCheck() {
  return {
    name: "agent-config:codex",
    label: "Agent config: codex (~/.codex/config.toml)",
    strategy: STRATEGY.MANUAL,
    async detect() {
      const home = os.homedir();
      const codexTomlPath = path.join(home, ".codex", "config.toml");
      try {
        const raw = await fs.readFile(codexTomlPath, "utf8");
        const duplicates = findDuplicateTomlKeys(raw);
        if (duplicates.length > 0) {
          return {
            ok: false,
            severity: "warn",
            detail: `Duplicate TOML keys: ${duplicates.join(", ")}`,
            fix: `Remove duplicate entries in ~/.codex/config.toml: ${duplicates.join(", ")}`,
          };
        }
        return { ok: true, severity: "info", detail: "Valid TOML (no duplicate keys)" };
      } catch (err) {
        if (err.code === "ENOENT") {
          return { ok: true, severity: "info", detail: "Not present (skipped)" };
        }
        return {
          ok: false,
          severity: "warn",
          detail: `Cannot read: ${err.message.split("\n")[0]}`,
          fix: "Check file permissions on ~/.codex/config.toml",
        };
      }
    },
  };
}

/**
 * KJ config (~/.karajan/kj.config.yml) YAML validity (separate from existence).
 */
function createKjConfigYamlCheck() {
  return {
    name: "agent-config:karajan",
    label: "Agent config: karajan (kj.config.yml)",
    strategy: STRATEGY.MANUAL,
    async detect() {
      const kjConfigPath = getConfigPath();
      try {
        const raw = await fs.readFile(kjConfigPath, "utf8");
        const yaml = await import("js-yaml");
        yaml.default.load(raw);
        return { ok: true, severity: "info", detail: "Valid YAML" };
      } catch (err) {
        if (err.code === "ENOENT") {
          // Covered by createConfigFileCheck — don't duplicate the failure
          return { ok: true, severity: "info", detail: "Not present (covered by config check)" };
        }
        return {
          ok: false,
          severity: "fail",
          detail: `Invalid YAML: ${err.message.split("\n")[0]}`,
          fix: `Fix YAML syntax in ${kjConfigPath}. Run 'kj init' to regenerate if needed.`,
        };
      }
    },
  };
}

/**
 * Aggregate: all config-file-related checks.
 * @returns {import("./types.js").Check[]}
 */
export function getConfigFileChecks() {
  return [
    createConfigFileCheck(),
    createReviewRulesCheck(),
    createCoderRulesCheck(),
    createClaudeConfigCheck(),
    createStaleMcpPathCheck(),
    createCodexConfigCheck(),
    createKjConfigYamlCheck(),
  ];
}
