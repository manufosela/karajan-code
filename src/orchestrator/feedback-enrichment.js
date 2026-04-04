// Feedback enrichment: transform vague feedback into actionable instructions.
// Extracts file hints, line hints, and suggests fixes from feedback text.

/**
 * Extract file path hints from feedback description.
 * Matches patterns like: packages/server/auth.js, src/routes/*, auth/middleware.ts
 */
export function extractFileHints(description) {
  if (!description) return [];
  const hints = new Set();

  // Explicit paths with extensions (supports bare filenames too)
  const pathRe = /\b([\w./_-]+\.(?:js|ts|jsx|tsx|py|go|rs|java|rb|php|cs|swift|dart|html|css|vue|svelte|astro|json|yml|yaml|md|sql))\b/gi;
  const paths = description.match(pathRe) || [];
  for (const p of paths) hints.add(p);

  // Directory references
  const dirRe = /\b(packages\/[\w-]+|src\/[\w/-]+|tests?\/[\w/-]+|lib\/[\w/-]+)/gi;
  const dirs = description.match(dirRe) || [];
  for (const d of dirs) hints.add(d);

  return [...hints];
}

/**
 * Detect the category of feedback from description keywords.
 */
export function detectCategory(description) {
  const text = (description || "").toLowerCase();
  if (/\b(injection|xss|csrf|httponly|sql\s*injection|exposed\s*secret|auth(?:entication)?\s*bypass|authoriza(?:tion)?\s*bypass|cryptograph|token\s*expos)/i.test(text)) return "security";
  if (/\btest|coverage|assert|spec|mock\b/.test(text)) return "tests";
  if (/\bperf(ormance)?|slow|optimize|bottleneck|latency\b/.test(text)) return "performance";
  if (/\b(style|format(?:ting)?|naming|rename|indent|whitespace|comment|jsdoc|cosmetic)\b/.test(text)) return "style";
  if (/\b(bug|incorrect|wrong|fails?|error|crash|broken)\b/.test(text)) return "correctness";
  return "other";
}

/**
 * Detect severity from description keywords and existing severity field.
 */
export function detectSeverity(description, existingSeverity) {
  if (existingSeverity) return existingSeverity;
  const text = (description || "").toLowerCase();
  if (/\bcritical|blocker|severe|production\s*risk\b/.test(text)) return "critical";
  if (/\b(high|security|vulnerab|breaking|regression|injection|xss|csrf)\b/.test(text)) return "high";
  if (/\blow|minor|cosmetic|nitpick\b/.test(text)) return "low";
  return "medium";
}

/**
 * Generate actionable instructions from a feedback entry.
 * Adds concrete steps the coder can follow.
 */
export function generateActionPlan(entry) {
  const steps = [];
  const cat = entry.category || detectCategory(entry.description);

  // Always start with locating the problem
  if (entry.file) {
    steps.push(`Open ${entry.file}${entry.line ? ` at line ${entry.line}` : ""}`);
  } else {
    const hints = extractFileHints(entry.description);
    if (hints.length > 0) {
      steps.push(`Look in: ${hints.join(", ")}`);
    } else {
      steps.push("Identify the relevant file(s) using grep/search");
    }
  }

  // Category-specific actions
  if (cat === "security") {
    steps.push("Apply the security fix (validate input, escape output, use parameterized queries, etc.)");
  } else if (cat === "tests") {
    steps.push("Write the missing test cases covering the scenario described");
    steps.push("Run tests to verify they pass: npm test or equivalent");
  } else if (cat === "correctness") {
    steps.push("Fix the bug described");
    steps.push("Add a regression test");
  } else if (cat === "performance") {
    steps.push("Optimize the identified bottleneck");
    steps.push("Verify improvement with measurements");
  } else if (cat === "style") {
    steps.push("Apply the style fix (run linter if available)");
  }

  // Include suggested fix if provided
  if (entry.suggestedFix) {
    steps.push(`Suggested approach: ${entry.suggestedFix}`);
  }

  return steps;
}

/**
 * Enrich a single feedback entry with file hints, category, severity, and action plan.
 */
export function enrichEntry(entry) {
  const description = entry.description || "";
  // Re-detect category when missing or set to default "other"
  const category = (!entry.category || entry.category === "other")
    ? detectCategory(description)
    : entry.category;
  const severity = detectSeverity(description, entry.severity);
  const fileHints = entry.file ? [entry.file] : extractFileHints(description);

  return {
    ...entry,
    category,
    severity,
    fileHints,
    actionPlan: generateActionPlan({ ...entry, category })
  };
}

/**
 * Enrich all entries in a queue in-place.
 */
export function enrichQueue(queue) {
  queue.entries = queue.entries.map(enrichEntry);
  return queue;
}

/**
 * Format enriched entries as actionable coder prompt sections.
 */
export function formatEnrichedForCoder(enrichedEntries) {
  if (!enrichedEntries?.length) return "";

  const sections = [];
  enrichedEntries.forEach((e, i) => {
    const header = `### Issue ${i + 1}: [${e.severity}] ${e.category} — ${e.description}`;
    const location = e.fileHints?.length
      ? `**Location hints:** ${e.fileHints.join(", ")}`
      : "**Location:** search the project for relevant files";
    const plan = `**Action plan:**\n${e.actionPlan.map(s => `- ${s}`).join("\n")}`;
    sections.push([header, location, plan].join("\n"));
  });

  return sections.join("\n\n");
}
