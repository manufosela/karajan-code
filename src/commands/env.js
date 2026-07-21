/**
 * `kj env install` (ENV-A1/E1, KJC-TSK-0639/0640) — install/refresh the
 * Karajan Environment playbook as a managed block in the host agents' rule
 * files (CLAUDE.md, AGENTS.md), and make its step 1 real: when the project
 * has no RAG index yet, build it (default ON, `--no-rag` opts out).
 */
import { installPlaybook } from "../environment/playbook.js";
import { renderBrief, listBriefs } from "../environment/briefs.js";
import { openVecStore, projectSlug, getLastIndexedCommit } from "../rag/vec-store.js";
import { ragIndexCommand } from "./rag.js";
import { renderPendingBlock, PENDING_EXIT_CODE } from "../utils/pending-user-action.js";

function hasRagIndex(config, projectDir) {
  const db = openVecStore({ dim: config?.rag?.embedder?.dim || 768 });
  try { return Boolean(getLastIndexedCommit(db, projectSlug(projectDir))); }
  finally { db.close(); }
}

/**
 * `kj brief [role]` (AB-C, KJC-TSK-0652) — the distilled method of a role,
 * for the brain to execute or delegate. No role → list them.
 */
export function briefCommand({ config = null, flags = {}, role = null }) {
  if (!role) {
    const list = listBriefs();
    if (flags.json) { console.log(JSON.stringify(list, null, 2)); return list; }
    console.log("Available role briefs (kj brief <role>):");
    for (const { role: r, purpose } of list) console.log(`  ${r.padEnd(11)} ${purpose}`);
    return list;
  }
  const text = renderBrief(role, config || {});
  if (flags.json) { console.log(JSON.stringify({ role, brief: text })); return { role, brief: text }; }
  console.log(text);
  return { role, brief: text };
}

export async function envInstallCommand({ config = null, logger = null, flags = {} }) {
  const projectDir = config?.projectDir || process.cwd();
  const result = await installPlaybook({
    projectDir, target: flags.target || "all",
    stateBackend: config?.state_backend || "hu-board",
  });
  console.log(`✓ Karajan playbook installed in: ${result.files.join(", ")}`);

  // ENV-E1: RAG-first — the playbook orders "query the RAG before coding",
  // so installing the environment guarantees the index exists. KJC-TSK-0659
  // stop-on-sudo: an index that cannot be built is a BLOCKING condition —
  // "success" with 0 chunks would leave every future session running the
  // method against an empty RAG (field-reproduced: 0/727 without Ollama).
  // The playbook stays installed; the command exits 3 so the driving agent
  // stops, shows the block, and waits for the user.
  if (flags.rag !== false) {
    const provider = config?.rag?.embedder?.provider || "ollama";
    const blockRag = (why) => {
      result.ragError = why;
      result.exitCode = PENDING_EXIT_CODE;
      const item = provider === "ollama"
        ? { tool: "ollama", action: "needs-user", reason: `the RAG cannot index: ${why}` }
        : { tool: `${provider} embedder`, action: "needs-user", reason: `the RAG cannot index: ${why} — check rag.embedder in kj config`, manualUrl: "kj config" };
      console.log(renderPendingBlock([item], { retry: "kj rag index --with-sources   (then re-run: kj env install)" }));
    };
    try {
      if (hasRagIndex(config, projectDir)) {
        console.log("✓ RAG index present");
      } else {
        console.log("⏳ no RAG index for this project — building it (first time only)…");
        const totals = await ragIndexCommand({ config, logger, flags: { withSources: true } });
        if ((totals?.indexed ?? 0) === 0 && (totals?.files ?? 0) > 0) {
          blockRag(`0 of ${totals.files} files indexed — is the embedder running?`);
        }
      }
    } catch (err) {
      blockRag(err.message);
    }
  }
  if (result.exitCode !== PENDING_EXIT_CODE) {
    console.log("  The host agent now follows the method: RAG first, TDD, cross-AI review before commit.");
  }
  return result;
}
