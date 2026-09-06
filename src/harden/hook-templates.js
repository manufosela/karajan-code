/**
 * Hook bodies + profile→hooks mapping for `kj harden` (KJC-TSK-0555, 0562).
 *
 * A body is the MANAGED portion only; harden-engine adds the shebang and the
 * kj:managed markers around it. Pure POSIX sh — the universal checks (commit
 * format, AI-attribution) need no toolchain, and lint/format/test lines call
 * the project's NATIVE commands (from `cmds`), only when present. No npm/Node
 * is imposed on non-JS repos. See docs/specs/quality-harness.md §5.
 */

import { homedir } from "node:os";

const CONVENTIONAL_TYPES = "feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert";
const AI_ATTRIBUTION = "co-authored-by:.*(claude|gpt|copilot|gemini)|(generated|written) (by|with) .*(claude|gpt|copilot)";

export const SHEBANG = "#!/usr/bin/env sh";

/** Hooks enabled per profile. */
export const PROFILE_HOOKS = {
  minimal: ["commit-msg"],
  standard: ["pre-commit", "prepare-commit-msg", "commit-msg", "pre-push", "post-merge"],
  strict: ["pre-commit", "prepare-commit-msg", "commit-msg", "pre-push", "post-merge"],
};

/** Build the managed body for a single hook. */
// KJC-TSK-0645: `core.hooksPath .karajan/hooks` eclipses the user's global
// hooks dir, silently disabling personal guards. When a previous global dir
// is known, every generated hook ends by chaining its namesake there —
// guarded, so machines without it are unaffected.
function chainToGlobal(hook, globalHooksDir) {
  if (!globalHooksDir) return [];
  // KJC-BUG-0161 (ADR 0009): a committed hook must not bake a machine's
  // absolute home path — resolve through $HOME at runtime so the same
  // generated content is valid on every machine and its provenance stays
  // verifiable (and no local filesystem layout leaks into a public repo).
  const home = homedir();
  const dir = globalHooksDir === home || globalHooksDir.startsWith(`${home}/`)
    ? `$HOME${globalHooksDir.slice(home.length)}`
    : globalHooksDir;
  return [
    "# Chain the machine's previous global hook (kj harden keeps it active).",
    `if [ -x "${dir}/${hook}" ]; then`,
    `  "${dir}/${hook}" "$@"; rc=$?`,
    '  [ "$rc" -eq 0 ] || exit "$rc"',
    "fi",
  ];
}

// KJC-TSK-0648: branch-first, enforced. The first external session of the
// v4 environment committed on local main following literal instructions —
// the playbook now orders "branch first" and this guard backs it up.
function baseBranchGuard(baseBranch) {
  if (!baseBranch) return [];
  return [
    "# Branch-first guard — the base branch only moves via PR.",
    'if [ "$KJ_ALLOW_BASE_COMMIT" != "1" ]; then',
    '  current_branch=$(git symbolic-ref --short HEAD 2>/dev/null || echo "")',
    `  if [ "$current_branch" = "${baseBranch}" ]; then`,
    `    echo 'kj harden: direct commits on ${baseBranch} are not allowed — create a branch and open a PR (KJ_ALLOW_BASE_COMMIT=1 to override)'; exit 1`,
    "  fi",
    "fi",
  ];
}

// IDN-C (KJC-TSK-0764, ADR 0005): identity lock at tier B — the declared clone
// identity (.karajan/identity.local.yml) governs authorship on commit and the
// gh session on push, on ANY host. Undeclared = advisory only (old clones keep
// working); the fail-closed default is the Sentinel's (IDN-B).
function identityGuard(hook) {
  const head = [
    "# Identity lock (IDN-C, ADR 0005) — this clone's declared identity governs.",
    'if [ "$KJ_ALLOW_IDENTITY" != "1" ] && [ -f .karajan/identity.local.yml ]; then',
  ];
  const tail = [
    "elif [ ! -f .karajan/identity.local.yml ]; then",
    "  echo 'kj harden: no identity declared for this clone — run kj identity set (advisory)'",
    "fi",
  ];
  if (hook === "pre-commit") {
    return [
      ...head,
      "  kj_declared_email=$(sed -n 's/^git_email:[[:space:]]*//p' .karajan/identity.local.yml | head -n1)",
      "  kj_author=$(git var GIT_AUTHOR_IDENT | sed 's/.*<\\(.*\\)>.*/\\1/')",
      "  kj_committer=$(git var GIT_COMMITTER_IDENT | sed 's/.*<\\(.*\\)>.*/\\1/')",
      '  if [ -n "$kj_declared_email" ] && { [ "$kj_author" != "$kj_declared_email" ] || [ "$kj_committer" != "$kj_declared_email" ]; }; then',
      '    echo "kj harden: identity lock — committing as $kj_author / $kj_committer but this clone is declared as $kj_declared_email (kj identity show; KJ_ALLOW_IDENTITY=1 to override)"; exit 1',
      "  fi",
      ...tail,
    ];
  }
  return [
    ...head,
    "  kj_declared_gh=$(sed -n 's/^gh_user:[[:space:]]*//p' .karajan/identity.local.yml | head -n1)",
    '  kj_hosts="${GH_CONFIG_DIR:-${XDG_CONFIG_HOME:-$HOME/.config}/gh}/hosts.yml"',
    "  kj_active_gh=$(awk '/^github.com:/{f=1;next} f&&/^[^[:space:]]/{f=0} f&&/^[[:space:]]*user:/{sub(/^[[:space:]]*user:[[:space:]]*/,\"\");print;exit}' \"$kj_hosts\" 2>/dev/null)",
    '  if [ -n "$kj_declared_gh" ] && [ "$kj_active_gh" != "$kj_declared_gh" ]; then',
    '    echo "kj harden: identity lock — gh session is ${kj_active_gh:-none} but this clone is declared as $kj_declared_gh — run: gh auth switch --user $kj_declared_gh (KJ_ALLOW_IDENTITY=1 to override)"; exit 1',
    "  fi",
    ...tail,
  ];
}

