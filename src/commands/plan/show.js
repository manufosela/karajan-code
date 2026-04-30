import { formatHuTable } from "./_shared.js";

/**
 * kj plan show <planId>
 */
export async function planShowCommand({ config, planId }) {
  const { loadPlan } = await import("../../plan/plan-store.js");
  const projectDir = config.projectDir || process.cwd();
  const plan = await loadPlan(projectDir, planId);

  if (!plan) {
    console.error(`Plan not found: ${planId}`);
    process.exitCode = 1;
    return;
  }

  console.log(`Plan: ${plan.planId}`);
  console.log(`Task: ${plan.task}`);
  console.log(`Name: ${plan.name || "—"}`);
  console.log(`Status: ${plan.status}`);
  console.log(`Version: ${plan.version}`);
  console.log(`Created: ${plan.createdAt}`);

  if (plan.approach) {
    console.log(`\n## Approach\n${plan.approach}`);
  }

  if (plan.hus?.length > 0) {
    console.log(`\n## HUs (${plan.hus.length})`);
    console.log(formatHuTable(plan.hus));
  } else {
    console.log("\nNo HUs defined. Add with: kj plan add-hu " + planId);
  }

  // Reviewer findings (PR D). When the planner ran with the plan
  // reviewer pass enabled, plan.review carries advisory findings —
  // missing HUs, missing deps, scope overlaps, parallelisable
  // groups, order issues. Each section only renders when non-empty
  // so a clean plan stays clean on screen.
  if (plan.review) {
    const r = plan.review;
    const sections = [];
    if (r.missing_hus?.length) {
      sections.push(`### Missing HUs (${r.missing_hus.length})`);
      for (const m of r.missing_hus) {
        sections.push(`- §${m.spec_section}: ${m.rationale}`);
      }
    }
    if (r.missing_dependencies?.length) {
      sections.push(`\n### Missing dependencies (${r.missing_dependencies.length})`);
      for (const d of r.missing_dependencies) {
        sections.push(`- ${d.from} should depend on ${d.on} — ${d.rationale}`);
      }
    }
    if (r.scope_overlaps?.length) {
      sections.push(`\n### Scope overlaps (${r.scope_overlaps.length})`);
      for (const o of r.scope_overlaps) {
        sections.push(`- ${o.between.join(" ↔ ")}: ${o.rationale}`);
      }
    }
    if (r.parallelisable_groups?.length) {
      sections.push(`\n### Parallelisable groups (${r.parallelisable_groups.length})`);
      for (const g of r.parallelisable_groups) {
        sections.push(`- ${g.hus.join(" + ")}${g.rationale ? ` — ${g.rationale}` : ""}`);
      }
    }
    if (r.order_issues?.length) {
      sections.push(`\n### Order issues (${r.order_issues.length})`);
      for (const o of r.order_issues) {
        sections.push(`- ${o.hus.join(", ")} (${o.issue}): ${o.rationale}`);
      }
    }
    if (sections.length > 0) {
      console.log("\n## Reviewer findings");
      if (r.summary) console.log(`_${r.summary}_\n`);
      console.log(sections.join("\n"));
    } else if (r.summary) {
      console.log(`\n## Reviewer findings\n_${r.summary}_`);
    }
  }
}
