// HU-4901 (KJC-BUG-0663): the names kj's own gates sign a rejection with in .karajan/reviews.
// A gate is no reviewer: reports count these apart from the panel.
export const GATE_REVIEWERS = Object.freeze(new Set([
  "card-first",
  "dep-cooldown",
  "diff-tests",
  "mutation",
  "policy",
  "pr-size",
  "privacy",
  "rag-first",
  "sonar",
  "steward",
  "tests-with-code",
]));
