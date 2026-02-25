import { createHash } from "node:crypto";

const DEFAULT_THRESHOLD = 2;

function normalizeIssueKey(value) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function buildIssueSignature(issues, keySelector) {
  const counts = new Map();
  for (const issue of issues || []) {
    const key = normalizeIssueKey(keySelector(issue));
    if (!key) continue;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  if (counts.size === 0) return "";
  return Array.from(counts.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, count]) => `${key}:${count}`)
    .join("|");
}

function hashSignature(signature) {
  if (!signature) return "";
  return createHash("sha256").update(signature).digest("hex");
}

function updateRepeatState(state, signatureHash) {
  if (!signatureHash) {
    return { lastHash: null, repeatCount: 0 };
  }
  const nextCount = signatureHash === state.lastHash ? state.repeatCount + 1 : 1;
  return { lastHash: signatureHash, repeatCount: nextCount };
}

function parseThreshold(value) {
  const parsed = Number(value);
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  return DEFAULT_THRESHOLD;
}

export class RepeatDetector {
  constructor({ threshold = DEFAULT_THRESHOLD } = {}) {
    this.threshold = parseThreshold(threshold);
    this.sonar = { lastHash: null, repeatCount: 0 };
    this.reviewer = { lastHash: null, repeatCount: 0 };
  }

  addIteration(sonarIssues, reviewerIssues) {
    const sonarSignature = buildIssueSignature(
      sonarIssues || [],
      (issue) => issue?.rule || issue?.message
    );
    const reviewerSignature = buildIssueSignature(
      reviewerIssues || [],
      (issue) => issue?.description || issue?.content || issue?.id
    );

    this.sonar = updateRepeatState(this.sonar, hashSignature(sonarSignature));
    this.reviewer = updateRepeatState(this.reviewer, hashSignature(reviewerSignature));
  }

  isStalled() {
    if (this.sonar.repeatCount >= this.threshold) {
      return { stalled: true, reason: "sonar_repeat" };
    }
    if (this.reviewer.repeatCount >= this.threshold) {
      return { stalled: true, reason: "reviewer_repeat" };
    }
    return { stalled: false, reason: "" };
  }

  getRepeatCounts() {
    return { sonar: this.sonar.repeatCount, reviewer: this.reviewer.repeatCount };
  }
}
