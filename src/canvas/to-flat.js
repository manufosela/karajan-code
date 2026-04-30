/**
 * Canvas → flat task string adapter.
 *
 * Renders a validated Canvas object as a single markdown blob the
 * existing planner can consume verbatim. Preserves every section
 * with its original heading so downstream steps (planner prompt,
 * coder prompt, plan JSON `task` field) see the same shape.
 *
 * The point: Canvas users get planner-time validation (catching
 * broken acceptance tests before they're persisted) AND benefit from
 * every existing planner / coder pipeline without those pipelines
 * needing Canvas awareness. Norms + Safeguards explicitly bracketed
 * so prompts that scan for them can find them with a regex.
 */

/**
 * @param {object} canvas — output of validateCanvas (.canvas)
 * @returns {string} markdown task ready for the planner
 */
export function canvasToTask(canvas) {
  const lines = [`# ${canvas.title}`, ""];

  // Requirements
  lines.push("## Requirements", canvas.requirements.problem);
  if (canvas.requirements.done && canvas.requirements.done.length > 0) {
    lines.push("", "Definition of done:");
    for (const d of canvas.requirements.done) lines.push(`- ${d}`);
  }
  lines.push("");

  // Entities (optional)
  if (canvas.entities && canvas.entities.length > 0) {
    lines.push("## Entities");
    for (const e of canvas.entities) {
      const fields = e.fields && e.fields.length > 0 ? ` — fields: ${e.fields.join(", ")}` : "";
      lines.push(`- ${e.name}${fields}${e.notes ? `. ${e.notes}` : ""}`);
    }
    lines.push("");
  }

  // Approach
  lines.push("## Approach", canvas.approach, "");

  // Structure (optional content)
  lines.push("## Structure");
  if (canvas.structure?.touches?.length > 0) lines.push(`- touches: ${canvas.structure.touches.join(", ")}`);
  if (canvas.structure?.depends_on?.length > 0) lines.push(`- depends_on: ${canvas.structure.depends_on.join(", ")}`);
  if (canvas.structure?.contracts?.length > 0) lines.push(`- contracts: ${canvas.structure.contracts.join(", ")}`);
  lines.push("");

  // Operations — each becomes one HU. Acceptance tests inline so the
  // planner sees the contract from turn 1.
  lines.push("## Operations");
  canvas.operations.forEach((op, i) => {
    lines.push(`${i + 1}. ${op.title}`);
    if (op.file_hint) lines.push(`   file: ${op.file_hint}`);
    if (op.blocked_by && op.blocked_by.length > 0) lines.push(`   depends on: ${op.blocked_by.join(", ")}`);
    lines.push("   Acceptance:");
    for (const t of op.acceptance) {
      // Render shell as one-liner, gherkin as fenced block so newlines survive.
      if (t.type === "gherkin") {
        lines.push("   - gherkin:", "     ```gherkin", ...t.content.split("\n").map((l) => `     ${l}`), "     ```");
      } else {
        lines.push(`   - shell: \`${t.content}\``);
      }
    }
  });
  lines.push("");

  // Norms (optional) — bracketed so prompts can find them.
  if (canvas.norms && canvas.norms.length > 0) {
    lines.push("## Norms (per-task engineering standards — coder MUST follow)");
    for (const n of canvas.norms) lines.push(`- ${n}`);
    lines.push("");
  }

  // Safeguards (optional) — bracketed similarly.
  if (canvas.safeguards && canvas.safeguards.length > 0) {
    lines.push("## Safeguards (non-negotiable invariants — code MUST hold these)");
    for (const s of canvas.safeguards) lines.push(`- ${s}`);
    lines.push("");
  }

  return lines.join("\n");
}
