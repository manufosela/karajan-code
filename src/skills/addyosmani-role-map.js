/**
 * Role → addyosmani/agent-skills slug mapping (KJC-TSK-0327).
 *
 * The addyosmani catalog is process-oriented (not stack-oriented), so the
 * natural keying is by Karajan role: reviewer wants code-review workflows,
 * tester wants TDD, security wants hardening, etc.
 *
 * Task-text triggers complement the role map: e.g. a task that mentions
 * "performance" or "Core Web Vitals" pulls in performance-optimization,
 * regardless of which role is running.
 *
 * Every slug listed here MUST exist in the upstream repo at:
 *   https://github.com/addyosmani/agent-skills/tree/main/skills/<slug>
 * If upstream renames or removes a slug, loadSkillBySlug() degrades silently
 * (returns null) and the pipeline continues without blocking.
 */

/**
 * Role → array of upstream slugs.
 * Keep slugs lowercase-hyphenated, matching addyosmani's directory names.
 */
export const ROLE_TO_ADDYOSMANI_SLUGS = {
  // The coder role benefits from broad process context: how to iterate,
  // how to engineer context, and how to debug when things break.
  coder: [
    "incremental-implementation",
    "source-driven-development",
    "context-engineering",
    "debugging-and-error-recovery",
  ],

  // Reviewer wants the review + simplification workflows.
  reviewer: [
    "code-review-and-quality",
    "code-simplification",
  ],

  // Tester focuses on TDD and browser verification.
  tester: [
    "test-driven-development",
    "browser-testing-with-devtools",
  ],

  // Security role uses the dedicated hardening workflow.
  security: [
    "security-and-hardening",
  ],

  // Architect covers spec-driven, API design and planning skills.
  architect: [
    "spec-driven-development",
    "api-and-interface-design",
    "planning-and-task-breakdown",
  ],

  // Planner overlaps with architect but leans on task breakdown and spec.
  planner: [
    "planning-and-task-breakdown",
    "spec-driven-development",
  ],

  // Researcher / discover benefit from the idea-refine workflow.
  researcher: [
    "idea-refine",
  ],
  discover: [
    "idea-refine",
  ],

  // Impeccable (UI/UX audit) uses the frontend engineering workflow.
  impeccable: [
    "frontend-ui-engineering",
  ],

  // Refactorer uses simplification and debugging workflows.
  refactorer: [
    "code-simplification",
    "debugging-and-error-recovery",
  ],
};

/**
 * Task-text patterns → addyosmani slug. These are applied in addition to the
 * role map, so a reviewer task that mentions "performance" also pulls in the
 * performance-optimization skill.
 */
export const TASK_PATTERN_TO_SLUG = [
  { pattern: /\bperformance\b|\bcore\s+web\s+vitals\b|\blcp\b|\bcls\b|\binp\b/i, slug: "performance-optimization" },
  { pattern: /\bsecurity\b|\bhardening\b|\bauth(entication|orization)?\b|\bxss\b|\bcsrf\b|\binjection\b/i, slug: "security-and-hardening" },
  { pattern: /\btdd\b|\btest[- ]driven\b/i, slug: "test-driven-development" },
  { pattern: /\bfrontend\b|\bui\b|\bux\b|\bcss\b|\bresponsive\b/i, slug: "frontend-ui-engineering" },
  // Accessibility (a11y / WCAG / ARIA / screen reader / keyboard nav).
  // No dedicated addyosmani skill exists yet for a11y; until one ships,
  // route to frontend-ui-engineering — the closest authoritative source
  // for WCAG-aware UI work. When upstream ships an a11y skill, change
  // only the `slug` field here.
  { pattern: /\baccessibility\b|\ba11y\b|\bwcag\b|\baria\b|\bscreen[\s-]?reader\b|\bkeyboard[\s-]?nav(igation)?\b/i, slug: "frontend-ui-engineering" },
  { pattern: /\bapi\b|\bendpoint\b|\binterface\s+design\b|\bopenapi\b|\brest\b|\bgraphql\b/i, slug: "api-and-interface-design" },
  { pattern: /\bci\b|\bcd\b|\bci\/cd\b|\bpipeline\b|\bgithub\s+actions\b|\bworkflow\b/i, slug: "ci-cd-and-automation" },
  { pattern: /\bgit\b|\bcommit\b|\bbranch\b|\bmerge\b|\bversioning\b|\bsemver\b/i, slug: "git-workflow-and-versioning" },
  { pattern: /\bdebug\b|\berror\s+recovery\b|\bstack\s+trace\b/i, slug: "debugging-and-error-recovery" },
  { pattern: /\bdeprecat|\bmigrat/i, slug: "deprecation-and-migration" },
  { pattern: /\bdocs?\b|\badr\b|\breadme\b|\bdocumentation\b/i, slug: "documentation-and-adrs" },
  { pattern: /\brelease\b|\blaunch\b|\bship\b/i, slug: "shipping-and-launch" },
  { pattern: /\bspec\b|\bspecification\b|\bprd\b/i, slug: "spec-driven-development" },
  { pattern: /\bidea\b|\brefine\b|\bdiscover/i, slug: "idea-refine" },
  { pattern: /\bbrowser\s+test|\bdevtools\b|\bchrome\s+devtools\b/i, slug: "browser-testing-with-devtools" },
];

/**
 * Resolve the set of addyosmani slugs that apply to a given (role, task)
 * tuple. Returns a deduped array preserving role-first ordering (so role
 * skills appear before task-inferred ones in the prompt).
 *
 * @param {{role?: string|null, task?: string|null}} args
 * @returns {string[]}
 */
export function resolveAddyosmaniSlugs({ role = null, task = null } = {}) {
  const out = [];
  const seen = new Set();

  const push = (slug) => {
    if (!slug || seen.has(slug)) return;
    seen.add(slug);
    out.push(slug);
  };

  if (role && ROLE_TO_ADDYOSMANI_SLUGS[role]) {
    for (const slug of ROLE_TO_ADDYOSMANI_SLUGS[role]) push(slug);
  }

  if (task && typeof task === "string") {
    for (const { pattern, slug } of TASK_PATTERN_TO_SLUG) {
      if (pattern.test(task)) push(slug);
    }
  }

  return out;
}
