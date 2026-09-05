import { watch } from 'chokidar';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, existsSync, rmSync } from 'node:fs';
import { dirname, join, basename, isAbsolute, resolve as resolvePath } from 'node:path';
import { homedir } from 'node:os';
import {
  getKjHome,
  upsertProject,
  upsertStory,
  upsertSession,
  insertContextRequest,
  getDb,
  isTombstoned,
  getTombstone,
  removeTombstone,
} from './db.js';
import { publish as publishEvent } from './event-bus.js';
import { getSharedPlansDir, SHARED_DIR_NAME, isSharedPath } from 'karajan-core/shared-paths';
import { readConfig } from './config-yaml.js';

/**
 * KJC-PRP-0002 PR5: resolve the conflict policy that decides who wins
 * when the same planId is present in both the per-user cache
 * (~/.karajan/plans/<slug>/) and the shared dir (.karajan-shared/plans/).
 *
 * Implementation is "order of last write": `syncPlanFile` upserts by
 * planId, so whichever scan runs second overwrites whatever the first
 * one wrote. We just swap the visit order based on policy.
 *
 *   shared-wins (default) → per-user first, shared second
 *   local-wins            → shared first, per-user second
 *
 * Reads from kj.config.yml live; absent / malformed config falls back to
 * the safe team default. Project scope wins over global scope (same
 * precedence the rest of the config UI honours).
 */
function getSharedConflictPolicy() {
  const pluck = (cfg) => cfg?.raw?.huBoard?.sharedConflictPolicy;
  const valid = (v) => v === 'local-wins' || v === 'shared-wins';
  try {
    const projectCfg = readConfig({ scope: 'project' });
    if (valid(pluck(projectCfg))) return pluck(projectCfg);
    const globalCfg = readConfig({ scope: 'global' });
    if (valid(pluck(globalCfg))) return pluck(globalCfg);
  } catch { /* swallow — config UI handles surfacing errors */ }
  return 'shared-wins';
}

/**
 * Skip + best-effort fs cleanup when the resource is tombstoned. Returns
 * true if the caller should bail out (resource is dead).
 *
 * KJC-TSK-0380: without this, every fullScan/chokidar event resurrects
 * resources the user already deleted via the API.
 */
function skipIfTombstoned(resourceType, resourceId, fsPathToRemove) {
  if (!isTombstoned(resourceType, resourceId)) return false;
  if (fsPathToRemove) {
    try { rmSync(fsPathToRemove, { recursive: true, force: true }); } catch { /* best effort */ }
  }
  return true;
}

/**
 * Derive a human-readable project name from batch data.
 * Priority: explicit data.project_name → extracted from story text → sessionId.
 */
function deriveProjectName(data, fallbackId) {
  if (data.project_name) return data.project_name;
  // Try to find "Part of: <originalTask>" in any story's certified text
  const stories = data.stories || [];
  for (const story of stories) {
    const text = story.certified?.text || '';
    const match = text.match(/Part of:\s*([^\n]+)/);
    if (match) {
      return slugToTitle(match[1].trim());
    }
  }
  // Try first story's original text as a fallback
  if (stories[0]?.original?.text) {
    return slugToTitle(stories[0].original.text);
  }
  return fallbackId;
}

/**
 * Turn a free-text goal into a short title-cased name (max 60 chars).
 */
/**
 * Derive a stable `project_id` from a plan's absolute `projectDir`.
 * Used so every plan under the same source tree groups under one project
 * on the board (instead of 1 project per plan — the 2 101-stories bug).
 *
 * @param {string} projectDir
 * @returns {string}
 */
