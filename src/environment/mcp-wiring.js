/**
 * mcp-wiring — RAG as a NATIVE tool (KJC-TSK-0711). Field case 2026-08-03:
 * agents in karajan projects grep code by hand because the RAG is only "a
 * Bash command a text line told them about". Agents use the tools in their
 * toolbox, so env install wires kj's RAG-only MCP server (`kj-rag-mcp`,
 * ships with the package) into Claude Code's LOCAL scope (HU-3529: personal,
 * never the versioned `.mcp.json`, so a teammate without kj sees no broken
 * server). The legacy `kj-rag` entry in `.mcp.json` is removed, nothing else;
 * invalid JSON is left untouched (preserve, never clobber).
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// KJC-TSK-1067: a server spec that launches `qmd mcp` (command or args, any path).
const launchesQmd = (s) => Boolean(s) && typeof s === "object"
  && [s.command, ...(Array.isArray(s.args) ? s.args : [])].some((a) => typeof a === "string" && /(^|\/)qmd$/.test(a))
  && Array.isArray(s.args) && s.args.includes("mcp");

const defaultQmd = {
  installed: () => spawnSync("qmd", ["--version"], { stdio: "ignore" }).status === 0,
  // The user's own Claude Code config: global servers and every project's.
  wiredGlobally: () => {
    try {
      const c = JSON.parse(readFileSync(join(homedir(), ".claude.json"), "utf8"));
      return [c.mcpServers, ...Object.values(c.projects || {}).map((p) => p?.mcpServers)].some((m) => Object.values(m || {}).some(launchesQmd));
    } catch { return false; }
  },
};

// Wired = the LAUNCH SPEC runs kj-rag-mcp (command or an arg, so `npx
// kj-rag-mcp` and absolute paths count) — never env/description fields.
const launchesRagMcp = (s) =>
  Boolean(s) && typeof s === "object" && (
    (typeof s.command === "string" && s.command.includes("kj-rag-mcp")) ||
    (Array.isArray(s.args) && s.args.some((a) => typeof a === "string" && a.includes("kj-rag-mcp")))
  );

const RAG_ADD_ARGS = ["mcp", "add", "--scope", "local", "kj-rag", "--", "kj-rag-mcp"];
// What `claude mcp add` prints (exit 1) when the name is taken: "MCP server kj-rag already exists in local config".
const ALREADY_REGISTERED = /^MCP server kj-rag already exists\b/m;
const RAG_ADD_CMD = `claude ${RAG_ADD_ARGS.join(" ")}`;

/** Wire kj-rag-mcp at Claude Code's local scope (~/.claude.json, never versioned). "ok" or a reason. */
function wireRagLocally({ projectDir, logger }) {
  const manual = (why) => logger.warn?.(`kj env: ${why} — run this yourself in the project to get the native kj_rag_query tool: ${RAG_ADD_CMD}`);
  const added = spawnSync("claude", RAG_ADD_ARGS, { cwd: projectDir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  if (added.error) {
    manual("the claude CLI is not on PATH, so kj-rag-mcp was not wired");
    return "no-claude-cli";
  }
  if (added.status !== 0) {
    // Only the exit status and what `add` itself prints decide this; `claude mcp get` is never read.
    if (ALREADY_REGISTERED.test(`${added.stdout}${added.stderr}`)) {
      logger.warn?.("kj env: a server named kj-rag is already registered for this project; kj did not check what it launches (inspect it with `claude mcp get kj-rag`), so the native RAG tool is not confirmed");
      return "kj-rag-already-registered";
    }
    manual("`claude mcp add` failed");
    return "claude-mcp-add-failed";
  }
  logger.info?.("✓ kj_rag_query wired as a NATIVE tool (claude local scope → kj-rag-mcp): personal, nothing added to the shared .mcp.json");
  return "ok";
}

export function installProjectMcp({ projectDir = process.cwd(), logger = console, qmd = defaultQmd } = {}) {
  const mcpPath = join(projectDir, ".mcp.json");
  let cfg = {};
  let rawText = null;
  if (existsSync(mcpPath)) {
    try {
      rawText = readFileSync(mcpPath, "utf8");
      cfg = JSON.parse(rawText);
    } catch {
      logger.warn?.(`kj env: ${mcpPath} is not valid JSON — leaving it untouched (wire kj-rag-mcp manually for native RAG queries)`);
      return { wired: false, reason: "invalid-json" };
    }
  }
  if (cfg.mcpServers && typeof cfg.mcpServers !== "object") {
    logger.warn?.(`kj env: ${mcpPath} has a non-object mcpServers — leaving it untouched`);
    return { wired: false, reason: "unexpected-shape" };
  }
  cfg.mcpServers = cfg.mcpServers || {};
  // HU-3529: kj's own wiring is personal. A `kj-rag` entry an older kj wrote
  // into the shared file is removed (only that entry); the server is wired at
  // Claude Code's local scope instead.
  const strippedLegacy = launchesRagMcp(cfg.mcpServers["kj-rag"]);
  const serialize = () => writeFileSync(mcpPath, `${JSON.stringify(cfg, null, 2)}\n`);
  if (strippedLegacy) {
    delete cfg.mcpServers["kj-rag"];
    serialize(); // before calling claude; restored below if nothing gets wired
  }
  // A user's own entry that runs kj-rag-mcp counts as wired.
  if (!Object.values(cfg.mcpServers).some(launchesRagMcp)) {
    const personal = wireRagLocally({ projectDir, logger });
    if (personal !== "ok") {
      if (strippedLegacy) writeFileSync(mcpPath, rawText); // nothing wired: keep the file as it was
      return { wired: false, reason: personal };
    }
  }
  // KJC-TSK-1067: qmd answers about the project's documents with fewer tokens and a source.
  let qmdState = "absent";
  if (Object.values(cfg.mcpServers).some(launchesQmd)) qmdState = "present";
  else if (qmd.installed() && qmd.wiredGlobally()) qmdState = "global";
  else if (qmd.installed()) {
    cfg.mcpServers.qmd = { command: "qmd", args: ["mcp"] };
    qmdState = "added";
    logger.info?.("✓ qmd wired as a NATIVE tool (.mcp.json → qmd mcp): questions about docs, notes, ADRs and plans answer from the documents, with fewer tokens");
  }
  if (qmdState === "added") serialize();
  return { wired: true, qmd: qmdState };
}