export function hookBody(hook, cmds = {}, { globalHooksDir = null, baseBranch = null } = {}) {
  const chain = chainToGlobal(hook, globalHooksDir);
  switch (hook) {
    case "pre-commit": {
      const lines = [...baseBranchGuard(baseBranch), ...identityGuard("pre-commit"), "# Lint + format the working tree with the project's native tools."];
      if (cmds.lint) lines.push(`${cmds.lint} || { echo 'kj harden: lint failed'; exit 1; }`);
      if (cmds.format) lines.push(`${cmds.format} || { echo 'kj harden: format check failed'; exit 1; }`);
      if (!cmds.lint && !cmds.format) lines.push("# (no lint/format command detected for this stack)");
      lines.push(
        "# v4 review gate (ENV-C1, opt-in via `kj review --install-gate`):",
        "# a staged diff only enters with a recorded cross-AI approved verdict.",
        "if [ -f .karajan/review-gate ]; then",
        "  if ! command -v kj >/dev/null 2>&1; then",
        "    echo 'kj: review gate is enabled but kj is not installed — see karajancode.com/docs/getting-started/installation'; exit 1",
        "  fi",
        "  kj review --check || { echo 'kj: no approved cross-AI verdict for the staged diff — run `kj review --staged`'; exit 1; }",
        "fi"
      );
      return [...lines, ...chain].join("\n");
    }
    case "commit-msg":
      // Pure POSIX — Conventional Commits header, length cap, AI-attribution.
      return [
        'msg_file="$1"',
        'header=$(head -n1 "$msg_file")',
        `if ! printf '%s' "$header" | grep -qE '^(${CONVENTIONAL_TYPES})(\\([a-z0-9._-]+\\))?!?: .+'; then`,
        "  echo 'kj harden: commit header must follow Conventional Commits (type: subject)'; exit 1",
        "fi",
        'if [ "${#header}" -gt 100 ]; then echo \'kj harden: commit header exceeds 100 chars\'; exit 1; fi',
        `if grep -qiE '${AI_ATTRIBUTION}' "$msg_file"; then`,
        "  echo 'kj harden: AI attribution is not allowed in commit messages'; exit 1",
        "fi",
        ...chain,
      ].join("\n");
    case "pre-push": {
      const lines = [
        "# Identity guard — never push without a configured git identity.",
        'if [ -z "$(git config user.email)" ] || [ -z "$(git config user.name)" ]; then',
        "  echo 'kj harden: git user.name/user.email not set — refusing to push'; exit 1",
        "fi",
        'echo "kj harden: pushing as $(git config user.name) <$(git config user.email)>"',
        ...identityGuard("pre-push"),
        "# Run the test suite before pushing.",
      ];
      if (cmds.test) lines.push(`${cmds.test} || { echo 'kj harden: tests failed'; exit 1; }`);
      else lines.push("# (no test command detected for this stack)");
      return [...lines, ...chain].join("\n");
    }
    case "prepare-commit-msg":
      // KJC-TSK-0692 (MG-F): the branch already carries the card ref
      // (validated by the card-first gate) — the subject inherits it
      // automatically. A convention that enforces itself needs no adoption.
      return [
        'msg_file="$1"',
        'branch=$(git symbolic-ref --short HEAD 2>/dev/null || echo "")',
        "# POSIX-safe extraction (no grep -o): the ref is the leading",
        "# card-shaped token of the branch's last segment (feat/REF-desc).",
        "seg=$(printf '%s' \"$branch\" | tr '[:upper:]' '[:lower:]'); seg=\"${seg##*/}\"",
        String.raw`ref=$(printf '%s' "$seg" | sed -nE 's/^([a-z][a-z0-9]{1,9}(-[a-z][a-z0-9]{1,9})*-[0-9]{1,6})(-.*)?$/\1/p')`,
        'header=$(head -n1 "$msg_file")',
        'if [ -n "$ref" ] && [ -n "$header" ]; then',
        '  case "$header" in',
        "    Merge*|fixup!*|squash!*) ;;",
        "    *)",
        "      # Boundary match — a header mentioning KJW-TSK-00011 must not",
        "      # suppress the KJW-TSK-0001 stamp. $ref is [a-z0-9-] only by",
        "      # construction (sed extraction above), safe inside the ERE.",
        '      if ! printf \'%s\' "$header" | grep -qiE "(^|[^a-zA-Z0-9-])$ref([^a-zA-Z0-9-]|$)"; then',
        "        stamp=$(printf '%s' \"$ref\" | tr '[:lower:]' '[:upper:]')",
        '        new_header="$header ($stamp)"',
        '        if [ "${#new_header}" -le 100 ]; then',
        String.raw`          { printf '%s\n' "$new_header"; tail -n +2 "$msg_file"; } > "$msg_file.kjtmp" && mv "$msg_file.kjtmp" "$msg_file"`,
        "        fi",
        "      fi",
        "      ;;",
        "  esac",
        "fi",
        ...chain,
      ].join("\n");
    case "post-merge":
      return [
        "# Refresh the local RAG index so retrieval never serves stale code.",
        "if command -v kj >/dev/null 2>&1; then",
        "  kj rag index --since auto >/dev/null 2>&1 || true",
        "fi",
        ...chain,
      ].join("\n");
    default:
      throw new Error(`Unknown hook: ${hook}`);
  }
}
