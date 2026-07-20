/**
 * `kj env install` (ENV-A1/E1, KJC-TSK-0639/0640) — install/refresh the
 * Karajan Environment playbook as a managed block in the host agents' rule
 * files (CLAUDE.md, AGENTS.md), and make its step 1 real: when the project
 * has no RAG index yet, build it (default ON, `--no-rag` opts out).
 */
import { installPlaybook } from "../environment/playbook.js";
import { openVecStore, projectSlug, getLastIndexedCommit } from "../rag/vec-store.js";
import { ragIndexCommand } from "./rag.js";

function hasRagIndex(config, projectDir) {
  const db = openVecStore({ dim: config?.rag?.embedder?.dim || 768 });
  try { return Boolean(getLastIndexedCommit(db, projectSlug(projectDir))); }
  finally { db.close(); }
}

export async function envInstallCommand({ config = null, logger = null, flags = {} }) {
  const projectDir = config?.projectDir || process.cwd();
  const result = await installPlaybook({
    projectDir, target: flags.target || "both",
    stateBackend: config?.state_backend || "hu-board",
  });
  console.log(`✓ Karajan playbook installed in: ${result.files.join(", ")}`);

  // ENV-E1: RAG-first — the playbook orders "query the RAG before coding",
  // so installing the environment guarantees the index exists. An indexing
  // failure is reported but never blocks the playbook install.
  if (flags.rag !== false) {
    try {
      if (hasRagIndex(config, projectDir)) {
        console.log("✓ RAG index present");
      } else {
        console.log("⏳ no RAG index for this project — building it (first time only)…");
        await ragIndexCommand({ config, logger, flags: { withSources: true } });
      }
    } catch (err) {
      result.ragError = err.message;
      console.log(`⚠ RAG index could not be built (${err.message}) — run \`kj rag index --with-sources\` later`);
    }
  }
  console.log("  The host agent now follows the method: RAG first, TDD, cross-AI review before commit.");
  return result;
}
