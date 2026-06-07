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

function classifyGit(tokens) {
  const sub = tokens[1];
  const has = (...flags) => flags.some((f) => tokens.includes(f));
  if (sub === "reset" && has("--hard")) return { destructive: true, kind: "git-reset-hard", paths: [], reason: "git reset --hard drops working tree" };
  if (sub === "clean" && has("-f", "-fd", "-xdf")) return { destructive: true, kind: "git-clean", paths: [], reason: "git clean -f removes untracked files" };
  if (sub === "branch" && has("-D")) return { destructive: true, kind: "git-branch-D", paths: [], reason: "git branch -D drops unmerged branch" };
  if (sub === "push" && has("--force", "-f", "--force-with-lease")) return { destructive: true, kind: "git-push-force", paths: [], reason: "git push --force rewrites remote history" };
  if (sub === "checkout" && has("--", ".")) return { destructive: true, kind: "git-checkout-discard", paths: [], reason: "git checkout -- discards local edits" };
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
