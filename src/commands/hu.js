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

export async function huCommand({ config = null, action, args = [], flags = {} }) {
  const projectDir = config?.projectDir || process.cwd();
  const emit = (obj, human) => { console.log(flags.json ? JSON.stringify(obj) : human); return obj; };

  // KJC-TSK-0684 (issue #1287): with an external board declared, kj never
  // maintains a parallel HU Board — writes are refused with the pointer.
  if (config?.state_backend === "external" && (action === "add" || action === "move")) {
    const name = config?.board?.name || "an external board";
    throw new Error(
      `this project's board lives in ${name} (state_backend: external) — create and move cards there, `
      + `through your agent's MCP/tools. kj does not mirror external boards.`
    );
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
        });
      }
    }
    if (flags.json) { console.log(JSON.stringify(rows)); return rows; }
    for (const r of rows) {
      const origin = `${r.plan} · by ${r.created_by || "?"}${r.created_at ? ` · ${r.created_at.slice(0, 10)}` : ""}`;
      console.log(`${(r.short_id || r.id).padEnd(28)} ${r.status.padEnd(8)} ${r.title}  [${origin}]`);
    }
    if (rows.length === 0) console.log("no HUs yet — create one with: kj hu add \"<story>\"");
    else console.log("→ work one: ask your agent, or kj run --plan <plan> · discard one: kj hu move <id> skipped");
    return rows;
  }

  if (action === "add") {
    const title = args[0];
    if (!title || !title.trim()) throw new Error("kj hu add requires a title: kj hu add \"<story>\"");
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
    const splitLines = (v) => (Array.isArray(v) ? v : v ? [v] : [])
      .flatMap((s) => String(s).split("\n")).map((s) => s.trim()).filter(Boolean);
    const hu = addHu(plan, {
      title,
      short_id: flags.id || null,
      acceptance_criteria: [...splitLines(flags.ac), ...splitLines(flags.criteria)],
      acceptance_tests: splitLines(flags.tests),
      scope: flags.scope || null,
      task_type: flags.taskType || undefined,
    });
    hu.created_by = creatorLabel();
    await savePlan(projectDir, plan);
    const missing = [];
    if (hu.acceptance_criteria.length === 0) missing.push("acceptance criteria (--ac \"...\")");
    if (hu.acceptance_tests.length === 0) missing.push("tests (--tests \"...\")");
    if (missing.length > 0) {
      console.warn(`⚠ incomplete spec — kj run's spec review will flag it. Missing: ${missing.join(", ")}`);
    }
    return emit({
      id: hu.id, short_id: hu.short_id, status: hu.status, created_by: hu.created_by,
      acceptance_criteria: hu.acceptance_criteria, acceptance_tests: hu.acceptance_tests,
      scope: hu.scope, task_type: hu.task_type,
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
    updateHuStatus(plan, hu.id, status);
    await savePlan(projectDir, plan);
    return emit({ id: hu.id, status }, `✓ ${hu.short_id || hu.id} → ${status}`);
  }

  throw new Error(`unknown action "${action}" — use: add | move | list`);
}
