/**
 * kj sync — drift detection between code and the Canvas / plan
 * (issue #540, MVP).
 *
 * Scope of THIS module: pure data transformation. Given a plan
 * (with Operations and their file_hints) plus a list of currently
 * tracked source files (mtime + path), classify each file:
 *
 *   - covered      — file IS referenced by some Operation's file_hint
 *                    AND was modified since the plan was created.
 *                    (Expected drift; plan still authoritative.)
 *   - untracked    — file exists, modified, but no Operation references
 *                    it. The user added it manually after the run; the
 *                    Canvas needs a new Operation to reflect it.
 *   - missing      — Operation references a file that no longer exists
 *                    on disk. Either the file was deleted or the plan
 *                    is wrong about its location.
 *   - clean        — file is referenced by an Operation AND has not
 *                    been modified since the plan. No action needed.
 *
 * The classifier is pure: caller does the I/O (walking the tree,
 * stating files, parsing plan JSON). Easy to unit-test.
 */

/**
 * @param {object} plan — plan JSON with `operations` (or `hus`) carrying
 *                        optional `file_hint` strings, and `createdAt` ISO
 * @param {Array<{path: string, mtime: Date}>} files — files in the project
 * @returns {{ covered: object[], untracked: object[], missing: object[], clean: object[] }}
 */
export function classifyDrift(plan, files) {
  const planMtime = new Date(plan?.createdAt || plan?.updatedAt || 0);

  // Collect every file_hint declared by any operation/HU. Both keys
  // are accepted for back-compat with v2 plans (HUs) and Canvas
  // (Operations).
  const ops = Array.isArray(plan?.operations) ? plan.operations
    : Array.isArray(plan?.hus) ? plan.hus
    : [];
  const hinted = new Map(); // file → operation index
  ops.forEach((op, idx) => {
    const hint = op.file_hint || op.fileHint;
    if (typeof hint === "string" && hint.length > 0) {
      hinted.set(hint, idx);
    }
  });

  const out = { covered: [], untracked: [], missing: [], clean: [] };
  const seenInFs = new Set();

  for (const f of files) {
    if (!f?.path) continue;
    seenInFs.add(f.path);
    const opIdx = hinted.get(f.path);
    const modified = f.mtime instanceof Date && f.mtime > planMtime;

    if (opIdx === undefined) {
      // Not referenced by any operation. Two sub-cases:
      //  - modified: real drift, propose new operation.
      //  - not modified: probably a pre-existing file from before the
      //    plan; ignore (no action).
      if (modified) {
        out.untracked.push({ path: f.path, mtime: f.mtime, suggestion: "new operation" });
      }
      continue;
    }
    if (modified) {
      out.covered.push({ path: f.path, mtime: f.mtime, operationIndex: opIdx });
    } else {
      out.clean.push({ path: f.path, operationIndex: opIdx });
    }
  }

  // Missing: operation says a file should exist, but we never saw it.
  for (const [hint, opIdx] of hinted.entries()) {
    if (!seenInFs.has(hint)) {
      out.missing.push({ path: hint, operationIndex: opIdx, suggestion: "remove operation OR fix the file_hint" });
    }
  }

  return out;
}

/**
 * Render a drift report as plain-text for the terminal.
 */
export function formatDriftReport(report, plan) {
  const lines = [`Drift report — plan ${plan?.planId || "(unknown)"}`, ""];
  if (report.untracked.length === 0 && report.missing.length === 0 && report.covered.length === 0) {
    lines.push("  No drift detected.");
    return lines.join("\n");
  }
  if (report.covered.length > 0) {
    lines.push(`Covered (${report.covered.length}) — modified, an Operation references it; consider extending its Approach:`);
    for (const c of report.covered) lines.push(`  ~ ${c.path}  [op #${c.operationIndex + 1}]`);
    lines.push("");
  }
  if (report.untracked.length > 0) {
    lines.push(`Untracked (${report.untracked.length}) — modified, NO Operation references it; propose new Operation:`);
    for (const u of report.untracked) lines.push(`  + ${u.path}`);
    lines.push("");
  }
  if (report.missing.length > 0) {
    lines.push(`Missing (${report.missing.length}) — Operation file_hint points at a file that doesn't exist:`);
    for (const m of report.missing) lines.push(`  ! ${m.path}  [op #${m.operationIndex + 1}] — ${m.suggestion}`);
    lines.push("");
  }
  if (report.clean.length > 0) {
    lines.push(`Clean (${report.clean.length}) — covered, unchanged.`);
  }
  lines.push("", "Run with --json for machine-readable output. Future: --apply to propose Canvas patches (issue #540 follow-ups).");
  return lines.join("\n");
}
