// The Sentinel's shell reader (KJC-TSK-0915, ADR 0014). A real module with no
// dependencies: kj harden copies it byte for byte into .karajan/harness as
// sentinel-shell.mjs, so the hooks stay autonomous and this code is unit-tested.
// It reads command TEXT; whatever it cannot read with certainty, the guards that
// use it treat as unknowable and deny.

/**
 * Simple commands as word lists, quote-aware: an operator or blank inside
 * quotes belongs to the word ('user;work.txt' is one path).
 * @param {string} cmd
 * @returns {string[][]}
 */
export const shellSegments = (cmd) => {
  const segs = [[]];
  let word = null;
  let quote = null;
  let escaped = false;
  const end = () => {
    if (word !== null) segs.at(-1).push(word);
    word = null;
  };
  for (const ch of String(cmd)) {
    // A backslash keeps the next char literal (an escaped blank joins the word),
    // except inside single quotes.
    if (escaped) { word += ch; escaped = false; continue; }
    if (ch === "\\" && quote !== "'") { escaped = true; word ??= ""; continue; }
    if (quote) {
      if (ch === quote) quote = null;
      else word += ch;
      continue;
    }
    if (ch === "'" || ch === '"') { quote = ch; word ??= ""; continue; }
    // >| and >& are redirections, not a pipe or a fork.
    if ((ch === "|" || ch === "&") && word?.endsWith(">")) { word += ch; continue; }
    // x>file: end "x" and start the redirection word ">" (the target follows in it).
    if (ch === ">" && word !== null && !/^\d*>?$/.test(word)) { end(); word = ">"; continue; }
    // ( ) { } and backticks also cut: what runs inside $( ), a subshell or a group
    // is a command of its own. A backtick leaves "$" in the word it interrupts, as
    // $( does: that word is no longer readable.
    if (ch === "`") word = (word ?? "") + "$";
    if (";&|(){}\n`".includes(ch)) { end(); segs.push([]); continue; }
    if (ch.trim() === "") { end(); continue; }
    word = (word ?? "") + ch;
  }
  end();
  return segs.filter((s) => s.length);
};

const WRAPPERS = new Set(["command", "exec", "sudo", "doas", "nice", "nohup", "time", "env"]);

/**
 * Index of the command word. Skips NAME=value assignments AND wrappers (env,
 * sudo, command...) in any interleaving: env MODE=prod tee -> tee. After a
 * wrapper with options (sudo -u root, env -i FOO=1) the command is the first of
 * `heads`; none found means there is no command to read.
 * @param {string[]} words
 * @param {string[]} heads
 */
export const headIndex = (words, heads) => {
  let i = 0;
  while (i < words.length && (/^[A-Za-z_]\w*=/.test(words[i]) || WRAPPERS.has(words[i].split("/").at(-1)))) i++;
  if (!words[i]?.startsWith("-")) return i;
  const k = words.slice(i).findIndex((x) => heads.includes(x.split("/").at(-1)));
  return k < 0 ? words.length : i + k;
};

/**
 * KJC-BUG-0306: a simple command that runs `gh ... issue create`, read by words
 * (quotes, escapes and newlines as the shell reads them), not by words anywhere.
 * @param {string} cmd
 */
export const isGhIssueCreate = (cmd) => shellSegments(cmd).some((words) => {
  const i = headIndex(words, ["gh"]);
  if (words[i]?.split("/").at(-1) !== "gh") return false;
  // The subcommand words, with every flag skipped together with a value that may
  // follow it (--repo x, --hostname y): what is left is "issue", then "create".
  const subcommand = [];
  let afterFlag = false;
  for (const w of words.slice(i + 1)) {
    if (w.startsWith("-")) { afterFlag = !w.includes("="); continue; }
    if (afterFlag && !["issue", "create"].includes(w)) { afterFlag = false; continue; }
    afterFlag = false;
    subcommand.push(w);
    if (subcommand.length === 2) break;
  }
  return subcommand[0] === "issue" && subcommand[1] === "create";
});

