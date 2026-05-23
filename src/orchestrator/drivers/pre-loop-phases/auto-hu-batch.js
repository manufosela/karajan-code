/**
 * Extracted from `src/orchestrator/drivers/pre-loop.js` in TSK-0337
 * (audit recommendation #6). Previously an internal helper inside
 * pre-loop.js; moved here so the driver stays under 600 LOC.
 * Behaviour unchanged.
 *
 * Auto-generates an HU batch from triage's decomposition recommendation
 * when no manual `huFile` is present. Runs after researcher/architect/
 * planner so context is available for better HU generation. Sets
 * `stageResults.huReviewer` so `needsSubPipeline` picks it up later.
 *
 * Side effects:
 *   - Persists `batch.json` to `~/.karajan/hu-stories/<batchSessionId>/`
 *     so the sub-pipeline can update story status via `saveHuBatch`.
 *   - Auto-starts the HU board (skipped under VITEST / NODE_ENV=test).
 */

import { emitProgress, makeEvent } from "#utils/events.js";
import { detectProjectStack } from "#utils/stack-detect.js";

export async function maybeGenerateAutoHuBatch({
  flags, stageResults, task, logger, emitter, eventBase, projectDir, session,
}) {
  // Skip if user passed a manual hu-file
  if (flags?.huFile) return;
  // Skip if hu-reviewer already produced a batch (manual enable + PG stories)
  if (stageResults.huReviewer) return;
  // Need triage decomposition recommendation
  const shouldDecompose = stageResults.triage?.shouldDecompose;
  const subtasks = stageResults.triage?.subtasks;
  if (!shouldDecompose || !Array.isArray(subtasks) || subtasks.length < 2) return;

  const { generateHuBatch } = await import("#hu/auto-generator.js");

  // Detect if project is new: empty dir or only .git/.karajan/.gitignore
  let isNewProject = false;
  try {
    const fs = await import("node:fs/promises");
    const entries = await fs.readdir(projectDir);
    const relevant = entries.filter(e => !e.startsWith(".git") && e !== ".karajan" && e !== ".gitignore");
    isNewProject = relevant.length === 0;
  } catch { /* ignore */ }

  // Stack hints from planner + architect text. Now multi-ecosystem
  // (was 13/16 JS keywords — Python/Go/Rust barely existed). Combined
  // with `detectProjectStack(projectDir)` below to override the text
  // heuristic with the actual filesystem reality when available.
  const stackHints = [];
  const combined = `${stageResults.planner?.plan || ""} ${stageResults.architect?.architecture ? JSON.stringify(stageResults.architect.architecture) : ""} ${task}`.toLowerCase();
  const stackKeywords = [
    "express", "vite", "vitest", "jest", "next", "astro", "react", "vue", "svelte", "nestjs", "monorepo", "workspaces",
    "pytest", "flask", "fastapi", "django", "numpy", "pandas",
    "gin", "fiber", "go",
    "cargo", "rust",
    "spring",
  ];
  for (const kw of stackKeywords) {
    if (combined.includes(kw)) stackHints.push(kw);
  }

  // Filesystem trumps text. detectProjectStack inspects package.json /
  // pyproject.toml / go.mod / Cargo.toml, so a pure-python repo gets
  // `language: "python"` regardless of what the task text says.
  let detectedLanguage = null;
  try {
    const fsStack = await detectProjectStack(projectDir);
    if (fsStack?.language) detectedLanguage = fsStack.language;
  } catch { /* best-effort */ }

  const batch = generateHuBatch({
    originalTask: task,
    subtasks,
    stackHints,
    isNewProject,
    language: detectedLanguage,
    researcherContext: stageResults.researcher?.summary || null,
    architectContext: stageResults.architect?.architecture ? JSON.stringify(stageResults.architect.architecture) : null
  });

  // Persist batch to HU store so hu-sub-pipeline can update story status via saveHuBatch.
  // Use session.id as batchSessionId.
  const batchSessionId = `auto-${session.id}`;
  try {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const { getKarajanHome } = await import("#utils/paths.js");
    const huDir = path.join(getKarajanHome(), "hu-stories", batchSessionId);
    await fs.mkdir(huDir, { recursive: true });
    const persistBatch = {
      session_id: batchSessionId,
      project_id: batchSessionId,
      project_name: batch.projectName,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      stories: batch.stories
    };
    await fs.writeFile(path.join(huDir, "batch.json"), JSON.stringify(persistBatch, null, 2));
  } catch (err) {
    logger.warn(`Auto-HU: failed to persist batch (${err.message}) — sub-pipeline will use in-memory fallback`);
  }

  // Wrap in format compatible with needsSubPipeline + runHuSubPipeline
  stageResults.huReviewer = {
    ok: true,
    stories: batch.stories,
    total: batch.total,
    certified: batch.certified,
    batchSessionId,
    auto_generated: true,
    source: batch.source
  };

  logger.info(`Auto-HU: generated ${batch.total} stories (${batch.source.triage_subtasks} subtasks${isNewProject ? ", new project" : ""}${stackHints.length ? `, stack: ${stackHints.join(",")}` : ""})`);
  emitProgress(emitter, makeEvent("hu:auto-generated", { ...eventBase, stage: "hu-auto-gen" }, {
    message: `Auto-generated ${batch.total} HU(s) from triage decomposition`,
    detail: { total: batch.total, subtasks: batch.source.triage_subtasks, isNewProject, stackHints, projectName: batch.projectName }
  }));

  // Auto-start the board so the user can see the generated HUs.
  // Always fires when auto-HU runs, independent of hu_board.auto_start flag.
  // Never during vitest — would race the PID file and leave a detached
  // node process around after the suite (TSK-0273).
  if (process.env.VITEST || process.env.NODE_ENV === "test") return;
  try {
    const { startBoard, renderBoardBanner } = await import("../../../commands/board.js");
    const desiredPort = session.config_snapshot?.hu_board?.port ?? 4000;
    const boardResult = await startBoard(desiredPort);
    const url = boardResult.url;
    const status = boardResult.alreadyRunning ? "already running" : "started";
    const projectName = batch.projectName || "Auto-generated HUs";
    console.log(renderBoardBanner({ url, status, projectName }));
    logger.info(`HU Board ${status} at ${url} (project: ${projectName})`);
  } catch (err) {
    logger.warn(`HU Board auto-start failed (non-blocking): ${err.message}`);
  }
}
