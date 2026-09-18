/**
 * MCP smoke for verify-pack (KJC-TSK-0844) — the karajan-mcp server of the
 * INSTALLED tarball is started over stdio with the SDK client and exercised
 * with kj_status, kj_config and kj_review, no LLM involved. The MCP surface
 * was only proved by tests with every seam mocked and dogfooded by no
 * development session; KJC-BUG-0175 (taskFile promised, never read) and
 * KJC-BUG-0176 (kjHome declared, ignored) both shipped through that gap.
 *
 * What counts as a failure: the server not answering, a tool missing from
 * the list, or a handler that never reached its gate — "Missing required
 * field", "Config file not found", "taskFile read failed", "Unknown tool".
 * A rejection the gate itself hands back (no reviewer CLI on this machine,
 * Sonar, base branch) is the expected answer of an agentless runner and is
 * said explicitly, never hidden.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const FATAL = [/Missing required field/i, /Config file not found/i, /taskFile read failed/i, /Unknown tool/i];
const TOOLS = ["kj_status", "kj_config", "kj_review"];

/** The text of a tool answer, and whether it is a failure of the contract (not of the environment). */
export function classifyAnswer(tool, text) {
  const fatal = FATAL.find((re) => re.test(text));
  if (fatal) return { tool, ok: false, reason: `${tool} answered "${text.match(fatal)[0]}": the handler never reached its gate` };
  let parsed = null;
  try { parsed = JSON.parse(text); } catch { /* not JSON: plain text answer */ }
  if (parsed && parsed.ok === false) return { tool, ok: true, gated: true, reason: String(parsed.error || "").slice(0, 200) };
  return { tool, ok: true, gated: false };
}

/**
 * @param {object} o
 * @param {string} o.serverPath - src/mcp/server.js of the install under test
 * @param {string} o.kjHome - a home holding kj.config.yml (passed as the tool's `kjHome` AND as KARAJAN_HOME)
 * @param {string} o.projectDir - an initialised git repo with a task file
 * @param {string} o.taskFile - path of the task (.md) relative to projectDir
 * @returns {Promise<{ok: boolean, findings: string[], answers: object[]}>}
 */
export async function mcpSmoke({ serverPath, kjHome, projectDir, taskFile, env = process.env, timeoutMs = 120_000 }) {
  const findings = [];
  const answers = [];
  const transport = new StdioClientTransport({
    command: process.execPath, args: [serverPath], cwd: projectDir, stderr: "pipe",
    env: { ...env, KARAJAN_HOME: kjHome },
  });
  const client = new Client({ name: "kj-verify-pack", version: "0" });
  const call = async (name, args) => {
    const res = await client.callTool({ name, arguments: args }, undefined, { timeout: timeoutMs });
    const text = (res.content || []).map((c) => c.text || "").join("\n");
    const verdict = classifyAnswer(name, text);
    answers.push(verdict);
    if (!verdict.ok) findings.push(verdict.reason);
    return verdict;
  };
  try {
    await client.connect(transport);
    const listed = new Set((await client.listTools()).tools.map((t) => t.name));
    for (const t of TOOLS) if (!listed.has(t)) findings.push(`${t} is not listed by the server`);
    if (findings.length > 0) return { ok: false, findings, answers };
    // A project that never ran has no run log: that answer is the contract, not a refusal.
    const status = await call("kj_status", { kjHome, projectDir, lines: 5 });
    if (status.gated && !/no active run log/i.test(status.reason)) findings.push(`kj_status refused: ${status.reason}`);
    const config = await call("kj_config", { kjHome, json: true });
    if (config.gated) findings.push(`kj_config refused: ${config.reason}`);
    // The task travels ONLY as a file: the handler must read it before any
    // gate. The reviewer is a name no machine has, so the gate stops the call
    // before a single LLM token, on a laptop with real agents as much as in CI.
    await call("kj_review", { kjHome, projectDir, taskFile, reviewer: "kj-verify-stub" });
  } catch (err) {
    findings.push(`MCP session failed: ${err.message}`);
  } finally {
    await client.close().catch(() => {});
  }
  return { ok: findings.length === 0, findings, answers };
}
