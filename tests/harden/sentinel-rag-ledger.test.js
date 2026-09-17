// KJC-TSK-0847 (ADR 0010, RAG-A) — the session ledger of what the RAG
// answered: every kj_rag_query (MCP) and kj rag query (CLI) with the
// repo-relative sources it returned. Recorded by the PostToolUse hook,
// because neither the CLI nor the MCP know the host's session id.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync, execSync } from "node:child_process";
import { installSentinelHooks } from "../../src/harden/sentinel-hooks.js";

let dir, post, stop, statePath;
const env = { KJ_ALLOW_IDENTITY: "1" };
const run = (payload) => spawnSync("node", [post], { input: JSON.stringify({ session_id: "s1", ...payload }), encoding: "utf8", cwd: dir, env: { ...process.env, ...env } });
const mcpQuery = (text, hits) => run({
  tool_name: "mcp__karajan-mcp__kj_rag_query", tool_input: { text, projectDir: dir },
  tool_response: { content: [{ type: "text", text: JSON.stringify({ hits: hits.map((source) => ({ source, kind: "code", text: "…" })), empty: false, project: "x" }) }] },
});
const cliQuery = (command, stdout) => run({ tool_name: "Bash", tool_input: { command }, tool_response: { stdout, stderr: "" } });
const session = () => JSON.parse(fs.readFileSync(statePath, "utf8")).sessions.s1;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-rag-ledger-"));
  execSync("git init -q -b main && git commit -q --allow-empty -m init", { cwd: dir, env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.com", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.com" } });
  installSentinelHooks({ projectDir: dir });
  post = path.join(dir, ".karajan", "harness", "posttooluse.mjs");
  stop = path.join(dir, ".karajan", "harness", "stop.mjs");
  statePath = path.join(dir, ".karajan", "harness", "sentinel-state.json");
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("rag ledger (PostToolUse)", () => {
  it("records an MCP kj_rag_query with the repo-relative hits, dropping other projects' sources", () => {
    expect(mcpQuery("where is KJ_HOME read", [`${dir}/src/paths.js`, `${dir}/scripts/postinstall.js`, "/elsewhere/other-project/src/x.js"]).status).toBe(0);
    const s = session();
    expect(s.rag_queries).toHaveLength(1);
    expect(s.rag_queries[0]).toMatchObject({ text: "where is KJ_HOME read", hits: ["src/paths.js", "scripts/postinstall.js"] });
    expect(s.rag_hits).toEqual(["src/paths.js", "scripts/postinstall.js"]);
  });

  it("records a CLI kj rag query from its human output and its --json output, without duplicates", () => {
    const human = `[code · resolveHome · score=0.1234] ${dir}/src/paths.js\nexport function resolveHome…\n\n[code · main · score=0.2] /elsewhere/x.js\n[code · x · score=0.3] ${dir}/src/my file.js\n`;
    expect(cliQuery("kj rag query --scope code 'karajan home'", human).status).toBe(0);
    const json = JSON.stringify([{ source: `${dir}/src/paths.js`, kind: "code" }, { source: `${dir}/src/config/loader.js`, kind: "code" }]);
    expect(cliQuery("kj rag query --json 'config path'", json).status).toBe(0);
    const s = session();
    expect(s.rag_queries.map((q) => q.hits)).toEqual([["src/paths.js", "src/my file.js"], ["src/paths.js", "src/config/loader.js"]]);
    expect(s.rag_queries[0].text).toMatch(/^kj rag query --scope code/);
    expect(s.rag_hits).toEqual(["src/paths.js", "src/my file.js", "src/config/loader.js"]);
  });

  it("shows the ledger in the status line", () => {
    mcpQuery("q", [`${dir}/src/a.js`]);
    const r = spawnSync("node", [stop, "--status"], { encoding: "utf8", cwd: dir, env: { ...process.env, ...env } });
    expect(r.stdout).toMatch(/rag=1 queries\/1 sources/);
  });
});
