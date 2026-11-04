/**
 * KJC-TSK-1163 (TEAM-GH-B, ADR 0025): which HU Board a repo uses. The shared
 * board on GitHub Issues is turned on once per repo (kj hu backend github),
 * in a versioned file the whole team inherits with a pull; kj never turns it
 * on because the remote happens to be GitHub. No file means the local board.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml, stringify as toYaml } from "yaml";
import { runCommand } from "../utils/process.js";
import { ensureGateTrackable } from "../review/gate-gitignore.js";
import { parseAllow } from "./managers/allowlist.js";

export const BOARD_FILE = ".karajan/board.yml";
const BACKENDS = ["github", "linear", "local"];
const REPO_RE = /^[\w.-]+\/[\w.-]+$/;
// board.yml is versioned: a key that looks like a credential never belongs in it (ADR 0032).
// `kj config --check-secrets` judges fixed paths of kj.config.yml, so it does not fit here: keys are matched by name.
const SECRET_KEY = /key|token|secret|password/i;
const LINEAR_STATES = { pending: "Todo", running: "In Progress", done: "Done", failed: "Canceled", skipped: "Canceled" };

function assertNoSecrets(node) {
  for (const [key, value] of Object.entries(node ?? {})) {
    if (SECRET_KEY.test(key)) throw new Error(`${BOARD_FILE}: "${key}" looks like a credential: credentials come from the environment, never from this versioned file`);
    if (typeof value === "object") assertNoSecrets(value);
  }
}

/** owner/repo of a GitHub remote (https, ssh, or an ssh host alias like github.com-work), or null. */
export function repoFromRemote(url) {
  const u = String(url).trim();
  // The host is github.com exactly, or an ssh alias of it written github.com-<name>; never a lookalike.
  const shapes = [
    /^https:\/\/(?:[^@/]+@)?github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/,
    /^ssh:\/\/(?:[\w.-]+@)?github\.com(?:-\w+)?(?::\d+)?\/([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/,
    /^(?:[\w.-]+@)?github\.com(?:-\w+)?:([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/,
  ];
  const m = shapes.map((re) => re.exec(u)).find(Boolean);
  return m ? `${m[1]}/${m[2]}` : null;
}

/** The repo's board: {backend: "local"} with no file, or the validated content of the file. */
export async function readBoardConfig(projectDir) {
  let text;
  try {
    text = await fs.readFile(path.join(projectDir, BOARD_FILE), "utf8");
  } catch (err) {
    if (err.code === "ENOENT") return { backend: "local" };
    throw err;
  }
  const raw = parseYaml(text) || {};
  const allow = parseAllow(raw.managers);
  const community = allow.some((item) => item.backend === raw.backend);
  if (!BACKENDS.includes(raw.backend) && !community) throw new Error(`${BOARD_FILE}: backend must be one of ${BACKENDS.join(", ")}, or a manager listed in managers.allow`);
  assertNoSecrets(raw);
  if (community) return { backend: raw.backend, managers: raw.managers, [raw.backend]: raw[raw.backend] };
  if (raw.backend === "local") return { backend: "local" };
  if (raw.backend === "linear") {
    if (raw.linear === null || typeof raw.linear !== "object") throw new Error(`${BOARD_FILE}: backend linear needs a linear block (team, label, states)`);
    return { backend: "linear", linear: raw.linear };
  }
  // Old files keep `repo:` at the top level; the github block says the same.
  const repo = raw.github?.repo ?? raw.repo;
  if (!REPO_RE.test(String(repo ?? ""))) throw new Error(`${BOARD_FILE}: repo must be owner/repo, got "${repo}"`);
  return { backend: "github", repo };
}

/** Turn a board on for the repo, writing the versioned file and making sure git tracks it. */
export async function setBoardBackend({ projectDir, backend, team, run = runCommand, trackable = ensureGateTrackable }) {
  if (!BACKENDS.includes(backend)) throw new Error(`unknown board backend "${backend}": use ${BACKENDS.join(", ")}`);
  const git = (...args) => run("git", ["-C", projectDir, ...args]);
  const doc = { backend };
  // Placeholders to fill in: the team key, the label that marks kj's stories, the state each status maps to.
  if (backend === "linear") doc.linear = { team: team ?? "TEAM", label: "kj:hu", states: LINEAR_STATES };
  if (backend === "github") {
    const remote = await git("remote", "get-url", "origin");
    const repo = remote.exitCode === 0 ? repoFromRemote(remote.stdout) : null;
    if (!repo) throw new Error(`origin is not a GitHub remote (${(remote.stdout || remote.stderr || "").trim() || "none"}): the shared board lives in GitHub Issues`);
    doc.repo = repo;
  }
  // Trackable BEFORE it is written (check-ignore needs no file): a board the team cannot
  // inherit is never left behind. Exit 0 means git ignores it.
  const isIgnored = async () => (await git("check-ignore", "-q", BOARD_FILE)).exitCode === 0;
  const ignored = await isIgnored();
  if (ignored) {
    // A .karajan root exclude becomes the canonical block, which re-includes the board file.
    await trackable(projectDir);
    if (await isIgnored()) await appendReInclude(projectDir);
    if (await isIgnored()) throw new Error(`git still ignores ${BOARD_FILE}: re-include it in .gitignore so the team inherits the board`);
  }
  await fs.mkdir(path.join(projectDir, ".karajan"), { recursive: true });
  await fs.writeFile(path.join(projectDir, BOARD_FILE), toYaml(doc), "utf8");
  return { ...doc, file: BOARD_FILE, gitignoreChanged: ignored };
}

async function appendReInclude(projectDir) {
  const file = path.join(projectDir, ".gitignore");
  // Ignored by a global exclude with no .gitignore: the repo's own file outranks it.
  const text = await fs.readFile(file, "utf8").catch((err) => {
    if (err.code === "ENOENT") { return ""; }
    throw err;
  });
  await fs.writeFile(file, `${text}${text === "" || text.endsWith("\n") ? "" : "\n"}!${BOARD_FILE}\n`, "utf8");
}
