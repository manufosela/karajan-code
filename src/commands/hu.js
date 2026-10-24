/**
 * `kj hu add|move|list` (AB-H, KJC-TSK-0658) — board writes for the brain.
 * The v4 playbook orders "card first", but until now only the headless
 * planner could create HUs. These commands operate on a per-project
 * "brain-backlog" plan (created on first use) so any host agent can track
 * work in the HU Board without the subprocess pipeline.
 */
import { addHu, updateHuStatus } from "../plan/plan-hu-ops.js";
import { generatePlanId } from "../plan/plan-id.js";
import { savePlan, listPlans, loadPlan } from "../plan/plan-store.js";
import { detectHostAgent } from "../utils/agent-detect.js";
import { readIdentity } from "../identity/store.js";
import { effectiveGitEmail } from "../identity/detect.js";
import { roleSkills } from "../skills/role-skills.js";
import { readBoardConfig, setBoardBackend } from "../hu/board-config.js";
import { createHu, listHus, claim, setStatus, assertNotHeld, isOffline } from "../hu/github-board.js";
import { listWithCache, queueMove, flushQueue } from "../hu/team-board-cache.js";

// KJC-TSK-0661 (Jorge's friction): every HU records WHO created it — the
// board must never show work nobody can trace. Host agent env → that agent;
// a human typing in a terminal → "human"; anything else headless → "agent".
export function creatorLabel() {
  return detectHostAgent() || (process.stdin.isTTY ? "human" : "agent");
}

export const HU_STATUSES = ["pending", "running", "done", "failed", "skipped"];
const BACKLOG_NAME = "brain-backlog";

// KJC-TSK-0675 (issue #1288): agents that skip `kj hu list` created twins of
// existing work — sometimes in a DIFFERENT plan. Titles are compared
// normalized (case/punctuation-insensitive) across every live HU of every
// plan: identical → refuse; mostly-overlapping tokens → warn with candidates.
const normTitle = (t) => String(t || "").toLowerCase().replaceAll(/[^\p{L}\p{N}]+/gu, " ").trim();
const titleTokens = (t) => new Set(normTitle(t).split(" ").filter((w) => w.length > 2));

export function findTitleMatches(title, allHus) {
  const norm = normTitle(title);
  const toks = titleTokens(title);
  const identical = [];
  const similar = [];
  for (const h of allHus) {
    if (h.status === "skipped") continue; // discarded cards don't reserve titles
    if (normTitle(h.title) === norm) { identical.push(h); continue; }
    const other = titleTokens(h.title);
    const shared = [...toks].filter((w) => other.has(w)).length;
    const smaller = Math.min(toks.size, other.size);
    if (smaller > 0 && shared / smaller >= 0.8) similar.push(h);
  }
  return { identical, similar };
}

/** A repeatable flag as lines: one value or many, each split per line, blanks dropped. */
function linesOf(v) {
  const values = Array.isArray(v) ? v : [v];
  return values.filter((s) => s != null && s !== "").flatMap((s) => String(s).split("\n")).map((s) => s.trim()).filter(Boolean);
}

/** KJC-TSK-1163: kj hu add on the shared board; the same no-duplicates rule, checked against the issues. */
async function addToTeamBoard({ repo, title, flags, deps, emit }) {
  if (flags.id) throw new Error(`--id is not used with the shared board: GitHub gives each HU its id (the issue number)`);
  let hu;
  try {
    const { identical, similar } = findTitleMatches(title, await (deps.listTeamHus ?? listHus)({ repo }));
    if (identical.length > 0) {
      throw new Error(`An HU with this title already exists: ${identical[0].short_id} (status: ${identical[0].status}). Work that card or move it with: kj hu move ${identical[0].short_id} <status>`);
    }
    if (similar.length > 0) {
      const candidates = similar.map((h) => `  · ${h.short_id} (${h.status}) "${h.title}"`).join("\n");
      console.warn("⚠ possible duplicate — check before working it:\n" + candidates);
    }
    hu = await (deps.createTeamHu ?? createHu)({
      repo, title, acceptanceCriteria: [...linesOf(flags.ac), ...linesOf(flags.criteria)], tests: linesOf(flags.tests), ref: flags.ref ? String(flags.ref).trim() : null,
    });
  } catch (err) {
    // KJC-TSK-1165: an id is only ever minted by GitHub; nothing is created offline.
    if (isOffline(err)) throw new Error(`creating a HU needs the network: GitHub gives it its id and no local one is made up (${err.message})`, { cause: err });
    throw err;
  }
  return emit({ ...hu, board: "github", repo }, `✓ HU created: ${hu.short_id} (pending) in the shared board, issue #${hu.number} of ${repo}`);
}

