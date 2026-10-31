/**
 * ADRs in the repo (AB-H, KJC-TSK-0658) — `kj adr add|list`. Architecture
 * decisions live as numbered markdown under .karajan/adrs/, git-tracked so
 * the whole team (and every brain) inherits them. The architect brief's
 * "check the ADRs before deciding" now has a target on every backend.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const ADR_DIR = path.join(".karajan", "adrs");
// KJC-BUG-0272: whoever records a decision proposes it. Accepting is the user's:
// they set `Status: accepted` in the file. Born accepted, nobody had decided.
const NEW_STATUS = "proposed";

const slugify = (t) => t.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-").replaceAll(/^-|-$/g, "").slice(0, 60);

export async function listAdrs(projectDir) {
  const dir = path.join(projectDir, ADR_DIR);
  let files;
  try { files = await fs.readdir(dir); } catch { return []; }
  const adrs = [];
  for (const f of files.filter((f) => /^\d{4}-.*\.md$/.test(f)).sort()) {
    const text = await fs.readFile(path.join(dir, f), "utf8");
    const title = text.match(/^# (.+)$/m)?.[1] || f;
    const status = text.match(/^Status: (.+)$/m)?.[1] || "accepted";
    adrs.push({ file: path.join(ADR_DIR, f), number: Number(f.slice(0, 4)), title, status });
  }
  return adrs;
}

const realGit = (cwd) => async (args) => (await promisify(execFile)("git", args, { cwd })).stdout;

// HU-2792: numbers that open branches hold, read from the local origin/* refs
// (no network). Not a git repo, or no remotes: nothing taken, as before.
async function remoteAdrNumbers(run) {
  try {
    const refs = (await run(["for-each-ref", "--format=%(refname)", "refs/remotes/origin"])).split("\n").filter(Boolean);
    const trees = await Promise.all(refs.map((ref) => run(["ls-tree", "--name-only", ref, `${ADR_DIR}/`]).catch(() => "")));
    return trees.flatMap((t) => t.split("\n")).map((f) => /\/(\d{4})-[^/]*\.md$/.exec(f)?.[1]).filter(Boolean).map(Number);
  } catch { return []; }
}

export async function addAdr(projectDir, { title, decision, context = "", consequences = "" }, run = realGit(projectDir)) {
  if (!title?.trim() || !decision?.trim()) {
    throw new Error("kj adr add requires a title and --decision");
  }
  const existing = await listAdrs(projectDir);
  const number = Math.max(0, ...existing.map((a) => a.number), ...await remoteAdrNumbers(run)) + 1;
  const file = path.join(ADR_DIR, `${String(number).padStart(4, "0")}-${slugify(title)}.md`);
  const body = [
    `# ${title}`, "",
    `Status: ${NEW_STATUS}`, `Date: ${new Date().toISOString().slice(0, 10)}`, "",
    ...(context ? ["## Context", "", context, ""] : []),
    "## Decision", "", decision, "",
    ...(consequences ? ["## Consequences", "", consequences, ""] : []),
  ].join("\n");
  await fs.mkdir(path.join(projectDir, ADR_DIR), { recursive: true });
  await fs.writeFile(path.join(projectDir, file), body);
  return { number, file, title, status: NEW_STATUS };
}