export function deriveProjectIdFromDir(projectDir) {
  if (!projectDir || typeof projectDir !== 'string') return 'unknown';
  // Same slug rule the plan-store uses, so identifiers match if we ever
  // cross-reference `~/.kj/plans/<slug>/` with this project_id.
  return projectDir
    .replace(/^\//, '')
    .replace(/[/\\]/g, '_')
    .replace(/[^a-zA-Z0-9_.-]/g, '')
    .slice(0, 120);
}

/** git-common-dir del directorio, con el stderr silenciado (no-git = throw). */
const defaultGitCommonDir = (dir) =>
  execFileSync('git', ['-C', dir, 'rev-parse', '--git-common-dir'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();

const canonicalDirCache = new Map();

/**
 * Resolve a projectDir to the REPO's identity (KJC-BUG-0160): a linked
 * worktree (`.claude/worktrees/*`, kj lanes) used to register the same
 * repo as a brand-new project — 13+ same-named entries in a real picker.
 * `git rev-parse --git-common-dir` points every worktree at the main
 * tree's `.git`; its parent is the canonical root. A non-git directory
 * keeps its own path as identity, as always.
 *
 * @param {string} projectDir
 * @param {(dir: string) => string} [gitCommonDir] Inyectable en tests.
 * @returns {string}
 */
export function canonicalProjectDir(projectDir, gitCommonDir = defaultGitCommonDir) {
  if (!projectDir || typeof projectDir !== 'string') return projectDir;
  if (canonicalDirCache.has(projectDir)) return canonicalDirCache.get(projectDir);
  let canonical = projectDir;
  try {
    const common = gitCommonDir(projectDir);
    const absCommon = isAbsolute(common) ? common : resolvePath(projectDir, common);
    canonical = dirname(absCommon);
  } catch {
    // Sin git no hay más identidad que la ruta — comportamiento de siempre.
  }
  canonicalDirCache.set(projectDir, canonical);
  return canonical;
}

/**
 * Turn a directory basename into a human-friendly Title Case string,
 * preserving every meaningful word. Unlike `slugToTitle`, this one does
 * NOT apply stopword filtering — directory names are concise on purpose
 * (e.g. "linux-assistant-orchestrator" → "Linux Assistant Orchestrator",
 * "my-dev-tool" → "My Dev Tool").
 *
 * @param {string} name
 * @returns {string}
 */
function titleCaseBasename(name) {
  const words = String(name || '')
    .replace(/[_\s]+/g, '-')
    .split('-')
    .map((w) => w.replace(/[^\p{L}\p{N}]/gu, ''))
    .filter(Boolean);
  if (words.length === 0) return String(name || '');
  return words.map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
}

function slugToTitle(text) {
  const STOPWORDS = new Set([
    'a', 'an', 'the', 'and', 'or', 'with', 'for', 'to', 'of', 'in', 'on',
    'is', 'it', 'its', 'this', 'that', 'these', 'those', 'be', 'been', 'being',
    'build', 'create', 'implement', 'make', 'develop', 'add', 'set', 'up',
    'setup', 'write', 'code', 'new', 'complete', 'from', 'scratch',
    'application', 'app', 'tool', 'system', 'project', 'using', 'use',
    'full', 'full-stack', 'fullstack', 'stack', 'based', 'simple', 'basic',
  ]);
  const words = String(text || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w && !STOPWORDS.has(w));
  const meaningful = words.slice(0, 6);
  if (meaningful.length === 0) return String(text).slice(0, 60).trim();
  const titled = meaningful.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  return titled.length > 60 ? titled.slice(0, 57) + '...' : titled;
}

/**
 * Parses a batch.json HU stories file and syncs to SQLite.
 * @param {string} filePath - Absolute path to the batch.json file
 */
function syncStoryFile(filePath) {
  try {
    const raw = readFileSync(filePath, 'utf-8');
    const data = JSON.parse(raw);
    const sessionId = data.session_id || basename(join(filePath, '..'));
    const projectId = data.project_id || sessionId;

    // Tombstone gate: if the project or its batch is buried, drop the
    // file from disk and skip. Without this, fullScan resurrects them.
    if (skipIfTombstoned('project', projectId, dirname(filePath))) return;
    if (skipIfTombstoned('story', sessionId, dirname(filePath))) return;

    // Skip if this is a non-auto batch and an auto- version already exists.
    // Prevents duplicate projects when both auto-s_xxx/ and s_xxx/ exist.
    if (!projectId.startsWith('auto-')) {
      const db = getDb();
      const autoExists = db.prepare('SELECT id FROM projects WHERE id = ?').get(`auto-${projectId}`);
      if (autoExists) {
        console.log(`[sync] Skipping ${projectId} — auto-${projectId} already covers this session`);
        return;
      }
    }

    upsertProject({
      id: projectId,
      name: deriveProjectName(data, projectId),
      last_activity: data.created_at || new Date().toISOString(),
      total_stories: (data.stories || []).length,
    });

    for (const story of data.stories || []) {
      const certified = story.certified || {};
      const quality = story.quality || {};
      const dimensions = quality.dimensions || {};

      // acceptance_criteria: support both array (auto-generator) and object (hu-reviewer)
      let acText = null;
      if (Array.isArray(story.acceptance_criteria)) {
        acText = JSON.stringify(story.acceptance_criteria);
      } else if (story.acceptance_criteria?.criteria) {
        acText = JSON.stringify(story.acceptance_criteria.criteria);
      }

      upsertStory({
        id: story.id,
        project_id: projectId,
        session_id: sessionId,
        status: story.status || 'pending',
        title: extractTitle(story),
        original_text: story.original?.text || certified.text || null,
        certified_as: certified.as || null,
        certified_want: certified.want || (certified.text ? certified.text.slice(0, 500) : null),
        certified_so_that: certified.so_that || null,
        quality_total: quality.total ?? null,
        quality_d1: dimensions.d1 ?? null,
        quality_d2: dimensions.d2 ?? null,
        quality_d3: dimensions.d3 ?? null,
        quality_d4: dimensions.d4 ?? null,
        quality_d5: dimensions.d5 ?? null,
        quality_d6: dimensions.d6 ?? null,
        antipatterns: quality.antipatterns ? JSON.stringify(quality.antipatterns) : null,
        ac_format: story.acceptance_criteria?.format || (Array.isArray(story.acceptance_criteria) ? 'list' : null),
        acceptance_criteria: acText,
        created_at: story.created_at,
        updated_at: story.updated_at,
        certified_at: story.certified_at || null,
      });

      // Sync context requests
      for (const ctx of story.context_requests || []) {
        insertContextRequest({
          story_id: story.id,
          fields_needed: ctx.fields_needed ? JSON.stringify(ctx.fields_needed) : null,
          question: ctx.question || null,
          answer: ctx.answer || null,
          requested_at: ctx.requested_at || null,
          answered_at: ctx.answered_at || null,
        });
      }
    }

    console.log(`[sync] Synced stories from ${basename(join(filePath, '..'))}: ${(data.stories || []).length} stories`);
    publishEvent({ type: 'batch', projectId, path: filePath });
  } catch (err) {
    console.error(`[sync] Error syncing story file ${filePath}:`, err.message);
  }
}

/**
 * Extracts a short title from a story.
 * @param {object} story
 * @returns {string}
 */
function extractTitle(story) {
  // Auto-generated HUs have story.title directly
  if (story.title && story.title !== story.id) return story.title.slice(0, 120);
  // HU-reviewer format: certified.want
  if (story.certified?.want) return story.certified.want.slice(0, 120);
  // Fallback: original text or id
  const text = story.original?.text || '';
  return text.slice(0, 120) || story.id;
}

/**
 * Parses a session.json file and syncs to SQLite.
 * @param {string} filePath - Absolute path to session.json
 */
function syncSessionFile(filePath) {
  try {
    const raw = readFileSync(filePath, 'utf-8');
    const data = JSON.parse(raw);
    const sessionId = data.id || basename(join(filePath, '..'));

    if (skipIfTombstoned('session', sessionId, dirname(filePath))) return;

    // Resolve which project this session belongs to:
    //   1. If a plan / HU batch already created `auto-<sessionId>`, reuse it
    //      so plan-based runs group with their HU batch.
    //   2. Otherwise fall back to the session's declared `project_id`.
    //   3. Otherwise → REJECT. Orphan sessions (no project_id and no batch)
    //      USED to be promoted to a fake "Orphan sessions" project, which
    //      violated the user's invariant: "Si se crea proyecto y se crean
    //      hus se asocian a proyecto. ES IMPOSIBLE QUE [no exista esa
    //      asociación]". Now we skip them entirely. The fix for the source
    //      (kj run always stamps project_id derived from cwd) lives in
    //      PR-F; this is the safety net so a leftover orphan can never
    //      again appear as a phantom project on the board.
    const autoProjectId = `auto-${sessionId}`;
    const db = getDb();
    const existingBatch = db.prepare('SELECT id FROM projects WHERE id = ?').get(autoProjectId);
    let projectId;
    if (existingBatch) {
      projectId = autoProjectId;
    } else if (data.project_id) {
      projectId = data.project_id;
    } else {
      // Orphan: log + skip. Never promote to "default".
      console.warn(`[sync] Session ${sessionId} has no project_id and no matching batch — skipping (orphan). File: ${filePath}`);
      return;
    }

    // Ensure the project row exists. Skip when an auto-batch owns it already
    // (that row was written by syncStoryFile with richer metadata and we do
    // not want to overwrite name/total_stories).
    if (!existingBatch) {
      upsertProject({
        id: projectId,
        name: projectId,
        last_activity: data.updated_at || data.created_at || new Date().toISOString(),
        total_stories: 0,
      });
    }

    // Calculate iterations from checkpoints
    const checkpoints = data.checkpoints || [];
    const maxIteration = checkpoints.reduce((max, cp) => Math.max(max, cp.iteration || 0), 0);

    // Calculate duration from first and last checkpoint
    let durationMs = null;
    if (data.created_at && data.updated_at) {
      durationMs = new Date(data.updated_at).getTime() - new Date(data.created_at).getTime();
    }

    // Collect completed stages
    const stagesSet = new Set();
    for (const cp of checkpoints) {
      if (cp.stage && !cp.stage.includes('attempt') && !cp.stage.includes('checkpoint')) {
        stagesSet.add(cp.stage);
      }
    }

    // Project row was created above (unless an auto-batch owns it); the
    // session always has a project to attach to now.

    upsertSession({
      id: sessionId,
      project_id: projectId,
      task: data.task || null,
      status: data.status || 'unknown',
      created_at: data.created_at,
      updated_at: data.updated_at,
      iterations: maxIteration,
      duration_ms: durationMs,
      approved: data.status === 'approved' ? 1 : 0,
      commits: data.commits ? JSON.stringify(data.commits) : null,
      stages_completed: JSON.stringify([...stagesSet]),
      checkpoints: JSON.stringify(checkpoints),
      llm_calls: data.llm_calls ? JSON.stringify(data.llm_calls) : null,
      config_snapshot: data.config_snapshot ? JSON.stringify(data.config_snapshot) : null,
      budget: data.budget ? JSON.stringify(data.budget) : null,
    });

    console.log(`[sync] Synced session ${sessionId}: status=${data.status}, iterations=${maxIteration}`);
    publishEvent({ type: 'session', projectId, sessionId });
  } catch (err) {
    console.error(`[sync] Error syncing session file ${filePath}:`, err.message);
  }
}

/**
 * Performs a full scan of all existing JSON files.
 */
/**
 * Sync a v2 plan file (with embedded HUs) to SQLite.
 * Plans are the authoritative source — replaces hu-stories for plan-based runs.
 */
export function syncPlanFile(filePath) {
  try {
    const raw = readFileSync(filePath, 'utf-8');
    const data = JSON.parse(raw);
    // KJC-BUG-0124 (issue #1277): a strict `version !== 2` silently hid
    // every plan whose version drifted — the board showed 0 stories with no
    // trace, and users concluded their work was lost. Tolerant now: any
    // v2+ plan syncs, with a LOUD warn on version drift (fired before the
    // empty check so drift is visible even on empty plans). Pre-v2 plans
    // keep their historical silent skip (they never synced and carry no
    // hus[]), and an empty v2 plan has nothing to sync — skipping it
    // loses nothing.
    if (typeof data.version !== 'number' || data.version < 2) return;
    if (data.version > 2) {
      console.warn(`[sync] ${filePath}: plan version ${data.version} (expected 2) — syncing anyway; re-save with current kj to normalize`);
    }
    if (!Array.isArray(data.hus) || data.hus.length === 0) return;

    // Bug fix: pre-patch, `projectId = data.planId` — every plan was a separate
    // "project" on the board, so 2 464 plans across the same repo produced
    // 2 464 boxes in the UI instead of one. Now we derive the project from
    // the stamped `projectDir` so every plan for the same source tree groups
    // under a single board entry. Legacy plans without `projectDir` still
    // fall back to `planId` (conservative — they at least continue to show
    // up, just each on its own card).
    // KJC-BUG-0160: la identidad es el ROOT del repo — un plan creado desde
    // un worktree/carril agrupa bajo el mismo proyecto que el árbol principal.
    const canonicalDir = data.projectDir ? canonicalProjectDir(data.projectDir) : null;
    const projectId = canonicalDir ? deriveProjectIdFromDir(canonicalDir) : data.planId;

    if (skipIfTombstoned('plan', data.planId, filePath)) return;
    // KJC-BUG-0055 (supersedes KJC-BUG-0050): gating por timestamp.
    // El "fix" anterior quitaba el tombstone del proyecto en CUALQUIER
    // llegada de plan — eso resucitaba proyectos borrados cuando un plan
    // anterior reaparecía (DB nueva + plan-files viejos en disco) o
    // cuando un fullScan posterior los re-encontraba. Comportamiento:
    //   • plan.updatedAt/createdAt > tombstone.deleted_at → el usuario
    //     ha generado el plan DESPUÉS de borrar el proyecto → revivir.
    //   • plan.updatedAt/createdAt <= tombstone.deleted_at → plan stale
    //     pre-existente al borrado → respetar el tombstone y borrar el
    //     fichero en disco para que no vuelva a re-importarse.
    const projectTomb = getTombstone('project', projectId);
    if (projectTomb) {
      const planTime = data.updatedAt || data.createdAt || null;
      const planTs = planTime ? Date.parse(planTime) : NaN;
      const tombTs = Date.parse(projectTomb.deleted_at);
      if (Number.isFinite(planTs) && planTs > tombTs) {
        console.log(`[sync] Project ${projectId} resucitado: plan ${data.planId} es más reciente (${planTime}) que el tombstone (${projectTomb.deleted_at}).`);
        removeTombstone('project', projectId);
      } else {
        console.log(`[sync] Plan ${data.planId} ignorado: proyecto ${projectId} tombstoned (${projectTomb.deleted_at}); borrando ${filePath}.`);
        try { rmSync(filePath, { force: true }); } catch { /* best effort */ }
        return;
      }
    }
    // Human-friendly project name resolution order (most-specific first):
    //   1. plan.name explicitly set by the user / planner ("Linux Assistant
    //      Orchestrator" — preserved across renames done from the board).
    //   2. titleCaseBasename(projectDir) — derived from the cwd of the
    //      original kj plan invocation. NOTE: this is the SUBCARPETA of the
    //      projectDir, NOT necessarily where the work happens. If the user
    //      ran `kj plan` from inside `…/karajan-code/packages/hu-board/`
    //      with a SPEC about "Linux Assistant", the basename here would
    //      misleadingly say "Hu Board" — that's why plan.name wins.
    //   3. slugToTitle of the task / projectId as a last resort.
    const projectName = data.name
      || (canonicalDir ? titleCaseBasename(basename(canonicalDir)) : null)
      || slugToTitle(data.task || '')
      || projectId;

    // KJC-PRP-0002 PR3: stamp `is_shared` from the path (authoritative — works
    // even for legacy plan files without the `shared:true` envelope marker).
    // OR with existing value so a single shared plan promotes the project,
    // while unsharing the LAST shared plan still leaves the flag set (we
    // clear it lazily only when the user explicitly tombstones / re-creates).
    upsertProject({
      id: projectId,
      name: projectName,
      last_activity: data.updatedAt || data.createdAt || new Date().toISOString(),
      total_stories: data.hus.length,
      is_shared: isSharedPath(filePath) || data.shared === true ? 1 : undefined,
    });

    for (let i = 0; i < data.hus.length; i += 1) {
      const hu = data.hus[i];
      const acList = Array.isArray(hu.acceptance_criteria) ? hu.acceptance_criteria : [];
      // Only count tests that carry real content. `kj plan` stamps a
      // placeholder like `["npx vitest run ..."]` on every HU — those
      // DO count as 1 test each. But empty strings / null entries
      // (which show up in half-baked plans) must not inflate the
      // badge to "🧪 1 test" on a HU that effectively has none.
      // Drop empty entries but accept BOTH legacy shapes and the
      // v2.7.5 structured form. The original anti-junk filter only
      // knew the legacy shape (`name|title|description|given|gherkin|
      // scope`) and silently nuked every test produced by the
      // tests-synthesizer (which emits `{type, content, file?}`),
      // leaving every HU flagged "missing test contract" on the
      // board even though the plan JSON had 4 tests apiece.
      const testList = (Array.isArray(hu.acceptance_tests) ? hu.acceptance_tests : [])
        .filter((t) => {
          if (!t) return false;
          if (typeof t === 'string') return t.trim().length > 0;
          if (typeof t !== 'object') return false;
          // v2.7.5 structured form — primary shape going forward.
          if (typeof t.content === 'string' && t.content.trim().length > 0) return true;
          // Legacy shapes kept for back-compat with hand-edited plans.
          return Boolean(t.name || t.title || t.description || t.given || t.gherkin || t.scope);
        });
      const blockedByList = Array.isArray(hu.blocked_by) ? hu.blocked_by : [];
      const acText = acList.length > 0 ? JSON.stringify(acList) : null;

      upsertStory({
        id: `${projectId}::${hu.id}`,
        project_id: projectId,
        session_id: projectId,
        status: hu.status || 'pending',
        title: hu.title || hu.id,
        original_text: hu.scope || null,
        certified_as: null,
        certified_want: hu.scope || null,
        certified_so_that: null,
        quality_total: null,
        quality_d1: null, quality_d2: null, quality_d3: null,
        quality_d4: null, quality_d5: null, quality_d6: null,
        antipatterns: null,
        ac_format: acText ? 'list' : null,
        acceptance_criteria: acText,
        created_at: hu.createdAt,
        updated_at: hu.updatedAt,
        certified_at: null,
        // Stamp plan_id so the PATCH / mark-ready endpoints can locate
        // the source plan JSON without walking the plans dir.
        plan_id: data.planId,
        // Denormalised counters + deps so the card renders "3 ACs ·
        // 2 tests · waits for lao-001" without every client parsing JSON.
        ac_count: acList.length,
        test_count: testList.length,
        blocked_by: blockedByList.length > 0 ? JSON.stringify(blockedByList) : null,
        // Full test list goes to SQLite too so the modal can show
        // "🧪 2 tests" next to the list. Pre-patch the card showed
        // test_count but the modal had nothing to render.
        acceptance_tests: testList.length > 0 ? JSON.stringify(testList) : null,
        // Index in plan.hus[] — used by getStoriesByProject to order
        // cards topologically (roots first, dependents last).
        plan_order: i,
        // Spec mapping (PR C): "implements §5.3" trace pointer.
        spec_section: typeof hu.spec_section === 'string' && hu.spec_section.trim() ? hu.spec_section.trim() : null,
        // PR3: per-HU outcome (iterations, duration, commits,
        // blockers, summary). Stored as a JSON string in SQLite —
        // the front parses on read. Null until hu-sub-pipeline
        // stamps it at the end of each HU.
        outcome: hu.outcome ? JSON.stringify(hu.outcome) : null,
        // KJC-TSK-0394: result (pass|fail|partial|null) ortogonal al status.
        // Distinto de `outcome` (blob JSON) — esto es el enum corto para
        // badge ✓/✗ en la card.
        result: hu.result || null,
        // KJC-TSK-0406: coder_model y reviewer_model por HU. Reflejan
        // qué modelo se va a usar (o se usó) en este HU. El modal del
        // board los muestra y permite cambiarlos antes de run.
        coder_model: hu.coder_model || null,
        reviewer_model: hu.reviewer_model || null,
        coder_provider: hu.coder_provider || null,
        reviewer_provider: hu.reviewer_provider || null,
        // KJC-PRP-0002 PR6: optional handle of the owner of this HU
        // (free-form string). Only surfaced in UI when project is_shared,
        // but stored unconditionally so values survive share/unshare flips.
        assignee: typeof hu.assignee === 'string' && hu.assignee.trim() ? hu.assignee.trim() : null,
      });
    }

    console.log(`[sync] Plan ${projectId}: ${data.hus.length} HUs (${projectName})`);
    publishEvent({ type: 'plan', projectId, planId: data.planId });
  } catch (err) {
    console.error(`[sync] Failed to sync plan ${filePath}: ${err.message}`);
  }
}

export function fullScan() {
  const kjHome = getKjHome();
  const storiesDir = join(kjHome, 'hu-stories');
  const sessionsDir = join(kjHome, 'sessions');

  // Clear existing data for a clean rebuild
  const db = getDb();
  db.exec('DELETE FROM context_requests');
  db.exec('DELETE FROM stories');
  db.exec('DELETE FROM sessions');
  db.exec('DELETE FROM projects');

  // KJC-BUG-0055: garbage-collect on-disk story/session artefacts whose
  // ids carry an active tombstone. Without this, a tombstone is useless
  // against a stray ~/.karajan/hu-stories/<id>/ that survived a manual
  // DB wipe — the next pass would re-import it as a ghost project.
  // (Plan dirs are NOT pre-purged here: a tombstoned project may hold a
  // newer plan from a legit projectDir re-use; `syncPlanFile`'s
  // timestamp gate decides per-file.)
  for (const [type, root] of [['story', storiesDir], ['session', sessionsDir]]) {
    if (!existsSync(root)) continue;
    for (const name of readdirSync(root)) {
      if (!isTombstoned(type, name)) continue;
      try { rmSync(join(root, name), { recursive: true, force: true }); } catch { /* best effort */ }
    }
  }

  // Scan stories
  if (existsSync(storiesDir)) {
    const dirs = readdirSync(storiesDir);
    for (const dir of dirs) {
      const batchPath = join(storiesDir, dir, 'batch.json');
      if (existsSync(batchPath)) {
        syncStoryFile(batchPath);
      }
    }
  }

  // Scan sessions
  if (existsSync(sessionsDir)) {
    const dirs = readdirSync(sessionsDir);
    for (const dir of dirs) {
      const sessionPath = join(sessionsDir, dir, 'session.json');
      if (existsSync(sessionPath)) {
        syncSessionFile(sessionPath);
      }
    }
  }

  // KJC-PRP-0002 PR5: order plans scans by conflict policy. `syncPlanFile`
  // upserts by planId, so whichever pass runs LAST wins. Default
  // shared-wins matches what teams expect (the committed copy is canonical);
  // local-wins is the escape hatch for a solo dev still iterating before
  // publishing. Same projectDir scan, only the order changes.
  const scanPerUserPlans = () => {
    const kjDir = process.env.KJ_PLANS_DIR || join(homedir(), '.karajan', 'plans');
    const legacyKjDir = process.env.KJ_PLANS_DIR ? null : join(homedir(), '.kj', 'plans');
    for (const root of [kjDir, legacyKjDir]) {
      if (!root || !existsSync(root)) continue;
      const projectDirs = readdirSync(root);
      for (const projDir of projectDirs) {
        const projPath = join(root, projDir);
        try {
          const files = readdirSync(projPath);
          for (const file of files) {
            if (file.startsWith('plan-') && file.endsWith('.json')) {
              syncPlanFile(join(projPath, file));
            }
          }
        } catch { /* skip */ }
      }
    }
  };

  if (getSharedConflictPolicy() === 'local-wins') {
    scanSharedPlans();
    scanPerUserPlans();
  } else {
    scanPerUserPlans();
    scanSharedPlans();
  }

  console.log('[sync] Full scan completed');
}

/**
 * Scans `<projectDir>/.karajan-shared/plans/` for every known projectDir
 * and feeds each plan into `syncPlanFile`. Discovery sources:
 *   1. `process.cwd()` — covers the canonical case of running `kj board start`
 *      from a project root with a freshly cloned `.karajan-shared/` and zero
 *      local plans yet.
 *   2. `KJ_SHARED_PROJECT_DIRS` env var (colon-separated paths) — escape
 *      hatch for users running the board outside the project root or
 *      tracking several repos with one board instance.
 */
function scanSharedPlans() {
  const dirs = new Set([process.cwd()]);
  const extra = process.env.KJ_SHARED_PROJECT_DIRS;
  if (extra) {
    for (const p of extra.split(':')) if (p) dirs.add(p);
  }
  for (const projectDir of dirs) {
    const sharedDir = getSharedPlansDir(projectDir);
    if (!existsSync(sharedDir)) continue;
    try {
      const files = readdirSync(sharedDir);
      for (const file of files) {
        if (file.startsWith('plan-') && file.endsWith('.json')) {
          syncPlanFile(join(sharedDir, file));
        }
      }
    } catch { /* skip */ }
  }
}

/**
 * Starts the file watcher for live sync.
 * @returns {import('chokidar').FSWatcher}
 */
export function startWatcher() {
  const kjHome = getKjHome();
  const storiesGlob = join(kjHome, 'hu-stories', '*', 'batch.json');
  const sessionsGlob = join(kjHome, 'sessions', '*', 'session.json');
  const promptsGlob = join(kjHome, 'prompts', '*.json');
  // Plans live under KJ_PLANS_DIR or `~/.karajan/plans/` after
  // KJC-PCS-0047 PR 3 consolidated the home directories. Without this
  // glob, HU statuses flipped to coding/done by `kj run --plan` never
  // reach the board until the user clicks 🔄 manually. The legacy
  // `~/.kj/plans/` root is also watched so users running the board
  // before their first post-upgrade `kj` command (the trigger of the
  // auto-migrator) keep seeing live updates.
  const plansRoot = process.env.KJ_PLANS_DIR || join(homedir(), '.karajan', 'plans');
  const legacyPlansRoot = process.env.KJ_PLANS_DIR ? null : join(homedir(), '.kj', 'plans');
  const plansGlob = join(plansRoot, '*', 'plan-*.json');
  const legacyPlansGlob = legacyPlansRoot ? join(legacyPlansRoot, '*', 'plan-*.json') : null;

  const watchTargets = [storiesGlob, sessionsGlob, plansGlob, promptsGlob];
  if (legacyPlansGlob) watchTargets.push(legacyPlansGlob);
  // KJC-PRP-0002 PR2: live-watch shared plans for the board's cwd + any
  // dir listed in KJ_SHARED_PROJECT_DIRS. Without this, `kj plan share`
  // updates would only land via the next fullScan / manual 🔄.
  const sharedDirs = new Set([process.cwd()]);
  const extraShared = process.env.KJ_SHARED_PROJECT_DIRS;
  if (extraShared) {
    for (const p of extraShared.split(':')) if (p) sharedDirs.add(p);
  }
  for (const d of sharedDirs) {
    watchTargets.push(join(d, SHARED_DIR_NAME, 'plans', 'plan-*.json'));
  }
  const watcher = watch(watchTargets, {
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 500, pollInterval: 100 },
  });

  const syncByPath = (p, eventName) => {
    if (p.includes('hu-stories')) syncStoryFile(p);
    else if (p.includes('sessions')) syncSessionFile(p);
    else if (p.includes(`${plansRoot}${plansRoot.endsWith('/') ? '' : '/'}`) || p.includes('/plans/')) {
      // Catches both per-user `~/.karajan/plans/<slug>/plan-*.json` and
      // team-shared `<projectDir>/.karajan-shared/plans/plan-*.json` — the
      // path-segment match `/plans/` is the same for both.
      syncPlanFile(p);
    } else if (p.includes('/prompts/')) {
      // Prompt files are RPC packets the runner writes when it needs
      // an answer (Solomon escalation, etc.) — see board-prompt-bridge.js.
      // The board's API exposes a /api/prompts list; here we just emit
      // a bus event so connected SSE clients pop the modal immediately
      // instead of waiting on the next render cycle.
      if (p.endsWith('.answer.json')) return;     // ignore our own writes
      try {
        const raw = readFileSync(p, 'utf-8');
        const data = JSON.parse(raw);
        publishEvent({ type: 'prompt', event: eventName, promptId: data.promptId, sessionId: data.sessionId, question: data.question });
      } catch { /* malformed prompt file — ignore */ }
    }
  };

  watcher.on('add', (p) => {
    console.log(`[watcher] New file: ${p}`);
    syncByPath(p, 'add');
  });

  watcher.on('change', (p) => {
    console.log(`[watcher] Changed: ${p}`);
    syncByPath(p, 'change');
  });

  // The runner deletes prompt files once the answer arrives. Surface
  // those deletions as `prompt:resolved` events so already-open modals
  // can close themselves without polling.
  watcher.on('unlink', (p) => {
    if (p.includes('/prompts/') && p.endsWith('.json') && !p.endsWith('.answer.json')) {
      const m = /([^/]+)\.json$/.exec(p);
      if (m) publishEvent({ type: 'prompt-resolved', promptId: m[1] });
    }
  });

  console.log(`[watcher] Watching ${kjHome} + ${plansRoot} for changes`);
  return watcher;
}