/** KJC-TSK-1165: apply the moves queued offline; conflicts are said, never forced; still offline is silent. */
async function applyQueuedMoves({ projectDir, repo, deps }) {
  let now = null; // status of every HU as GitHub has it, read once, kept up to date as moves apply
  const apply = async (op) => {
    now ??= new Map((await (deps.listTeamHus ?? listHus)({ repo })).map((h) => [h.number, h.status]));
    // The HU moved while this clone was offline: the newer state wins, the queued move is a conflict.
    if (op.expected && now.get(op.number) !== op.expected) {
      const err = new Error(`HU-${op.number} is ${now.get(op.number) ?? "gone"} now and was ${op.expected} when the move was queued`);
      err.name = "BoardRejectedError";
      throw err;
    }
    if (op.status === "running" || op.release) await (deps.claimTeamHu ?? claim)({ repo, number: op.number, who: op.who, release: op.release });
    else await (deps.assertNotHeld ?? assertNotHeld)({ repo, number: op.number, who: op.who });
    await (deps.setTeamStatus ?? setStatus)({ repo, number: op.number, status: op.status });
    now.set(op.number, op.status);
  };
  const r = await flushQueue({ projectDir, apply });
  if (r.applied) console.warn(`✓ ${r.applied} queued move(s) applied to the shared board`);
  for (const c of r.conflicts) console.warn(`⚠ ${c}`);
}