// KJC-BUG-0204: the real command puts flags between the verb's words
// (npm --prefix x publish), so they are read in order, not adjacent.
// KJC-BUG-0373: only a release of the package; a deploy (database rules, a site)
// is not one, and gating it kept an open database open.
const PUBLISH_VERBS = [["npm", "publish"], ["gh", "release", "create"]];
// Known options that take a separate value: that value is not a subcommand word
// (npm --tag publish test does not publish). An unknown option is not skipped, so
// a real publish behind it is still read (a false positive costs less than a miss).
const VALUE_OPTIONS = {
  npm: ["--prefix", "--tag", "--registry", "--userconfig", "--workspace", "-w", "--otp", "--access", "--cache", "--loglevel", "-C"],
  gh: ["--repo", "-R", "--hostname"],
};

/**
 * KJC-BUG-0333 (#2093): a simple command whose head is npm or gh and whose own
 * words then say publish/release create. Words inside a quoted
 * argument of another command (a kj rag query text, a commit message) are one
 * word of THAT command, so they never read as a publish.
 * @param {string} cmd
 */
export const isPublishCommand = (cmd) => shellSegments(cmd).some((words) => PUBLISH_VERBS.some(([head, ...rest]) => {
  const i = headIndex(words, [head]);
  if (words[i]?.split("/").at(-1) !== head) return false;
  let k = 0;
  let skipValue = false;
  for (const w of words.slice(i + 1)) {
    if (skipValue) { skipValue = false; continue; }
    if (VALUE_OPTIONS[head].includes(w)) { skipValue = true; continue; }
    if (w === rest[k] && ++k === rest.length) return true;
  }
  return false;
}));

