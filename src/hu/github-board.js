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
export class BoardOfflineError extends Error { name = "BoardOfflineError"; }
/** GitHub answered and said no (permissions, missing repo...). */
export class BoardRejectedError extends Error { name = "BoardRejectedError"; }
/** The HU is running and someone else holds it: taking it over is explicit (release). */
export class HuClaimedError extends Error { name = "HuClaimedError"; }

// KJC-TSK-1165: by name, not only instanceof: a test runner may load this module twice.
export const isOffline = (err) => err instanceof BoardOfflineError || err?.name === "BoardOfflineError";
/** GitHub answered and refused (rejected, or the HU is held by someone else): a conflict, not a failure of kj. */
export const isRefusal = (err) => err instanceof BoardRejectedError || err instanceof HuClaimedError || ["BoardRejectedError", "HuClaimedError"].includes(err?.name);

// gh is not localized: these are the network failures it prints.
const OFFLINE = /dial tcp|no such host|could not resolve host|connection refused|i\/o timeout|network is unreachable|error connecting to/i;

async function gh(run, args) {
  const res = await run("gh", args);
  if (res.exitCode === 0) return res.stdout ?? "";
  const why = (res.stderr || res.stdout || "").trim();
  const Kind = OFFLINE.test(why) ? BoardOfflineError : BoardRejectedError;
  throw new Kind(`gh ${args.slice(0, 2).join(" ")} failed: ${why}`);
}

// KJC-BUG-0393: a --json listing that matches nothing prints nothing at all, not "[]".
const listOf = (stdout) => (stdout.trim() === "" ? [] : JSON.parse(stdout));

async function ensureLabels(repo, run) {
  const existing = new Set(listOf(await gh(run, ["label", "list", "-R", repo, "--search", "kj:", "--json", "name", "--limit", "100"])).map((l) => l.name));
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
  const issues = listOf(await gh(run, ["issue", "list", "-R", repo, "--label", HU_LABEL, "--state", "all", "--limit", "1000", "--json", "number,title,state,labels,assignees"]));
  return issues.map((i) => ({ short_id: `HU-${i.number}`, number: i.number, title: i.title, status: statusOf(i), claimed_by: i.assignees[0]?.login ?? null }));
}

/** The one kj:<status> of an issue; none or several is a board someone broke by hand. */
function statusOf(issue) {
  const found = issue.labels.map((l) => l.name).filter((n) => STATUSES.some((s) => statusLabel(s) === n));
  if (found.length !== 1) throw new BoardRejectedError(`HU-${issue.number} has ${found.length} status labels (${found.join(", ") || "none"}): fix it to exactly one kj:<status>`);
  return found[0].slice(3);
}

async function view(repo, number, run) {
  const issue = JSON.parse(await gh(run, ["issue", "view", String(number), "-R", repo, "--json", "state,labels,assignees"]));
  // KJC-BUG-0392: only issues kj created as HUs are its to move; any other issue is left alone.
  if (!issue.labels.some((l) => l.name === HU_LABEL)) throw new BoardRejectedError(`issue #${number} is not a kj HU (no ${HU_LABEL} label): kj does not touch it`);
  return { ...issue, number, status: statusOf({ ...issue, number }), holders: issue.assignees.map((a) => a.login) };
}

/** Move the HU to `status`; done and skipped close the issue, anything else keeps it open. */
export async function setStatus({ repo, number, status, run = runCommand }) {
  if (!STATUSES.includes(status)) throw new Error(`invalid status "${status}": use ${STATUSES.join(", ")}`);
  const issue = await view(repo, number, run);
  // Every other status label goes, not only the one read: a concurrent move must not leave two.
  const others = STATUSES.filter((s) => s !== status).flatMap((s) => ["--remove-label", statusLabel(s)]);
  await gh(run, ["issue", "edit", String(number), "-R", repo, "--add-label", statusLabel(status), ...others]);
  const after = await view(repo, number, run);
  if (after.status !== status) throw new BoardRejectedError(`HU-${number} was moved to ${after.status} at the same time: check it before moving it again`);
  const closes = status === "done" || status === "skipped";
  if (closes && issue.state === "OPEN") await gh(run, ["issue", "close", String(number), "-R", repo]);
  if (!closes && issue.state === "CLOSED") await gh(run, ["issue", "reopen", String(number), "-R", repo]);
}

/** A running HU held by someone else is theirs: any move of it by `who` needs release. */
export async function assertNotHeld({ repo, number, who, run = runCommand }) {
  const issue = await view(repo, number, run);
  const others = issue.holders.filter((h) => h !== who);
  if (issue.status === "running" && others.length > 0) {
    throw new HuClaimedError(`HU-${number} is held by ${others.join(", ")}: taking it over is explicit (release)`);
  }
}

/** Reserve the HU for `who` (the assignee is the reservation); a running HU held by another needs release. */
export async function claim({ repo, number, who, release = false, run = runCommand }) {
  const issue = await view(repo, number, run);
  const others = issue.holders.filter((h) => h !== who);
  if (others.length > 0 && issue.status === "running" && !release) {
    throw new HuClaimedError(`HU-${number} is held by ${others.join(", ")}: taking it over is explicit (release)`);
  }
  const drop = others.flatMap((h) => ["--remove-assignee", h]);
  await gh(run, ["issue", "edit", String(number), "-R", repo, "--add-assignee", who, ...drop]);
  // Two people may claim at once and both see it free: read it back, and the same rule
  // on both sides (the first login in order keeps it; a release always keeps it) leaves one.
  const after = (await view(repo, number, run)).holders;
  const rivals = after.filter((h) => h !== who);
  if (rivals.length > 0) {
    if (!release && [who, ...rivals].sort()[0] !== who) {
      await gh(run, ["issue", "edit", String(number), "-R", repo, "--remove-assignee", who]);
      throw new HuClaimedError(`HU-${number} was claimed at the same time by ${rivals.join(", ")}, who keeps it`);
    }
    // The one who keeps it does not rely on the others backing off: it removes them.
    await gh(run, ["issue", "edit", String(number), "-R", repo, ...rivals.flatMap((h) => ["--remove-assignee", h])]);
  }
  // Every claim, release or not, ends with who as the only holder, or says it did not.
  const final = rivals.length > 0 ? (await view(repo, number, run)).holders : after;
  if (final.length !== 1 || final[0] !== who) {
    throw new HuClaimedError(`HU-${number} is held by ${final.join(", ") || "nobody"} after a concurrent claim: check it before working it`);
  }
  return { claimed_by: who };
}
