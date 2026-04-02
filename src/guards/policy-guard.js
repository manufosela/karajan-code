/**
 * Policy guard for kj_resume answers.
 *
 * Detects host-AI attempts to bypass pipeline policies (skip TDD, ignore
 * reviewer, disable security, etc.) and rejects them with context-aware
 * suggestions for valid alternatives.
 */

const BYPASS_PATTERNS = [
  { regex: /\b(?:skip|omit|drop)\s+(?:the\s+)?(?:tests?|tdd|testing)\b/i, policy: "tdd" },
  { regex: /\bdisable\s+(?:the\s+)?(?:tests?|tdd|testing)\b/i, policy: "tdd" },
  { regex: /\b(?:don'?t|do\s+not|no\s+need\s+(?:for|to))\s+(?:run\s+)?tests?\b/i, policy: "tdd" },
  { regex: /\bcontinue\s+without\s+test/i, policy: "tdd" },
  { regex: /\bswitch\s+(?:to\s+)?(?:standard\s+)?methodology/i, policy: "tdd" },
  { regex: /\bswitch\s+methodology/i, policy: "tdd" },
  { regex: /\b(?:skip|ignore|bypass|disable)\s+(?:the\s+)?(?:review(?:er)?|code\s+review)\b/i, policy: "reviewer" },
  { regex: /\b(?:approve|pass)\s+without\s+review/i, policy: "reviewer" },
  { regex: /\bmark\s+as\s+approved\b/i, policy: "reviewer" },
  { regex: /\bjust\s+ship\s+it/i, policy: "reviewer" },
  { regex: /\bignore\s+(?:the\s+)?(?:review(?:er)?\s+)?feedback\b/i, policy: "reviewer" },
  { regex: /\b(?:skip|ignore|bypass|disable)\s+(?:the\s+)?(?:sonar|sonarqube|quality\s+gate)/i, policy: "sonar" },
  { regex: /\bignore\s+sonar\s+issues?\b/i, policy: "sonar" },
  { regex: /\b(?:skip|ignore|bypass|disable)\s+(?:the\s+)?security(?:\s+checks?)?\b/i, policy: "security" },
];

const SUGGESTIONS_BY_POLICY = {
  tdd: [
    "Provide specific guidance for the coder on how to fix the failing tests",
    "Describe the expected behavior so the coder can write correct tests",
    "Suggest a different approach to implement the feature that is easier to test",
  ],
  reviewer: [
    "Provide technical guidance to address the reviewer's feedback",
    "Explain why the current approach is correct if you disagree with the review",
    "Suggest alternative implementations that satisfy the reviewer's concerns",
  ],
  sonar: [
    "Provide guidance on how to resolve the SonarQube issues",
    "Explain the code changes needed to satisfy quality gate requirements",
  ],
  security: [
    "Provide guidance on how to fix the security issues found",
    "Explain the secure alternative for the flagged pattern",
  ],
};

const CONTEXT_SUGGESTIONS = {
  reviewer_fail_fast: [
    "Provide specific technical guidance for the coder to address the reviewer's feedback",
    "Suggest a different approach that resolves the reviewer's concerns",
  ],
  max_iterations: [
    "Provide focused guidance to help the coder converge on a solution",
    "Narrow the scope: specify exactly which file/function to change and how",
    "Continue with additional iterations by choosing option 1 or 2",
  ],
  standby_exhausted: [
    "Wait and retry — the provider may be temporarily overloaded",
    "Continue to resume from where the pipeline left off",
  ],
};

/**
 * Validate a resume answer against pipeline policies.
 *
 * @param {string|null} answer - The resume answer from the host
 * @param {string} [pauseContext] - The context of the pause (e.g. "reviewer_fail_fast")
 * @returns {{ valid: boolean, reason?: string, suggestions?: string[] }}
 */
export function validatePolicyCompliance(answer, pauseContext) {
  if (answer == null || answer === "") return { valid: true };
  if (typeof answer !== "string") return { valid: true };

  const text = answer.trim();
  for (const { regex, policy } of BYPASS_PATTERNS) {
    if (regex.test(text)) {
      const suggestions = [
        ...(CONTEXT_SUGGESTIONS[pauseContext] || []),
        ...(SUGGESTIONS_BY_POLICY[policy] || []),
      ];
      return {
        valid: false,
        reason: `Pipeline policy "${policy}" cannot be bypassed. Provide technical guidance instead.`,
        suggestions: [...new Set(suggestions)],
      };
    }
  }

  return { valid: true };
}