// KJC-BUG-0286: a $ expands only when something expandable follows it ($x, ${x},
// $(cmd), $1, $@...). A lone "$ " in a grep pattern is a literal dollar sign.
const LIVE_EXPANSION = /\$(?=[A-Za-z0-9_{(@*#?$!-])|`/;

/**
 * KJC-BUG-0243: blank the quoted text that cannot run: single-quoted spans, and
 * double-quoted spans with no live $ or backtick. What remains is what the shell
 * can still expand or execute, so operator and substitution checks read only that.
 * @param {string} cmd
 */
export const stripInertQuotes = (cmd) => {
  let out = "";
  for (let i = 0; i < cmd.length; i++) {
    const q = cmd[i];
    if (q !== "'" && q !== '"') { out += q; continue; }
    let j = i + 1;
    while (j < cmd.length && cmd[j] !== q) j += q === '"' && cmd[j] === "\\" ? 2 : 1;
    if (j >= cmd.length) return out + cmd.slice(i); // unclosed: left as is, for the caller to deny
    const body = cmd.slice(i + 1, j);
    out += q === "'" || !LIVE_EXPANSION.test(body) ? q + q : q + body + q;
    i = j;
  }
  return out;
};

// Options whose value is prose, never a path (gh, git, kj).
// KJC-BUG-0306: --error and --command of kj report-issue, --scope and --tests of kj hu add.
// KJC-BUG-0366: --why of kj handoff add.
const TEXT_OPTIONS = new Set(["--title", "--body", "--message", "-m", "--notes", "--description", "--ac", "--criteria", "--reason", "--decision", "--context", "--consequences", "--position", "--error", "--command", "--scope", "--tests", "--why"]);
const QUOTED_OPTION_VALUE = /(^|\s)(--?[a-z]+)(=|\s+)("[^"$`\\]*"|'[^']*')/g;
// KJC-BUG-0306: the title kj hu add and kj adr add take as their first argument, at the start of a segment.
// KJC-BUG-0366: and the command kj handoff add stores for the human.
const KJ_TITLE = /(^|[;&|]\s*)(kj\s+(?:hu|adr|handoff)\s+add\s+)("[^"$`\\]*"|'[^']*')/g;

/** KJC-BUG-0243: blank the inert quoted value of a text option (--title "a/b c"): prose, not a path. */
export const stripTextOptionValues = (cmd) => cmd
  .replace(KJ_TITLE, (m, pre, head, val) => `${pre}${head}${val[0]}${val[0]}`)
  .replace(QUOTED_OPTION_VALUE, (m, pre, opt, sep, val) => (TEXT_OPTIONS.has(opt) ? `${pre}${opt}${sep}${val[0]}${val[0]}` : m));

// KJC-BUG-0354: commands that only STORE their text: there, a quoted text value
// is never run. Anywhere else it may be (flock --command '...'), so it stays.
// git's global options that only pick where and how it runs may precede commit.
const GIT_GLOBAL_WITH_VALUE = new Set(["-c", "-C", "--git-dir", "--work-tree", "--namespace"]);
const GIT_GLOBAL_FLAG = /^(?:--no-pager|--(?:git-dir|work-tree|namespace)=\S+)$/;

const isGitCommit = (words) => {
  let i = 1;
  while (i < words.length) {
    if (GIT_GLOBAL_WITH_VALUE.has(words[i])) i += 2;
    else if (GIT_GLOBAL_FLAG.test(words[i])) i += 1;
    else break;
  }
  return words[0] === "git" && words[i] === "commit";
};

// KJC-BUG-0425: gh pr/issue/release commands only publish their text to GitHub.
const isTextOnlyHead = (seg) => /^kj\s+(?:hu|adr|handoff)\s+add\b/.test(seg) || /^gh\s+(?:pr|issue|release)\s+(?:create|edit|comment|review)\b/.test(seg) || isGitCommit(seg.split(/\s+/));

// KJC-BUG-0425: a heredoc whose delimiter is quoted expands nothing; read from stdin
// by a text-only command, it is the text stored or published. The FIRST line equal to
// the delimiter must be the last one, or the shell would run what follows it.
const HEREDOC_HEAD = /^([^\n]*?)[ \t]*<<(-?)[ \t]*(['"])([A-Za-z_]\w*)\3[ \t]*$/;
const READS_STDIN = /(^|\s)(?:--body-file|--notes-file|--file|-F)(?:=|\s+)-(?=\s|$)/;
const quotedHeredocHead = (cmd) => {
  const lines = cmd.replace(/\n$/, "").split("\n");
  const m = lines.length > 1 ? HEREDOC_HEAD.exec(lines[0]) : null;
  if (!m) return null;
  const [, head, dash, , delim] = m;
  const end = lines.findIndex((l, i) => i > 0 && (dash ? l.replace(/^\t+/, "") : l) === delim);
  return end === lines.length - 1 && READS_STDIN.test(head) ? head : null;
};

/**
 * KJC-BUG-0354: blank the quoted text values (stripTextOptionValues) only when the
 * whole input is a text-only command, so the human-act guards stop reading a
 * title or a commit message that merely mentions a guarded command.
 * @param {string} cmd
 */
export const stripTextOnlyCommandValues = (cmd) => {
  // Only a whole input that is ONE simple text-storage command: a chained
  // segment could follow a shell function that turns the stored text into code.
  const line = quotedHeredocHead(cmd) ?? cmd;
  const bare = stripInertQuotes(line);
  if (splitOutsideQuotes(line).length !== 1 || /[(){}<>`$\n]/.test(bare) || !isTextOnlyHead(line.trim())) return cmd;
  return stripTextOptionValues(line);
};

/** Segments and the ; && || | between them, cut only outside quotes (the pieces join back to cmd). */
function splitOutsideQuotes(cmd) {
  const parts = [];
  let start = 0;
  let quote = null;
  let i = 0;
  while (i < cmd.length) {
    const c = cmd[i];
    const op = quote ? null : /^(?:&&|\|\||;|\|)/.exec(cmd.slice(i))?.[0];
    if (quote) {
      // inside double quotes a backslash escapes the next character
      if (c === "\\" && quote === '"') i += 1;
      else if (c === quote) quote = null;
    } else if (c === "'" || c === '"') {
      quote = c;
    } else if (op) {
      parts.push(cmd.slice(start, i), op);
      start = i + op.length;
      i = start;
      continue;
    }
    i += 1;
  }
  parts.push(cmd.slice(start));
  return parts;
}

/**
 * KJC-BUG-0245: the values of the named options, read by the shell reader, so a
 * `;`, `&&` or `|` right after a path ends the word instead of joining it.
 * Covers `--opt value` and `--opt=value`.
 * @param {string} cmd
 * @param {string[]} names
 * @returns {string[]}
 */
export const optionValues = (cmd, names) => shellSegments(cmd).flatMap((words) => words.flatMap((w, i) => {
  if (names.includes(w) && i + 1 < words.length) return [words[i + 1]];
  const eq = w.indexOf("=");
  return eq > 0 && names.includes(w.slice(0, eq)) ? [w.slice(eq + 1)] : [];
}));

/**
 * KJC-BUG-0268: the words of a simple command without its redirections (2>&1,
 * >file, < file, >> log...) and the operand a detached operator takes. A
 * redirection is where output goes, never an argument of the command.
 * @param {string[]} words
 */
export const withoutRedirections = (words) => {
  const rest = [];
  let operand = false; // the previous word was a bare operator: this one is its target
  for (const word of words) {
    if (operand) operand = false;
    else if (!/^\d*[<>]/.test(word)) rest.push(word);
    else operand = /^\d*(<{1,3}|>>?|>[|&])$/.test(word);
  }
  return rest;
};

// KJC-BUG-0429 (ADR 0036): the guards decide by write verb. These readers were picked
// because no option of theirs writes a file or runs a program; a command made only of
// them, with output to the session, /dev/null or another descriptor, writes nothing.
const READERS = new Set(["cat", "head", "tail", "grep", "egrep", "fgrep", "ls", "wc", "diff", "cmp", "stat", "jq", "sha256sum", "sha1sum", "md5sum"]);
const GIT_READS = new Set(["log", "show", "diff", "status", "blame", "ls-files", "ls-tree", "cat-file", "rev-parse"]);
const GIT_WRITES_OR_RUNS = /^--(?:output|ext-diff|textconv)\b/;

const isGitRead = (words) => {
  let i = 1;
  while (i < words.length) {
    if (words[i] === "-C") i += 2;
    else if (words[i] === "-c" && /^user\.(?:name|email)=/.test(words[i + 1] ?? "")) i += 2;
    else if (words[i] === "--no-pager") i += 1;
    else break;
  }
  return GIT_READS.has(words[i]) && !words.some((w) => GIT_WRITES_OR_RUNS.test(w));
};

const REDIRECTION = /^(\d*)(>>|>&|>\||>|<)(.*)$/;
const quietRedirections = (words) => words.every((w, i) => {
  const m = REDIRECTION.exec(w);
  if (!m) return true;
  const [, , op, glued] = m;
  const target = glued || words[i + 1] || "";
  if (op === "<") return target !== "";
  if (op === ">&") return /^\d$/.test(target);
  return (op === ">" || op === ">>") && target === "/dev/null";
});

/**
 * Whether the command only reads: every simple command is a known reader and no
 * output goes to a file. Substitution, subshells, heredocs, expansion, newlines
 * or assignments are not provably that.
 * @param {string} cmd
 */
export const isReadOnlyCommand = (cmd) => {
  const bare = stripInertQuotes(String(cmd));
  if (/[(){}`\n]|<</.test(bare) || LIVE_EXPANSION.test(bare)) return false;
  const segs = shellSegments(cmd);
  return segs.length > 0 && segs.every((words) => {
    const rest = withoutRedirections(words);
    return quietRedirections(words) && (rest[0] === "git" ? isGitRead(rest) : READERS.has(rest[0]));
  });
};

/** Short flags of a cluster stop at "e": the rest is -e's value (-fen = -f -e n). */
export const shortOpts = (a) => (/^-[a-zA-Z]/.test(a) ? a.slice(1).split("e")[0] : "");
