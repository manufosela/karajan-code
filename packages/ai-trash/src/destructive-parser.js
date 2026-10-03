// Pure classifier for shell commands the PreToolUse hook receives.
// Recognises the destructive ops ai-trash will snapshot before they run.
// Conservative: anything unknown is left as safe, but every destructive
// shape returns kind+paths so the hook can snapshot before letting it run.

function tokenise(command) {
  if (Array.isArray(command)) return command.filter((t) => typeof t === "string");
  if (typeof command !== "string") return [];
  const out = [];
  let buf = "", quote = null;
  for (const ch of command) {
    if (quote) { if (ch === quote) quote = null; else buf += ch; continue; }
    if (ch === "'" || ch === '"') { quote = ch; continue; }
    if (ch === " " || ch === "\t" || ch === "\n") { if (buf) { out.push(buf); buf = ""; } continue; }
    buf += ch;
  }
  if (buf) out.push(buf);
  return out;
}

function rmFlags(tokens) {
  const flags = tokens.filter((t) => t.startsWith("-")).join("");
  return { recursive: flags.includes("r"), force: flags.includes("f") };
}

function classifyRm(tokens) {
  const positional = tokens.slice(1).filter((t) => !t.startsWith("-"));
  const { recursive, force } = rmFlags(tokens.slice(1));
  return { destructive: true, kind: "rm", recursive, force, paths: positional, reason: "rm removes files" };
}

function classifyMv(tokens) {
  const positional = tokens.slice(1).filter((t) => !t.startsWith("-"));
  if (positional.length < 2) return { destructive: false, kind: "mv-noop", paths: [], reason: "mv without source/target" };
  return { destructive: true, kind: "mv-overwrite", paths: positional.slice(-1), reason: "mv may overwrite destination" };
}

// KJC-BUG-0240 (#1886): checkout and restore drop uncommitted work file by file,
// and a bundle keeps commits only, so the named files are kept as files and a
// discard of the whole tree marks it (worktree) for the hook to keep every dirty file.
function classifyDiscard(tokens, sub) {
  const args = tokens.slice(2);
  const has = (...flags) => flags.some((f) => args.includes(f));
  const SAFE = { destructive: false, kind: "git-safe", paths: [] };
  if (sub === "restore" && has("--staged", "-S") && !has("--worktree", "-W")) return { ...SAFE, reason: "restore --staged only unstages" };
  // -B resets an existing branch: its commits need the bundle.
  if (sub === "checkout" && has("-B")) return { destructive: true, kind: "git-checkout-reset-branch", bundle: true, paths: [], reason: "git checkout -B resets an existing branch" };
  if (sub === "checkout" && has("-b", "--orphan")) return { ...SAFE, reason: "checkout -b creates a branch" };
  const dd = args.indexOf("--");
  const named = [];
  let sourceValue = false;
  args.forEach((a, i) => {
    if (sourceValue) sourceValue = false;
    else if (a === "-s" || a === "--source") sourceValue = true;
    else if ((dd >= 0 && i > dd) || !a.startsWith("-")) named.push(a);
  });
  if (!named.length && !has("-f", "--force")) return { ...SAFE, reason: `${sub} with nothing to discard` };
  const whole = has("-f", "--force") || named.includes(".") || named.includes(":/");
  return { destructive: true, kind: `git-${sub}-discard`, paths: named.filter((p) => p !== "." && p !== ":/"), ...(whole ? { worktree: "tracked" } : {}), reason: `git ${sub} discards local edits` };
}

function classifyGit(tokens) {
  const sub = tokens[1];
  const has = (...flags) => flags.some((f) => tokens.includes(f));
  if (sub === "reset" && has("--hard")) return { destructive: true, kind: "git-reset-hard", bundle: true, worktree: "tracked", paths: [], reason: "git reset --hard drops working tree" };
  if (sub === "clean" && tokens.some((t) => t === "--force" || /^-[a-zA-Z]*f/.test(t))) {
    // -x / -X also remove ignored files.
    const ignored = tokens.some((t) => /^-[a-zA-Z]*[xX]/.test(t));
    return { destructive: true, kind: "git-clean", bundle: true, worktree: ignored ? "untracked+ignored" : "untracked", paths: [], reason: "git clean -f removes untracked files" };
  }
  if (sub === "branch" && has("-D")) return { destructive: true, kind: "git-branch-D", bundle: true, paths: [], reason: "git branch -D drops unmerged branch" };
  if (sub === "push" && has("--force", "-f", "--force-with-lease")) return { destructive: true, kind: "git-push-force", bundle: true, paths: [], reason: "git push --force rewrites remote history" };
  if (sub === "checkout" || sub === "restore") return classifyDiscard(tokens, sub);
  if (sub === "switch" && has("-f", "--force", "--discard-changes")) return { destructive: true, kind: "git-switch-discard", worktree: "tracked", paths: [], reason: "git switch --discard-changes drops local edits" };
  return { destructive: false, kind: "git-safe", paths: [], reason: "git op without destructive flags" };
}

function classifyRedirect(tokens) {
  for (let i = 0; i < tokens.length; i += 1) {
    if ((tokens[i] === ">" || tokens[i] === ">|") && tokens[i + 1]) {
      return { destructive: true, kind: "redirect-clobber", paths: [tokens[i + 1]], reason: "> truncates the target file" };
    }
  }
  return null;
}

export function classifyCommand(command) {
  const tokens = tokenise(command);
  if (!tokens.length) return { destructive: false, kind: "empty", paths: [], reason: "no command" };
  const redirect = classifyRedirect(tokens);
  if (redirect) return redirect;
  const head = tokens[0];
  if (head === "rm") return classifyRm(tokens);
  if (head === "truncate") {
    const paths = tokens.slice(1).filter((t) => !t.startsWith("-") && !/^\d+$/.test(t));
    return { destructive: true, kind: "truncate", paths, reason: "truncate rewrites file size" };
  }
  if (head === "mv" || head === "cp") return classifyMv(tokens);
  if (head === "git") return classifyGit(tokens);
  return { destructive: false, kind: "safe", paths: [], reason: `head '${head}' not in destructive list` };
}

export { tokenise };
