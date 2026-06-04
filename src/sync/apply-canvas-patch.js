/**
 * kj sync --apply — append a drift patch to the Canvas markdown.
 *
 * KJC-TSK-0348. Pure data + I/O: reads the Canvas at `canvasPath`, drops a
 * `.bak` snapshot alongside it, appends an HTML-comment block describing
 * untracked / missing / covered files, and atomically renames a `.tmp`
 * over the target. Comments are inert for the Canvas parser, so the
 * patched file stays structurally valid — the user converts the TODOs
 * into Operations by hand.
 */

import { promises as fs } from "node:fs";

function tempPath(target) {
  return `${target}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`;
}

export function renderDriftComment(report) {
  const lines = ["", `<!-- kj sync --apply (${new Date().toISOString()}) — review and convert into Operations as needed. -->`];
  let mutations = 0;
  if (report.untracked?.length) {
    lines.push("<!-- Untracked files (modified, no Operation references them — add one): -->");
    for (const u of report.untracked) { lines.push(`<!-- + ${u.path} -->`); mutations += 1; }
  }
  if (report.missing?.length) {
    lines.push("<!-- Missing files (Operation file_hint points at a file that does not exist): -->");
    for (const m of report.missing) { lines.push(`<!-- ! ${m.path}  [op #${(m.operationIndex ?? 0) + 1}] -->`); mutations += 1; }
  }
  if (report.covered?.length) {
    lines.push("<!-- Covered (referenced and modified — consider extending the Approach): -->");
    for (const c of report.covered) lines.push(`<!-- ~ ${c.path}  [op #${(c.operationIndex ?? 0) + 1}] -->`);
  }
  lines.push("<!-- /kj sync -->", "");
  return { block: lines.join("\n"), mutations };
}

export async function applyCanvasPatch({ canvasPath, report }) {
  if (!canvasPath || typeof canvasPath !== "string") throw new Error("applyCanvasPatch: canvasPath is required");
  if (!report || typeof report !== "object") throw new Error("applyCanvasPatch: report is required");
  const hasDrift = (report.untracked?.length || 0) + (report.missing?.length || 0) > 0;
  if (!hasDrift) return { patchedPath: canvasPath, backupPath: null, mutations: 0, skipped: true };

  let original;
  try { original = await fs.readFile(canvasPath, "utf-8"); }
  catch (err) { throw new Error(`applyCanvasPatch: cannot read canvas ${canvasPath}: ${err.message}`, { cause: err }); }

  const backupPath = `${canvasPath}.bak`;
  await fs.writeFile(backupPath, original, "utf-8");
  const { block, mutations } = renderDriftComment(report);
  const trimmed = original.endsWith("\n") ? original : `${original}\n`;
  const tmp = tempPath(canvasPath);
  await fs.writeFile(tmp, `${trimmed}${block}\n`, "utf-8");
  await fs.rename(tmp, canvasPath);
  return { patchedPath: canvasPath, backupPath, mutations };
}
