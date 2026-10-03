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

/** Short flags of a cluster stop at "e": the rest is -e's value (-fen = -f -e n). */
export const shortOpts = (a) => (/^-[a-zA-Z]/.test(a) ? a.slice(1).split("e")[0] : "");
