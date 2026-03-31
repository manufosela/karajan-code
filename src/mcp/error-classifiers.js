/**
 * Error classification for MCP tool responses.
 * Extracted to its own module to avoid circular import TDZ issues
 * (server-handlers.js ↔ handlers/*.js circular chain).
 */

import { withDocLink } from "../utils/doc-links.js";

const ERROR_CLASSIFIERS = [
  {
    test: (lower) => lower.includes("without output") || lower.includes("silent for") || lower.includes("unresponsive") || lower.includes("exceeded max silence"),
    category: "agent_stall",
    suggestion: "Agent output stalled. Check live details with kj_status, then retry with a smaller prompt or increase session.max_agent_silence_minutes if needed."
  },
  {
    test: (lower) => lower.includes("sonar") && (lower.includes("connect") || lower.includes("econnrefused") || lower.includes("not available") || lower.includes("not running")),
    category: "sonar_unavailable",
    suggestion: withDocLink("SonarQube is not reachable. Try: kj_init to set up SonarQube, or run 'docker start sonarqube' if already installed. Use --no-sonar to skip SonarQube.", "sonar_docker")
  },
  {
    test: (lower) => lower.includes("401") || lower.includes("unauthorized") || lower.includes("invalid token"),
    category: "auth_error",
    suggestion: withDocLink("Authentication failed. Regenerate the SonarQube token and update it via kj_init or in ~/.karajan/kj.config.yml under sonarqube.token.", "sonar_token")
  },
  {
    test: (lower) => lower.includes("config") && (lower.includes("missing") || lower.includes("not found") || lower.includes("invalid")),
    category: "config_error",
    suggestion: withDocLink("Configuration issue detected. Run kj_doctor to diagnose, or kj_init to create a fresh config.", "config_missing")
  },
  {
    test: (lower) => lower.includes("missing provider") || lower.includes("not found") && (lower.includes("claude") || lower.includes("codex") || lower.includes("gemini") || lower.includes("aider")),
    category: "agent_missing",
    suggestion: withDocLink("Required agent CLI not found. Run kj_doctor to check which agents are installed and get installation instructions.", "agent_not_found")
  },
  {
    test: (lower) => lower.includes("timed out") || lower.includes("timeout"),
    category: "timeout",
    suggestion: "The agent did not complete in time. Try: (1) increase --max-iteration-minutes (default: 5), (2) split the task into smaller pieces, (3) use kj_code for single-agent tasks. If a SonarQube scan timed out, check Docker health."
  },
  {
    test: (lower) => lower.includes("you are on the base branch"),
    category: "branch_error",
    suggestion: withDocLink("Create a feature branch before running Karajan. Use 'git checkout -b feat/<task-description>' and then retry. Do NOT run kj_code directly on the base branch.", "branch_error")
  },
  {
    test: (lower) => lower.includes("not a git repository"),
    category: "git_error",
    suggestion: "Current directory is not a git repository. Navigate to your project root or initialize git with 'git init'."
  },
  {
    test: (lower) => lower.includes("bootstrap failed"),
    category: "bootstrap_error",
    suggestion: withDocLink("Environment prerequisites not met. Run kj_doctor for diagnostics, then fix the issues listed. Do NOT work around these — fix them properly.", "bootstrap_failed")
  }
];

export function classifyError(error) {
  const msg = error?.message || String(error);
  const lower = msg.toLowerCase();

  const match = ERROR_CLASSIFIERS.find(c => c.test(lower));
  if (match) {
    return { category: match.category, suggestion: match.suggestion };
  }
  return { category: "unknown", suggestion: null };
}
