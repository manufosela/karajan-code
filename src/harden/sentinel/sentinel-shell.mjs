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
 * KJC-BUG-0243: blank the quoted text that cannot run: single-quoted spans, and
 * double-quoted spans with no $ or backtick. What remains is what the shell can
 * still expand or execute, so operator and substitution checks read only that.
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
    out += q === "'" || !/[$`]/.test(body) ? q + q : q + body + q;
    i = j;
  }
  return out;
};

// Options whose value is prose, never a path (gh, git, kj).
const TEXT_OPTION = /(^|\s)(--title|--body|--message|-m|--notes|--description|--ac|--criteria|--reason|--decision|--context|--consequences)(=|\s+)("[^"$`\\]*"|'[^']*')/g;

/** KJC-BUG-0243: blank the inert quoted value of a text option (--title "a/b c"): prose, not a path. */
export const stripTextOptionValues = (cmd) => cmd.replace(TEXT_OPTION, (_m, pre, opt, sep, val) => `${pre}${opt}${sep}${val[0]}${val[0]}`);

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

/** Short flags of a cluster stop at "e": the rest is -e's value (-fen = -f -e n). */
export const shortOpts = (a) => (/^-[a-zA-Z]/.test(a) ? a.slice(1).split("e")[0] : "");
