/**
 * KJC-TSK-1162 (TEAM-GH-A, ADR 0025): the shared HU Board on GitHub Issues.
 * Each HU is an issue of the repo: its number is the id (HU-<n>, unique by
 * construction, so two people never mint the same one), its state a
 * kj:<status> label, and who holds it the assignee. gh authenticates each
 * person; every call names the repo explicitly.
 */
import { runCommand } from "../utils/process.js";

export const HU_LABEL = "kj:hu";
export const STATUSES = ["pending", "running", "done", "failed", "skipped"];
const statusLabel = (s) => `kj:${s}`;

/** gh could not reach GitHub: the caller may queue the change, never invent data. */
export class BoardOfflineError extends Error {}
/** GitHub answered and said no (permissions, missing repo...). */
export class BoardRejectedError extends Error {}

// gh is not localized: these are the network failures it prints.
const OFFLINE = /dial tcp|no such host|could not resolve host|connection refused|i\/o timeout|network is unreachable|error connecting to/i;

async function gh(run, args) {
  const res = await run("gh", args);
  if (res.exitCode === 0) return res.stdout ?? "";
  const why = (res.stderr || res.stdout || "").trim();
  const Kind = OFFLINE.test(why) ? BoardOfflineError : BoardRejectedError;
  throw new Kind(`gh ${args.slice(0, 2).join(" ")} failed: ${why}`);
}

async function ensureLabels(repo, run) {
  const existing = new Set(JSON.parse(await gh(run, ["label", "list", "-R", repo, "--search", "kj:", "--json", "name", "--limit", "100"])).map((l) => l.name));
  for (const name of [HU_LABEL, ...STATUSES.map(statusLabel)].filter((n) => !existing.has(n))) {
    await gh(run, ["label", "create", name, "-R", repo, "--color", "1f6feb", "--description", "Karajan HU Board"]);
  }
}

const section = (title, items) => (items.length ? [`## ${title}`, ...items.map((i) => `- ${i}`), ""] : []);

/** Create the HU as an issue; returns its id, never one made up when GitHub did not answer. */
export async function createHu({ repo, title, acceptanceCriteria = [], tests = [], ref = null, run = runCommand }) {
  await ensureLabels(repo, run);
  const body = [...section("Acceptance criteria", acceptanceCriteria), ...section("Tests", tests), ...(ref ? [`Ref: ${ref}`, ""] : []), "<!-- kj:hu -->"].join("\n");
  const url = (await gh(run, ["issue", "create", "-R", repo, "--title", title, "--body", body, "--label", HU_LABEL, "--label", statusLabel("pending")])).trim();
  const number = Number(/\/issues\/(\d+)$/.exec(url)?.[1]);
  if (!Number.isInteger(number)) throw new BoardRejectedError(`gh issue create returned no issue URL: ${url}`);
  return { short_id: `HU-${number}`, number, status: "pending", title };
}

/** Every HU of the repo, with its status and who holds it. */
export async function listHus({ repo, run = runCommand }) {
  const issues = JSON.parse(await gh(run, ["issue", "list", "-R", repo, "--label", HU_LABEL, "--state", "all", "--limit", "1000", "--json", "number,title,state,labels,assignees"]));
  return issues.map((i) => {
    const found = i.labels.map((l) => l.name).filter((n) => STATUSES.some((s) => statusLabel(s) === n));
    if (found.length !== 1) throw new BoardRejectedError(`HU-${i.number} has ${found.length} status labels (${found.join(", ") || "none"}): fix it to exactly one kj:<status>`);
    return { short_id: `HU-${i.number}`, number: i.number, title: i.title, status: found[0].slice(3), claimed_by: i.assignees[0]?.login ?? null };
  });
}
