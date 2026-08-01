/**
 * `kj env install` (ENV-A1/E1, KJC-TSK-0639/0640) — install/refresh the
 * Karajan Environment playbook as a managed block in the host agents' rule
 * files (CLAUDE.md, AGENTS.md), and make its step 1 real: when the project
 * has no RAG index yet, build it (default ON, `--no-rag` opts out).
 */
import { installPlaybook } from "../environment/playbook.js";
import { renderBrief, listBriefs } from "../environment/briefs.js";
import { existsSync } from "node:fs";
import { openVecStore, projectSlug, getLastIndexedCommit, dbPath } from "../rag/vec-store.js";
import { ragIndexCommand } from "./rag.js";
import { renderPendingBlock, PENDING_EXIT_CODE } from "../utils/pending-user-action.js";
import { onnxConfig, persistOnnxChoice, resetEmptyStore } from "../rag/onnx-fallback.js";
import { verifyBoardAccess } from "../environment/board-access.js";
import { ensurePrivacyList } from "../privacy/onboarding.js";
import { createWizard } from "../utils/wizard.js";

function hasRagIndex(config, projectDir) {
  // KJC-BUG-0128: probing must never CREATE the store — openVecStore runs
  // the DDL, and a table born at the default dim (768) breaks the ONNX
  // fallback (384) later. No file → no index, without side effects.
  if (!existsSync(dbPath())) return false;
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
    boardName: config?.board?.name || null,
  });
  console.log(`✓ Karajan playbook installed in: ${result.files.join(", ")}`);

  // KJC-TSK-0685 (user rule): Karajan does not run without a board — it is
  // what guarantees ordered, card-first work. Verify an OPERATIONAL access
  // path to the declared backend BEFORE anything else; no path → block
  // (exit 3) with the exact steps. The playbook stays installed.
  const access = verifyBoardAccess({ config, projectDir });
  if (!access.ok) {
    result.boardError = access.needed.join(" | ");
    result.exitCode = PENDING_EXIT_CODE;
    console.log(renderPendingBlock(
      [{ tool: `${access.name || access.backend} board`, action: "needs-user", reason: `Karajan does not run without a board. To use ${access.name || access.backend}: ${access.needed.join(" ")}` }],
      { retry: "kj env install" },
    ));
    return result;
  }
  if (access.backend !== "hu-board") console.log(`✓ board access verified: ${access.via}`);

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
    // KJC-TSK-0683: on limited machines (no Ollama, no Docker) the DEFAULT
    // provider falls back to the built-in ONNX embedder instead of blocking.
    // Only for the first index and only when the user didn't pick a provider
    // explicitly — the election is persisted (dims differ, it must stick).
    const explicitProvider = Boolean(config?.rag?.embedder?.provider);
    const tryOnnxFallback = async (why) => {
      if (explicitProvider) return false;
      console.log(`⚠ default embedder unavailable (${why}) — trying the built-in ONNX embedder (no install needed)…`);
      try {
        // KJC-BUG-0128: an empty store may carry a vec table at the wrong
        // dim (the old probe created it at 768) — reset it so ONNX (384)
        // can index. A store with data is never touched.
        if (!resetEmptyStore()) {
          console.log("  the vector store already has data at another dimension — not switching automatically");
          return false;
        }
        const totals = await ragIndexCommand({ config: onnxConfig(config), logger, flags: { withSources: true } });
        if ((totals?.indexed ?? 0) > 0) {
          const p = await persistOnnxChoice(projectDir);
          console.log(`✓ RAG indexed with the built-in ONNX embedder — persisted in ${p}`);
          console.log("  To move to Ollama later: install it, remove the rag.embedder block from .karajan/kj.config.yml,");
          console.log("  delete the store (~/.karajan/rag.db) and run: kj rag index --with-sources");
          return true;
        }
      } catch (fallbackErr) {
        console.log(`  ONNX fallback also failed: ${fallbackErr.message}`);
      }
      return false;
    };
    try {
      if (hasRagIndex(config, projectDir)) {
        console.log("✓ RAG index present");
      } else {
        console.log("⏳ no RAG index for this project — building it (first time only)…");
        const totals = await ragIndexCommand({ config, logger, flags: { withSources: true } });
        if ((totals?.indexed ?? 0) === 0 && (totals?.files ?? 0) > 0) {
          const why = `0 of ${totals.files} files indexed — is the embedder running?`;
          if (!(await tryOnnxFallback(why))) blockRag(why);
        }
      }
    } catch (err) {
      if (!(await tryOnnxFallback(err.message))) blockRag(err.message);
    }
  }
  if (result.exitCode !== PENDING_EXIT_CODE) {
    // KJC-TSK-0707 (PV-D) — privacy onboarding rides the install: kj asks,
    // kj writes the denylist. Best-effort (stubbed in the SEA binary).
    try {
      const wizard = process.stdin.isTTY && process.stdout.isTTY ? createWizard() : null;
      await ensurePrivacyList({ wizard, logger: console, isTTY: Boolean(wizard) });
      wizard?.close();
    } catch { /* privacy onboarding is best-effort */ }
    console.log("  The host agent now follows the method: RAG first, TDD, cross-AI review before commit.");
  }
  return result;
}
