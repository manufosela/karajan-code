// HU-4036: each stack root's lint/format (pre-commit) and tests (pre-push), from its dir, only when the
// change touches its own paths (its dir minus nested roots; git matches them). A pinned step wins.
const quoted = (s) => s.replaceAll("'", String.raw`'\''`);
const sq = (s) => `'${quoted(s)}'`;

// HU-3521: the executable a generated step runs (`test -z "$(gofmt -l .)"` runs gofmt); null when it is not a plain name.
const toolOf = (cmd) => {
  const tool = cmd.replace(/^test -z "\$\(/, "").split(/\s+/)[0];
  return /^[\w./@-]+$/.test(tool) ? tool : null;
};

/** A lint/format step that says it was skipped, and why, when its tool is not on PATH: never a failure of every commit. */
export function toolStep(step, cmd, failure) {
  const run = `${cmd} || { echo 'kj harden: ${failure}'; exit 1; }`;
  const tool = toolOf(cmd);
  if (!tool) return [run];
  return [`if command -v ${tool} >/dev/null 2>&1; then`, `  ${run}`, "else", `  echo 'kj harden: ${step} skipped: ${tool} not found'`, "fi"];
}

/** The root's own pathspecs: its dir, minus every other root inside it. */
function ownPathspecs(root, roots) {
  const nested = roots.filter((r) => r.dir !== root.dir && (root.dir === "." || r.dir.startsWith(`${root.dir}/`)));
  return [`:(literal)${root.dir}`, ...nested.map((r) => `:(exclude,literal)${r.dir}`)].map(sq).join(" ");
}

function rootBlock(root, roots, guard, body) {
  return [`if ${guard} ${ownPathspecs(root, roots)}; then`, "  (", `    cd ${sq(root.dir)}`, ...body.map((l) => `    ${l}`), "  )", "fi"];
}

const noCommand = (root, what) => `# ${root.dir.replace(/[\r\n]/g, " ")} (${root.language}): no ${what} command for this stack root`;

/** pre-commit: each root's lint and format, when the staged files touch it. */
export function rootLintSteps(cmds) {
  const lines = ["# HU-4036: each stack root lints from its dir, only when the staged files touch it.", "kj_staged_touches() { if git diff --cached --quiet -- \"$@\"; then return 1; fi; }"];
  for (const root of cmds.roots) {
    const steps = [["lint", "lint failed"], ["format", "format check failed"]].filter(([s]) => !cmds[s] && root[s]);
    const body = steps.flatMap(([s, failure]) => toolStep(s, root[s], `${failure} in ${quoted(root.dir)}`));
    if (body.length) lines.push(...rootBlock(root, cmds.roots, "kj_staged_touches", body));
    else if (!cmds.lint || !cmds.format) lines.push(noCommand(root, "lint/format"));
  }
  return lines;
}

/** pre-push: each root's tests, when a commit the push brings touches it (no refs on stdin: assume it does). */
export function rootTestSteps(cmds) {
  const lines = [
    "# HU-4036: each stack root tests from its dir, only when a commit the push brings touches it.",
    'kj_remote="${1:-origin}"',
    "kj_push_touches() {",
    '  [ -n "$kj_push_refs" ] || return 0',
    "  kj_hit=$(printf '%s\\n' \"$kj_push_refs\" | while read -r kj_lref kj_lsha kj_rref kj_rsha; do",
    '    case "$kj_lsha" in *[!0]*) ;; *) continue ;; esac',
    '    case "$kj_rsha" in *[!0]*) kj_not="$kj_rsha" ;; *) kj_not="" ;; esac',
    '    git log -1 --format=%h "$kj_lsha" --not $kj_not --remotes="$kj_remote" -- "$@" 2>/dev/null || echo x',
    "  done)",
    '  [ -n "$kj_hit" ]',
    "}",
  ];
  for (const root of cmds.roots) {
    const run = `${root.test} || { echo 'kj harden: tests failed in ${quoted(root.dir)}'; exit 1; }`;
    lines.push(...(root.test ? rootBlock(root, cmds.roots, "kj_push_touches", [run]) : [noCommand(root, "test")]));
  }
  return lines;
}