/** KJC-TSK-1164: kj hu move on the shared board; starting it claims it (the assignee) first. */
async function moveOnTeamBoard({ repo, args, flags, deps, emit, who }) {
  const [ref, status] = args;
  if (!ref || !status) throw new Error("usage: kj hu move <id> <status>");
  if (!HU_STATUSES.includes(status)) throw new Error(`invalid status "${status}" — valid: ${HU_STATUSES.join(", ")}`);
  const number = Number(/^(?:HU-|#)(\d+)$/i.exec(ref)?.[1]);
  if (!Number.isInteger(number)) throw new Error(`"${ref}" is not a shared-board HU: use HU-<issue number>`);
  // GitHub assigns by login: kj identity must name the GitHub user of this clone.
  if (!who || who.includes("@")) throw new Error("the shared board reserves by GitHub login: declare it with kj identity set");
  // Starting it, or releasing it, claims it; any other move of a HU someone else runs is refused.
  if (status === "running" || flags.release) await (deps.claimTeamHu ?? claim)({ repo, number, who, release: Boolean(flags.release) });
  else await (deps.assertNotHeld ?? assertNotHeld)({ repo, number, who });
  await (deps.setTeamStatus ?? setStatus)({ repo, number, status });
  return emit({ id: `HU-${number}`, status, claimed_by: status === "running" ? who : null }, `✓ HU-${number} → ${status}`);
}

// Exported for the Steward's proposed-work sync (KJC-TSK-0792): broken
// invariants land in the same backlog the brain already consumes.
export async function backlogPlan(projectDir) {
  const plans = await listPlans(projectDir);
  const existing = plans.find((p) => p.alias === BACKLOG_NAME || p.name === BACKLOG_NAME);
  if (existing) return loadPlan(projectDir, existing.planId);
  const plan = {
    version: 2, planId: generatePlanId(), name: BACKLOG_NAME,
    task: "Host-agent tracked work (v4 environment)",
    status: "ready", hus: [], createdAt: new Date().toISOString(),
  };
  const planId = await savePlan(projectDir, plan);
  return loadPlan(projectDir, planId);
}

// KJC-TSK-1047 (TEAM-A): who works this clone, the one a started card is reserved to.
const workerOf = (projectDir) => readIdentity(projectDir)?.gh_user || effectiveGitEmail(projectDir) || null;

export async function huCommand({ config = null, action, args = [], flags = {}, deps = {} }) {
  const projectDir = config?.projectDir || process.cwd();
  const emit = (obj, human) => { console.log(flags.json ? JSON.stringify(obj) : human); return obj; };

  // KJC-BUG-0305 (issue #2042): the HU Board is always kj's board. An external
  // tracker coexists with it: each HU points at its replica there (--ref).
  const externalBoard = config?.state_backend === "external" ? (config?.board?.name || "the external board") : null;

  // KJC-TSK-1163/1164 (ADR 0025): the repo's board; with the shared one on, add/list/move go to GitHub.
  // The repo turns its board on once; the file travels in a PR. Before reading it: it may be what is fixed.
  if (action === "backend") {
    if (!args[0]) throw new Error("usage: kj hu backend <github | local>");
    const r = await (deps.setBackend ?? setBoardBackend)({ projectDir, backend: args[0] });
    const where = r.backend === "github" ? `GitHub Issues of ${r.repo}` : "the local board";
    const files = r.gitignoreChanged ? `${r.file} and .gitignore` : r.file;
    return emit(r, `✓ HU Board: ${where} — commit ${files} in a PR so the whole team inherits it`);
  }
  const board = await (deps.boardConfig ?? readBoardConfig)(projectDir);
  const who = deps.who === undefined ? workerOf(projectDir) : deps.who;
  // KJC-TSK-1165 (TEAM-GH-D): moves made without network go first, once GitHub answers.
  if (board.backend === "github") await applyQueuedMoves({ projectDir, repo: board.repo, deps });
  if (board.backend === "github" && action === "list") {
    const { source, rows: hus, updatedAt } = await listWithCache({ projectDir, repo: board.repo, list: deps.listTeamHus ?? listHus });
    if (source === "cache") console.warn(`⚠ GitHub did not answer: this is the local copy of the board from ${updatedAt}`);
    const rows = hus.map((h) => ({ ...h, id: h.short_id, plan: "github" }));
    if (flags.json) { console.log(JSON.stringify(rows)); return rows; }
    for (const r of rows) {
      const held = r.claimed_by ? " · held by " + r.claimed_by : "";
      console.log(`${r.short_id.padEnd(28)} ${r.status.padEnd(8)} ${r.title}  [${board.repo}${held}]`);
    }
    if (rows.length === 0) console.log("no HUs yet — create one with: kj hu add \"<story>\"");
    return rows;
  }
  // KJC-BUG-0392: a zero-padded id (HU-0104) is a local HU from before the shared board: it stays local.
  const legacyLocal = /^HU-0\d+$/i.test(String(args[0] ?? ""));
  if (board.backend === "github" && action === "move" && !legacyLocal) {
    try {
      return await moveOnTeamBoard({ repo: board.repo, args, flags, deps, emit, who });
    } catch (err) {
      // Offline: the move waits in the queue; GitHub still decides when it is applied.
      if (!isOffline(err)) throw err;
      const number = Number(/^(?:HU-|#)(\d+)$/i.exec(args[0])[1]);
      queueMove({ projectDir, number, status: args[1], who, release: Boolean(flags.release) });
      console.warn(`⚠ GitHub did not answer: HU-${number} → ${args[1]} queued, applied when GitHub answers again`);
      return emit({ id: `HU-${number}`, status: args[1], queued: true }, `⏳ HU-${number} → ${args[1]} (queued)`);
    }
  }

  if (action === "list") {
    const plans = await listPlans(projectDir);
    const rows = [];
    for (const meta of plans) {
      const plan = await loadPlan(projectDir, meta.planId);
      for (const h of plan.hus || []) {
        rows.push({
          id: h.id, short_id: h.short_id, title: h.title, status: h.status,
          plan: plan.alias || plan.planId,
          // KJC-TSK-0661: provenance — where a card came from is part of
          // the card. Older HUs predate the stamp: shown as "?".
          created_by: h.created_by || null, created_at: h.createdAt || null,
          external_ref: h.external_ref || null,
          claimed_by: h.claimed_by || null, claimed_at: h.claimed_at || null,
        });
      }
    }
    if (flags.json) { console.log(JSON.stringify(rows)); return rows; }
    for (const r of rows) {
      const reserved = r.status === "running" && r.claimed_by ? `reserved by ${r.claimed_by}` : null;
      const suffixes = [r.created_at?.slice(0, 10), r.external_ref, reserved].filter(Boolean).map((s) => ` · ${s}`).join("");
      const origin = `${r.plan} · by ${r.created_by || "?"}${suffixes}`;
      console.log(`${(r.short_id || r.id).padEnd(28)} ${r.status.padEnd(8)} ${r.title}  [${origin}]`);
    }
    if (rows.length === 0) console.log("no HUs yet — create one with: kj hu add \"<story>\"");
    else console.log("→ work one: ask your agent, or kj run --plan <plan> · discard one: kj hu move <id> skipped");
    return rows;
  }

  if (action === "add") {
    const title = args[0];
    if (!title || !title.trim()) throw new Error("kj hu add requires a title: kj hu add \"<story>\"");
    // KJC-TSK-1163 (ADR 0025): with the shared board on, the HU is an issue and GitHub gives its id.
    if (board.backend === "github") return addToTeamBoard({ repo: board.repo, title, flags, deps, emit });
    // Cross-plan title dedup (KJC-TSK-0675) — check BEFORE creating anything.
    const allHus = [];
    for (const meta of await listPlans(projectDir)) {
      const p = await loadPlan(projectDir, meta.planId);
      for (const h of p.hus || []) allHus.push({ ...h, plan: p.alias || p.name || p.planId });
    }
    const { identical, similar } = findTitleMatches(title, allHus);
    if (identical.length > 0) {
      const ref = identical[0];
      throw new Error(
        `An HU with this title already exists: ${ref.short_id || ref.id} (status: ${ref.status}, plan: ${ref.plan}). `
        + `HUs are never duplicated — work that card, move it with: kj hu move ${ref.short_id || ref.id} <status>, `
        + `or run kj hu list before adding.`
      );
    }
    if (similar.length > 0) {
      const plural = similar.length === 1 ? "" : "s";
      const candidates = similar.map((h) => `  · ${h.short_id || h.id} (${h.status}, plan: ${h.plan}) "${h.title}"`).join("\n");
      console.warn(`⚠ possible duplicate${plural} — check before working it:\n${candidates}`);
    }
    const plan = await backlogPlan(projectDir);
    /** Lowest free HU-#### in this plan — ids are permanent, never reused. */
    const nextHuRef = (p) => {
      const taken = new Set((p.hus || []).map((h) => h.short_id).filter(Boolean));
      let n = 1;
      while (taken.has(`HU-${String(n).padStart(4, "0")}`)) n += 1;
      return `HU-${String(n).padStart(4, "0")}`;
    };
    // KJC-TSK-0669 (absolute rule): cards are permanent. The delete-and-
    // recreate "fix" an agent improvises loses history and duplicates ids —
    // refuse it with the norm spelled out.
    if (flags.id) {
      const dup = (plan.hus || []).find((h) => h.short_id === flags.id);
      if (dup) {
        throw new Error(
          `HU "${flags.id}" already exists (status: ${dup.status}). HUs are never deleted or recreated — `
          + `update its state with: kj hu move ${flags.id} <pending|running|done|failed|skipped>, `
          + `or discard it with: kj hu move ${flags.id} skipped`
        );
      }
    }
    // KJC-TSK-0678 (issue #1296): complete HUs in ONE call. --ac / --tests
    // are repeatable AND accept multiline strings; --criteria stays as the
    // legacy single-criterion alias.
    const TASK_TYPES = ["sw", "infra", "doc", "add-tests", "refactor"];
    if (flags.taskType && !TASK_TYPES.includes(flags.taskType)) {
      throw new Error(`invalid --task-type "${flags.taskType}" — valid: ${TASK_TYPES.join(", ")}`);
    }
    const splitLines = linesOf;
    const hu = addHu(plan, {
      title,
      // KJC-BUG-0189: the card-first gate demands a branch that references a
      // card, and it is this command the gate sends the agent to. The
      // canonical plan id (hu_plan-<stamp>-<rand>_001) does not match
      // CARD_REF_RE, so without an explicit --id the card kj just created
      // could not satisfy kj's own gate. Sequential HU-#### does.
      short_id: flags.id || nextHuRef(plan),
      acceptance_criteria: [...splitLines(flags.ac), ...splitLines(flags.criteria)],
      acceptance_tests: splitLines(flags.tests),
      scope: flags.scope || null,
      task_type: flags.taskType || undefined,
    });
    hu.created_by = creatorLabel();
    if (flags.ref) hu.external_ref = String(flags.ref).trim();
    await savePlan(projectDir, plan);
    if (externalBoard && !hu.external_ref) {
      console.log(`→ replicate it in ${externalBoard} through your agent's MCP/tools and link both: kj hu add ... --ref <id in ${externalBoard}>`);
    }
    const missing = [];
    if (hu.acceptance_criteria.length === 0) missing.push("acceptance criteria (--ac \"...\")");
    if (hu.acceptance_tests.length === 0) missing.push("tests (--tests \"...\")");
    if (missing.length > 0) {
      console.warn(`⚠ incomplete spec — kj run's spec review will flag it. Missing: ${missing.join(", ")}`);
    }
    return emit({
      id: hu.id, short_id: hu.short_id, status: hu.status, created_by: hu.created_by,
      acceptance_criteria: hu.acceptance_criteria, acceptance_tests: hu.acceptance_tests,
      scope: hu.scope, task_type: hu.task_type, external_ref: hu.external_ref || null,
    }, `✓ HU created: ${hu.short_id || hu.id} (pending, by ${hu.created_by}) — it shows up in \`kj board\``);
  }

  if (action === "move") {
    const [ref, status] = args;
    if (!ref || !status) throw new Error("usage: kj hu move <id> <status>");
    if (!HU_STATUSES.includes(status)) {
      throw new Error(`invalid status "${status}" — valid: ${HU_STATUSES.join(", ")}`);
    }
    // Exact canonical id wins outright (it IS the disambiguator); only then
    // fall back to short_id matches — which can repeat between plans, so
    // silently moving the first hit could move the wrong card.
    const byId = [];
    const byShort = [];
    const running = [];
    for (const meta of await listPlans(projectDir)) {
      const plan = await loadPlan(projectDir, meta.planId);
      for (const hu of plan.hus || []) {
        if (hu.id === ref) byId.push({ plan, hu });
        else if (hu.short_id === ref) byShort.push({ plan, hu });
        if (hu.status === "running") running.push(hu);
      }
    }
    const matches = byId.length > 0 ? byId : byShort;
    if (matches.length === 0) throw new Error(`HU "${ref}" not found — see kj hu list`);
    if (matches.length > 1) {
      const ids = matches.map((m) => m.hu.id).join(", ");
      throw new Error(`"${ref}" is ambiguous (${matches.length} matches: ${ids}) — use the full id`);
    }
    const { plan, hu } = matches[0];
    // KJC-TSK-0688 (MG-C): the nudge fires AT the deviation — a second
    // concurrent task belongs in its own lane, not in the shared tree.
    const others = running.filter((r) => r.id !== hu.id);
    if (status === "running" && hu.status !== "running" && others.length > 0) {
      const slug = String(hu.short_id || hu.id).toLowerCase();
      console.warn(
        `⚠ ${others.map((r) => r.short_id || r.id).join(", ")} ${others.length === 1 ? "is" : "are"} already running — `
        + `a second concurrent task should live in its own lane: kj worktree start ${slug}`
      );
    }
    // KJC-TSK-1047 (TEAM-A): a running card reserved by someone else moves only with --release.
    const who = deps.who === undefined ? workerOf(projectDir) : deps.who;
    const label = hu.short_id || hu.id;
    // An unidentified caller is not the one who reserved it.
    const takenOver = hu.status === "running" && hu.claimed_by && hu.claimed_by !== who;
    if (takenOver && !flags.release) {
      throw new Error(`${label} is reserved by ${hu.claimed_by} since ${hu.claimed_at} — releasing it is explicit: kj hu move ${ref} ${status} --release`);
    }
    const starting = status === "running" && hu.status !== "running";
    // A running card nobody reserved is reserved by who moves it there again, once kj knows who.
    const unclaimedRunning = status === "running" && !hu.claimed_by && who;
    updateHuStatus(plan, hu.id, status);
    // Starting it, or releasing it to any status, rewrites the reservation: who did it, or nobody.
    if (starting || takenOver || unclaimedRunning) Object.assign(hu, { claimed_by: who ?? null, claimed_at: who ? new Date().toISOString() : null });
    if (starting && !who) console.warn(`⚠ ${label} is not reserved: kj cannot tell who works this clone — declare it with kj identity set`);
    await savePlan(projectDir, plan);
    // KJC-TSK-1065: the host session starts the card here; it learns which skills apply and where to read them.
    if (starting && !flags.json) {
      const text = [hu.title, hu.scope, ...(Array.isArray(hu.acceptance_criteria) ? hu.acceptance_criteria : [])].filter(Boolean).join(" ");
      const { skills } = await (deps.skills ?? roleSkills)({ role: "coder", task: text, projectDir });
      const where = (s) => (s.path ? ": read " + s.path : " (native)");
      if (skills.length) console.log([`skills for ${label} (read them before you start):`, ...skills.map((s) => "- " + s.name + where(s))].join("\n"));
    }
    return emit({ id: hu.id, status, claimed_by: hu.claimed_by ?? null }, `✓ ${label} → ${status}`);
  }

  throw new Error(`unknown action "${action}" — use: add | move | list | backend`);
}
