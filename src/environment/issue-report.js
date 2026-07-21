/**
 * Issue reporting core (AB-F, KJC-TSK-0655) — the self-healing loop: any
 * user's brain diagnoses a kj friction and reports it to the public repo,
 * so field feedback reaches the maintainer's board without a human relay.
 *
 * A public issue is a privacy boundary. sanitize() strips home paths,
 * usernames and emails; the composer only ever includes what the brain
 * explicitly passed (command, error, description) plus kj/node/platform
 * metadata — never project code.
 */

export const REPO = "manufosela/karajan-code";

export function sanitize(text) {
  return String(text || "")
    // any /home/<user>/ or /Users/<user>/ prefix collapses to ~/
    .replaceAll(/\/(?:home|Users)\/[^/\s]+/g, "~")
    // emails never belong in a public issue
    .replaceAll(/[\w.+-]+@[\w-]+\.[\w.]+/g, "[redacted-email]");
}

export function composeIssue({ title, description = "", command = "", error = "", env = {} }) {
  const body = [
    sanitize(description),
    command ? `\n**Command:** \`${sanitize(command)}\`` : "",
    error ? `\n**Error:**\n\`\`\`\n${sanitize(error)}\n\`\`\`` : "",
    "\n**Environment:**",
    `- kj ${env.kjVersion || "unknown"}`,
    `- node ${env.nodeVersion || "unknown"}`,
    `- ${env.platform || "unknown"}`,
    "\n---",
    "_Reported via `kj report-issue` (sanitized: no project code, paths or personal data)._",
  ].filter(Boolean).join("\n");
  return { title: sanitize(title), body };
}

const STOPWORDS = new Set(["the", "a", "an", "is", "are", "from", "with", "for", "and", "not", "kj", "karajan"]);

function meaningfulWords(title) {
  return title.toLowerCase().split(/[^a-z0-9-]+/)
    .filter((w) => w.length > 3 && !STOPWORDS.has(w));
}

/**
 * Look for open issues that share meaningful title words (≥2 overlaps, or
 * 1 when the title is short). Read-only public API — no auth needed. Any
 * failure degrades to [] : dedup must never block reporting.
 */
export async function findSimilarIssues(title, { fetchFn = globalThis.fetch } = {}) {
  try {
    const res = await fetchFn(`https://api.github.com/repos/${REPO}/issues?state=open&per_page=100`, {
      headers: { accept: "application/vnd.github+json" },
    });
    if (!res.ok) return [];
    const issues = await res.json();
    const words = meaningfulWords(title);
    const needed = Math.min(2, Math.max(1, words.length));
    return issues.filter((issue) => {
      const theirs = new Set(meaningfulWords(issue.title || ""));
      const overlap = words.filter((w) => theirs.has(w)).length;
      return overlap >= needed;
    }).map(({ number, title: t, html_url }) => ({ number, title: t, html_url }));
  } catch {
    return [];
  }
}

/** Prefilled new-issue URL — publishing stays a human click by default. */
export function newIssueUrl({ title, body }) {
  const params = new URLSearchParams({ title, body });
  return `https://github.com/${REPO}/issues/new?${params.toString().replaceAll("+", "%20")}`;
}
