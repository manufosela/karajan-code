// The Sentinel's bash-write guard (KJC-BUG-0237, moved here by KJC-TSK-0919,
// ADR 0014). Inside the repo, files are written through Edit/Write only, the path
// every gate guards. Copied byte for byte into .karajan/harness; `root` injected.
// The stated limit: a program you run can write files; only a sandbox stops that.
import { existsSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { headIndex, shellSegments, withoutRedirections } from "./sentinel-shell.mjs";

const WRITES = ["tee", "touch", "truncate", "cp", "mv", "install", "ln", "sed", "perl", "dd", "sh", "bash", "zsh", "dash", "eval"];
const RUNNERS = ["xargs", "find", "node", "python3", "python", "ruby", "php", "deno", "bun"];
// touch/truncate -s SIZE, -r REF, -d DATE, -t STAMP: the value is not a file it writes.
const VALUED = ["-s", "--size", "-r", "--reference", "-d", "--date", "-t"];

/** Redirection targets: >&N and >&- duplicate or close a descriptor; >& FILE and >&FILE write FILE. */
const redirections = (words) => {
  const out = [];
  words.forEach((w, k) => {
    const m = /^\d*(>>|>[|]|>)(.*)$/.exec(w);
    if (!m) return;
    const dup = m[2].startsWith("&") ? m[2].slice(1) : null;
    if (dup === null) out.push(m[2] || words[k + 1]);
    else if (dup === "") out.push(words[k + 1]);
    else if (!/^\d*-?$/.test(dup)) out.push(dup);
  });
  return out;
};

/** Destination of cp/mv/install/ln: -t DIR / --target-directory[=]DIR, else the last plain word. */
const destination = (rest, plain) => {
  const t = rest.findIndex((w) => w === "-t" || w === "--target-directory");
  const tEq = rest.find((w) => w.startsWith("--target-directory="));
  if (t >= 0) return [rest[t + 1]];
  if (tEq) return [tEq.slice(19)];
  return plain.length >= 2 ? [plain.at(-1)] : [];
};

/** Files sed/perl -i edit: the script is the word after -e/-f, else the first plain word; a lone plain word is the file. */
const inPlace = (rest, plain) => {
  if (!rest.some((w) => w.startsWith("--in-place") || /^-[a-zA-Z0-9]*i/.test(w))) return [];
  const script = rest.findIndex((w) => ["-e", "-f", "--expression"].includes(w));
  if (script >= 0) return plain.filter((w) => w !== rest[script + 1]);
  return plain.length === 1 ? plain : plain.slice(1);
};

/**
 * The files a simple command (a word list) writes from the shell. "$(...)"
 * marks a target that only exists at run time: unknowable, so writesRepo denies it.
 * @param {string[]} words
 * @returns {string[]}
 */
export const shellWrites = (words) => {
  const out = redirections(words);
  const i = headIndex(words, [...WRITES, ...RUNNERS]);
  const head = (words[i] || "").split("/").at(-1);
  // xargs / find -exec run a writer on targets that arrive at run time.
  if (["xargs", "find"].includes(head) && words.slice(i + 1).some((w) => WRITES.includes(w.split("/").at(-1)))) out.push(`$(${head})`);
  // Arguments without redirections (< << <<< > >> and a detached operand).
  const rest = withoutRedirections(words.slice(i + 1));
  // Operands: words that are not options, and EVERY word after "--" (touch -- -file).
  const cut = rest.includes("--") ? rest.indexOf("--") : rest.length;
  const plain = [...rest.slice(0, cut).filter((w) => !w.startsWith("-")), ...rest.slice(cut + 1)];
  if (head === "tee") out.push(...plain);
  if (head === "dd") out.push(...rest.filter((w) => w.startsWith("of=")).map((w) => w.slice(3)));
  // By position, not value (touch -d today today writes "today").
  if (head === "touch" || head === "truncate") out.push(...rest.filter((w, k) => k > cut || (k < cut && !w.startsWith("-") && !VALUED.includes(rest[k - 1]))));
  // sh -c / eval run a script of their own: its writes are this command's writes.
  if (["sh", "bash", "zsh", "dash"].includes(head) && rest.includes("-c")) for (const seg of shellSegments(rest[rest.indexOf("-c") + 1] || "")) out.push(...shellWrites(seg));
  if (head === "eval") for (const seg of shellSegments(rest.join(" "))) out.push(...shellWrites(seg));
  // An inline script (node -e, python -c...) that names a write API.
  const inline = rest[rest.findIndex((w) => ["-e", "-c", "--eval", "-p", "-r"].includes(w)) + 1] || "";
  if (/^(node|deno|bun|python[\d.]*|ruby|perl|php)$/.test(head) && /write|append|open|copy|rename|truncate|unlink|mkdir|symlink/i.test(inline)) out.push(`$(${head})`);
  if (["cp", "mv", "install", "ln"].includes(head)) out.push(...destination(rest, plain));
  if (head === "sed" || head === "perl") out.push(...inPlace(rest, plain));
  return out.filter(Boolean);
};

/**
 * Inside the repo, or unknowable ($VAR, backtick, ~user): both deny. /dev/* and
 * descriptor duplication (&1) are outside; ~/ is the home, where the repo may live.
 * Real paths: a link outside (/tmp/link -> repo) points in.
 * @param {string} t
 * @param {string} root
 */
export const writesRepo = (t, root) => {
  if (t.includes("$") || t.includes("`")) return true;
  if (t.startsWith("&") || t.startsWith("/dev/")) return false;
  if (t.startsWith("~") && t !== "~" && !t.startsWith("~/")) return true;
  let a = resolve(root, t.startsWith("~") ? homedir() + t.slice(1) : t);
  let tail = "";
  while (!existsSync(a) && dirname(a) !== a) {
    tail = join(a.slice(dirname(a).length + 1), tail);
    a = dirname(a);
  }
  let rel;
  try {
    rel = relative(realpathSync(root), join(realpathSync(a), tail));
  } catch {
    return true;
  }
  return !rel.startsWith("..") && !rel.startsWith("/");
};
