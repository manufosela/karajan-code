import Database from 'better-sqlite3';
import { join, dirname } from 'node:path';
import { mkdirSync, renameSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

/** @type {import('better-sqlite3').Database | null} */
let db = null;

// Per-process tmp dir for VITEST runs that forget to set KJ_HOME.
// Without this, a test that touches initDb() / upsertProject() drops
// rows into the developer's real `~/.karajan/hu-board.db` and the
// running board UI shows phantom projects (observed: "sess-1",
// "default", "Karajan Code" with 49 test fixture plans). Memoise so
// every consumer in the same process agrees on the path. The
// trailing `.karajan` segment keeps semantic parity with non-VITEST
// defaults so any caller assuming the path ends in `.karajan` still
// works.
let _vitestKjHome = null;
function vitestTmpKjHome() {
  if (_vitestKjHome) return _vitestKjHome;
  _vitestKjHome = join(
    tmpdir(),
    `karajan-vitest-${process.pid}-${Math.random().toString(36).slice(2, 10)}`,
    '.karajan'
  );
  // KJC-BUG-0075: clean up on clean exit so /tmp doesn't accumulate one
  // dir per fork × run. We rm the *parent* (the `karajan-vitest-<pid>-<rand>`
  // wrapper), not the `.karajan` segment, so the whole tmp tree goes.
  // Only fires on graceful exit; SIGKILL leaks are caught by the
  // global-setup mtime purge at the start of the next run.
  const parent = dirname(_vitestKjHome);
  process.on('exit', () => {
    try {
      rmSync(parent, { recursive: true, force: true });
    } catch {
      // best-effort: never crash a test process on cleanup failure
    }
  });
  return _vitestKjHome;
}

/**
 * Returns the KJ home directory, respecting KJ_HOME env var.
 * Under VITEST without KJ_HOME, returns a per-process tmp dir to
 * prevent accidental writes into the developer's real `~/.karajan/`.
 * @returns {string}
 */
export function getKjHome() {
  // KJC-TSK-0420: same precedence chain as src/utils/paths.js::resolveHome():
  // KARAJAN_HOME (canonical) > KJ_HOME (legacy) > VITEST tmp > ~/.karajan.
  // Kept inline rather than cross-workspace imported so the hu-board package
  // does not gain a new src/ dep; the precedence behaviour is the same.
  if (process.env.KARAJAN_HOME) return process.env.KARAJAN_HOME;
  if (process.env.KJ_HOME) return process.env.KJ_HOME;
  if (process.env.VITEST) return vitestTmpKjHome();
  return join(process.env.HOME || '/root', '.karajan');
}

/**
 * Canonical path to the HU Board's run-logs directory
 * (`<karajan-home>/hu-board-runs/`). Centralised here so the four
 * board callers (plan-mutations, command-runner, api.js GET routes
 * for plan + commandId logs) and the garbage-collector all agree on
 * the same string — KJC-TSK-0421.
 *
 * @returns {string}
 */
export function getHuBoardRunsDir() {
  return join(getKjHome(), 'hu-board-runs');
}

/**
 * Canonical path to the plans directory the board scans
 * (`<karajan-home>/plans/`). Respects `KJ_PLANS_DIR` as an absolute
 * override, mirroring sync.js. KJC-BUG-0059 (v2.19.3): preflight
 * endpoint used a hard-coded `~/.kj/plans/` legacy fallback that
 * survived the v2.19.0 consolidation, causing the board to report
 * "directorio del proyecto: no detectado" even when the plan on disk
 * had a valid `projectDir`.
 *
 * @returns {string}
 */
export function getHuBoardPlansDir() {
  return process.env.KJ_PLANS_DIR || join(getKjHome(), 'plans');
}

/**
 * Legacy `~/.kj/plans/` directory — only returned when KJ_PLANS_DIR
 * is unset (it would be the same path anyway when overridden).
 * Callers iterate canonical + legacy so users who have not yet run
 * the v2.19.0 auto-migrator still see their plans. KJC-BUG-0059.
 *
 * @returns {string|null}
 */
export function getHuBoardLegacyPlansDir() {
  if (process.env.KJ_PLANS_DIR) return null;
  return join(process.env.HOME || '/root', '.kj', 'plans');
}

/**
 * Ordered list of every plans root the board should scan: canonical
 * first (`~/.karajan/plans/`), legacy second when applicable
 * (`~/.kj/plans/`). Honours `KJ_PLANS_DIR` as a single override,
 * matching `sync.js`'s fullScan / startWatcher precedence so the
 * preflight, plans-outcome, delete-project and delete-plan endpoints
 * see the same set of files the watcher sees. KJC-BUG-0059.
 *
 * @returns {string[]}
 */
export function getHuBoardPlansDirs() {
  const dirs = [getHuBoardPlansDir()];
  const legacy = getHuBoardLegacyPlansDir();
  if (legacy) dirs.push(legacy);
  return dirs;
}

// Bump when the schema gains a column / index / table that older
// Karajan versions cannot understand. A DB written by a newer Karajan
// refuses to open here so it does not get silently downgraded.
const SCHEMA_VERSION = 1;

/**
 * Tries to open the SQLite database; if it is corrupt, moves it aside
 * and opens a fresh one. `fullScan` afterwards rebuilds the cache from
 * the JSON files on disk — the DB is a cache, never the source of
 * truth. Without this the board crashed at startup with a raw
 * `SqliteError: database disk image is malformed` whenever the WAL
 * checkpoint died in the wrong place.
 *
 * @param {string} dbPath
 * @returns {import('better-sqlite3').Database}
 */
function openDbResilient(dbPath) {
  try {
    const handle = new Database(dbPath);
    // better-sqlite3 opens lazily — the first pragma is what actually
    // touches the file and surfaces "file is not a database". Probe
    // `schema_version` (a built-in SQLite pragma) to force it.
    handle.pragma("schema_version", { simple: true });
    return handle;
  } catch (err) {
    const code = err?.code || "";
    const msg = err?.message || "";
    if (code === "SQLITE_CORRUPT" || code === "SQLITE_NOTADB" || /malformed|not a database/i.test(msg)) {
      const aside = `${dbPath}.corrupt-${Date.now()}`;
      try { renameSync(dbPath, aside); } catch { /* may already be gone */ }
      // eslint-disable-next-line no-console
      console.warn(`[hu-board] DB at ${dbPath} was corrupt; moved aside to ${aside}. Rebuilding from disk via fullScan.`);
      return new Database(dbPath);
    }
    throw err;
  }
}

/**
 * Initializes the SQLite database and creates tables if they don't exist.
 * @returns {import('better-sqlite3').Database}
 */
export function initDb() {
  const kjHome = getKjHome();
  mkdirSync(kjHome, { recursive: true });

  const dbPath = join(kjHome, 'hu-board.db');
  db = openDbResilient(dbPath);

  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  // Wait up to 5s for a competing writer (e.g. concurrent fullScan +
  // mutation) before giving up. Without this any contention surfaced
  // as SQLITE_BUSY and crashed the request mid-flight.
  db.pragma('busy_timeout = 5000');

  // Schema-version guard. If the DB was written by a newer Karajan with
  // a different schema, refuse to open instead of silently mis-binding
  // named parameters against a renamed column.
  const onDisk = db.pragma('user_version', { simple: true });
  if (onDisk > SCHEMA_VERSION) {
    throw new Error(
      `[hu-board] DB schema is from a newer Karajan (user_version=${onDisk}, this build expects ${SCHEMA_VERSION}). `
      + `Upgrade karajan-code or remove ${dbPath} (it will be rebuilt from disk).`
    );
  }
  if (onDisk < SCHEMA_VERSION) {
    db.pragma(`user_version = ${SCHEMA_VERSION}`);
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT,
      first_seen TEXT,
      last_activity TEXT,
      total_stories INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS stories (
      id TEXT PRIMARY KEY,
      project_id TEXT,
      session_id TEXT,
      status TEXT DEFAULT 'pending',
      title TEXT,
      original_text TEXT,
      certified_as TEXT,
      certified_want TEXT,
      certified_so_that TEXT,
      quality_total INTEGER,
      quality_d1 INTEGER,
      quality_d2 INTEGER,
      quality_d3 INTEGER,
      quality_d4 INTEGER,
      quality_d5 INTEGER,
      quality_d6 INTEGER,
      antipatterns TEXT,
      ac_format TEXT,
      acceptance_criteria TEXT,
      created_at TEXT,
      updated_at TEXT,
      certified_at TEXT
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      project_id TEXT,
      task TEXT,
      status TEXT,
      created_at TEXT,
      updated_at TEXT,
      iterations INTEGER DEFAULT 0,
      duration_ms INTEGER,
      approved INTEGER DEFAULT 0,
      commits TEXT,
      stages_completed TEXT,
      checkpoints TEXT,
      llm_calls TEXT,
      config_snapshot TEXT,
      budget TEXT
    );

    CREATE TABLE IF NOT EXISTS context_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      story_id TEXT,
      fields_needed TEXT,
      question TEXT,
      answer TEXT,
      requested_at TEXT,
      answered_at TEXT
    );

    -- KJC-TSK-0380 — Tombstones: "deleted, do not resurrect".
    -- The board's data is reconstructed from the filesystem on every
    -- fullScan(), so a plain DELETE from the table is silently undone
    -- the next time chokidar fires. The tombstone table holds the ids
    -- the user explicitly killed; sync* functions check it before any
    -- upsert and skip + clean fs paths.
    CREATE TABLE IF NOT EXISTS tombstones (
      resource_type TEXT NOT NULL,
      resource_id   TEXT NOT NULL,
      deleted_at    TEXT NOT NULL,
      source        TEXT NOT NULL,
      fs_paths      TEXT,
      PRIMARY KEY (resource_type, resource_id)
    );

    CREATE INDEX IF NOT EXISTS idx_stories_project ON stories(project_id);
    CREATE INDEX IF NOT EXISTS idx_stories_status ON stories(status);
    CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project_id);
    CREATE INDEX IF NOT EXISTS idx_context_story ON context_requests(story_id);
    CREATE INDEX IF NOT EXISTS idx_tombstones_deleted_at ON tombstones(deleted_at);
  `);

  // --- Migrations ---
  // Each ALTER is idempotent on restart — we swallow the duplicate-column
  // error so adding one over time doesn't force a board DB nuke.
  //
  // plan_id:       lets the mutation endpoints locate the source-of-truth plan
  //                JSON at ~/.karajan/plans/<slug>/<planId>.json without a scan.
  // ac_count:      number of acceptance criteria, surfaced on the card.
  // test_count:    number of acceptance_tests, surfaced on the card.
  // blocked_by:    denormalised JSON array of HU ids this story waits on,
  //                so the card can render `⏳ waits for: lao-001` inline.
  try { db.exec('ALTER TABLE stories ADD COLUMN plan_id TEXT'); } catch { /* already migrated */ }
  try { db.exec('ALTER TABLE stories ADD COLUMN ac_count INTEGER'); } catch { /* already migrated */ }
  try { db.exec('ALTER TABLE stories ADD COLUMN test_count INTEGER'); } catch { /* already migrated */ }
  try { db.exec('ALTER TABLE stories ADD COLUMN blocked_by TEXT'); } catch { /* already migrated */ }
  // acceptance_tests is the raw JSON of `hu.acceptance_tests` — the
  // plan stores each test as either a plain string or an object with
  // { name, description, given/when/then, ... }. The modal renders
  // the list; the card just shows the count (test_count above).
  try { db.exec('ALTER TABLE stories ADD COLUMN acceptance_tests TEXT'); } catch { /* already migrated */ }
  // plan_order is the index of the HU in `plan.hus[]` as the planner
  // emitted it. The planner's output is already topological (it calls
  // addHu with `blocked_by: [prevId]`), so sorting the board by this
  // column puts roots first and dependents last — matching what
  // `kj run --plan` will actually execute.
  try { db.exec('ALTER TABLE stories ADD COLUMN plan_order INTEGER'); } catch { /* already migrated */ }
  // spec_section (v2.7.5 PR C): the SPEC.md heading this HU
  // implements (e.g. "5.3" or "§5 Initial Scope"). Surfaces in the
  // card + modal so the user can trace HU → spec coverage.
  try { db.exec('ALTER TABLE stories ADD COLUMN spec_section TEXT'); } catch { /* already migrated */ }
  // outcome (PR3): JSON blob with what actually happened during
  // execution — iterations, duration, commits, branch, blockers,
  // human summary. Stamped by hu-sub-pipeline at the end of each
  // HU and ingested by syncPlanFile so the board can show the 📄
  // indicator and detail modal without parsing the plan JSON
  // again. Stored as TEXT (JSON.stringify'd) for simplicity —
  // parsed on read by the UI.
  try { db.exec('ALTER TABLE stories ADD COLUMN outcome TEXT'); } catch { /* already migrated */ }
  // KJC-TSK-0394: result (pass | fail | partial | null) ortogonal al status.
  // Diferente del campo `outcome` arriba (que es blob JSON con metadata del
  // run). result es el enum de "último resultado" para mostrar como badge.
  try { db.exec('ALTER TABLE stories ADD COLUMN result TEXT'); } catch { /* already migrated */ }
  // KJC-TSK-0406: coder_model y reviewer_model independientes por HU.
  // Asignados por el triage según complexity (KJC-TSK-0405) y override-able
  // desde el modal del board. coder_provider y reviewer_provider permiten
  // cross-provider review (claude↔codex) sin tocar el config global.
  try { db.exec('ALTER TABLE stories ADD COLUMN coder_model TEXT'); } catch { /* already migrated */ }
  try { db.exec('ALTER TABLE stories ADD COLUMN reviewer_model TEXT'); } catch { /* already migrated */ }
  try { db.exec('ALTER TABLE stories ADD COLUMN coder_provider TEXT'); } catch { /* already migrated */ }
  try { db.exec('ALTER TABLE stories ADD COLUMN reviewer_provider TEXT'); } catch { /* already migrated */ }
  // KJC-PRP-0002 PR6: free-form handle of the human (or dev_XXX AI) who
  // owns this HU on a team-shared board. NULL = unassigned. Only surfaced
  // in the UI when the parent project is `is_shared = 1`, but stored
  // unconditionally so solo devs who later promote a plan don't lose
  // values they typed pre-share.
  try { db.exec('ALTER TABLE stories ADD COLUMN assignee TEXT'); } catch { /* already migrated */ }
  // KJC-TSK-0514 (Cost C): persisted USD cost of running this HU. NULL
  // until the orchestrator (Cost D) calls setStoryCost on HU close. UI
  // renders "—" while NULL. Stored as REAL so the SQL aggregations in
  // Cost E (/api/projects/:id/cost) can SUM directly without parsing.
  try { db.exec('ALTER TABLE stories ADD COLUMN cost_usd REAL'); } catch { /* already migrated */ }
  // KJC-TSK-0525 (Φ0-G): persisted cached/input tokens per HU so the
  // board can render the "🎯 N% cached" badge without re-parsing the
  // session summary. NULL = unmeasured (older runs, cold runs without
  // cache support). INTEGER because providers report token counts as
  // ints. Ratio is computed at read time as cached_tokens / tokens_in.
  try { db.exec('ALTER TABLE stories ADD COLUMN cached_tokens INTEGER'); } catch { /* already migrated */ }
  try { db.exec('ALTER TABLE stories ADD COLUMN tokens_in INTEGER'); } catch { /* already migrated */ }
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_stories_plan ON stories(plan_id)'); } catch { /* ignore */ }

  // is_test (KJC-TSK-0371 — board polish #3): per-project flag that
  // controls the ephemeral-cleanup heuristic. NULL = follow heuristic
  // (id under tmp_/test_/demo_/kj-test- → ephemeral after 24h);
  // 1 = always treat as ephemeral; 0 = NEVER auto-clean (user override).
  // The UI surfaces this as a toggle on each project card.
  try { db.exec('ALTER TABLE projects ADD COLUMN is_test INTEGER'); } catch { /* already migrated */ }

  // is_shared (KJC-PRP-0002 PR3): 1 when at least one plan of the project came
  // from `<projectDir>/.karajan-shared/plans/`. Surfaced as a 🔗 badge on the
  // board so the user can tell at a glance which projects are team-tracked.
  try { db.exec('ALTER TABLE projects ADD COLUMN is_shared INTEGER'); } catch { /* already migrated */ }

  return db;
}

/**
 * Returns the current database instance.
 * @returns {import('better-sqlite3').Database}
 */
export function getDb() {
  if (!db) throw new Error('Database not initialized. Call initDb() first.');
  return db;
}

/**
 * Lazily initialise the DB if it isn't open yet (KJC-BUG-0090). The cost
 * writers run from `kj run`/`kj autorun` paths that may never start the board
 * (which is what normally calls initDb), so cost writes failed with
 * "Database not initialized". This makes those writers self-sufficient.
 */
export function ensureDb() {
  if (!db) initDb();
  return db;
}

/**
 * Inserts or updates a project record.
 * @param {{ id: string, name?: string, first_seen?: string, last_activity?: string, total_stories?: number }} project
 */
export function upsertProject(project) {
  // KJC-BUG-0163 — the iron rule: a project NAME is unique on the dashboard.
  // Two projects with the same visible name are indistinguishable in the
  // picker; registering the second fails LOUD instead of blending in.
  if (project.name) {
    const clash = getDb()
      .prepare('SELECT id FROM projects WHERE name = ? AND id != ?')
      .get(project.name, project.id);
    if (clash) {
      throw new Error(
        `board: el nombre "${project.name}" ya pertenece al proyecto "${clash.id}" — dos proyectos no pueden llamarse igual (KJC-BUG-0163); renombra el plan o el directorio de "${project.id}"`,
      );
    }
  }
  // is_shared (KJC-PRP-0002 PR3) is set by sync when a plan came from
  // `.karajan-shared/`. COALESCE with the existing column keeps the badge
  // once it's been promoted — a second non-shared plan won't unset it.
  const stmt = getDb().prepare(`
    INSERT INTO projects (id, name, first_seen, last_activity, total_stories, is_shared)
    VALUES (@id, @name, @first_seen, @last_activity, @total_stories, @is_shared)
    ON CONFLICT(id) DO UPDATE SET
      name = COALESCE(@name, name),
      last_activity = COALESCE(@last_activity, last_activity),
      total_stories = COALESCE(@total_stories, total_stories),
      is_shared = COALESCE(@is_shared, is_shared)
  `);
  stmt.run({
    id: project.id,
    name: project.name || project.id,
    first_seen: project.first_seen || new Date().toISOString(),
    last_activity: project.last_activity || new Date().toISOString(),
    total_stories: project.total_stories || 0,
    is_shared: project.is_shared ?? null,
  });
}

/**
 * Inserts or updates a story record.
 * @param {object} story
 */
export function upsertStory(story) {
  const stmt = getDb().prepare(`
    INSERT INTO stories (
      id, project_id, session_id, status, title, original_text,
      certified_as, certified_want, certified_so_that,
      quality_total, quality_d1, quality_d2, quality_d3, quality_d4, quality_d5, quality_d6,
      antipatterns, ac_format, acceptance_criteria,
      created_at, updated_at, certified_at, plan_id,
      ac_count, test_count, blocked_by, acceptance_tests, plan_order, spec_section, outcome, result,
      coder_model, reviewer_model, coder_provider, reviewer_provider, assignee
    ) VALUES (
      @id, @project_id, @session_id, @status, @title, @original_text,
      @certified_as, @certified_want, @certified_so_that,
      @quality_total, @quality_d1, @quality_d2, @quality_d3, @quality_d4, @quality_d5, @quality_d6,
      @antipatterns, @ac_format, @acceptance_criteria,
      @created_at, @updated_at, @certified_at, @plan_id,
      @ac_count, @test_count, @blocked_by, @acceptance_tests, @plan_order, @spec_section, @outcome, @result,
      @coder_model, @reviewer_model, @coder_provider, @reviewer_provider, @assignee
    )
    ON CONFLICT(id) DO UPDATE SET
      status = @status,
      title = COALESCE(@title, title),
      original_text = COALESCE(@original_text, original_text),
      certified_as = COALESCE(@certified_as, certified_as),
      certified_want = COALESCE(@certified_want, certified_want),
      certified_so_that = COALESCE(@certified_so_that, certified_so_that),
      quality_total = COALESCE(@quality_total, quality_total),
      quality_d1 = COALESCE(@quality_d1, quality_d1),
      quality_d2 = COALESCE(@quality_d2, quality_d2),
      quality_d3 = COALESCE(@quality_d3, quality_d3),
      quality_d4 = COALESCE(@quality_d4, quality_d4),
      quality_d5 = COALESCE(@quality_d5, quality_d5),
      quality_d6 = COALESCE(@quality_d6, quality_d6),
      antipatterns = COALESCE(@antipatterns, antipatterns),
      ac_format = COALESCE(@ac_format, ac_format),
      acceptance_criteria = COALESCE(@acceptance_criteria, acceptance_criteria),
      updated_at = @updated_at,
      certified_at = COALESCE(@certified_at, certified_at),
      plan_id = COALESCE(@plan_id, plan_id),
      ac_count = COALESCE(@ac_count, ac_count),
      test_count = COALESCE(@test_count, test_count),
      blocked_by = COALESCE(@blocked_by, blocked_by),
      acceptance_tests = COALESCE(@acceptance_tests, acceptance_tests),
      plan_order = COALESCE(@plan_order, plan_order),
      spec_section = COALESCE(@spec_section, spec_section),
      outcome = COALESCE(@outcome, outcome),
      result = COALESCE(@result, result),
      coder_model = COALESCE(@coder_model, coder_model),
      reviewer_model = COALESCE(@reviewer_model, reviewer_model),
      coder_provider = COALESCE(@coder_provider, coder_provider),
      reviewer_provider = COALESCE(@reviewer_provider, reviewer_provider),
      assignee = COALESCE(@assignee, assignee)
  `);
  stmt.run({
    id: story.id,
    project_id: story.project_id || 'default',
    session_id: story.session_id || null,
    status: story.status || 'pending',
    title: story.title || null,
    original_text: story.original_text || null,
    certified_as: story.certified_as || null,
    certified_want: story.certified_want || null,
    certified_so_that: story.certified_so_that || null,
    quality_total: story.quality_total ?? null,
    quality_d1: story.quality_d1 ?? null,
    quality_d2: story.quality_d2 ?? null,
    quality_d3: story.quality_d3 ?? null,
    quality_d4: story.quality_d4 ?? null,
    quality_d5: story.quality_d5 ?? null,
    quality_d6: story.quality_d6 ?? null,
    antipatterns: story.antipatterns || null,
    ac_format: story.ac_format || null,
    acceptance_criteria: story.acceptance_criteria || null,
    created_at: story.created_at || new Date().toISOString(),
    updated_at: story.updated_at || new Date().toISOString(),
    certified_at: story.certified_at || null,
    plan_id: story.plan_id || null,
    ac_count: story.ac_count ?? null,
    test_count: story.test_count ?? null,
    blocked_by: story.blocked_by || null,
    acceptance_tests: story.acceptance_tests || null,
    plan_order: story.plan_order ?? null,
    spec_section: story.spec_section || null,
    outcome: story.outcome || null,
    result: story.result || null,
    coder_model: story.coder_model || null,
    reviewer_model: story.reviewer_model || null,
    coder_provider: story.coder_provider || null,
    reviewer_provider: story.reviewer_provider || null,
    assignee: story.assignee || null,
  });
}

/**
 * Look up a story row (minimal fields used by the mutation endpoints).
 * @param {string} storyId
 * @returns {{ id: string, project_id: string, plan_id: string|null, status: string }|null}
 */
export function getStoryRow(storyId) {
  const row = getDb()
    .prepare('SELECT id, project_id, plan_id, status FROM stories WHERE id = ?')
    .get(storyId);
  return row || null;
}

/**
 * Update a single story's status (in-memory — the source-of-truth plan
 * JSON is mutated separately by the caller before or after this write).
 * @param {string} storyId
 * @param {string} status
 * @returns {boolean} true if a row was updated
 */
export function updateStoryStatus(storyId, status) {
  const res = getDb()
    .prepare('UPDATE stories SET status = ?, updated_at = ? WHERE id = ?')
    .run(status, new Date().toISOString(), storyId);
  return res.changes > 0;
}

/**
 * Persist the USD cost of a HU. Called by the orchestrator (Cost D) once
 * the HU finishes — the value comes from `aggregateRunCost(events).totalUsd`
 * (Cost B). `null` clears the cell so the UI renders "—" again. Other
 * numeric inputs are coerced via `Number`; non-finite values reject with
 * an explicit throw so callers don't silently NULL-out real cost rows.
 *
 * @param {string} storyId
 * @param {number|null} costUsd
 * @returns {boolean} true when the row existed and was updated
 */
export function setStoryCost(storyId, costUsd) {
  let value = null;
  if (costUsd !== null && costUsd !== undefined) {
    const n = Number(costUsd);
    if (!Number.isFinite(n)) {
      throw new Error(`setStoryCost: costUsd must be a finite number or null (got ${costUsd})`);
    }
    value = n;
  }
  const res = getDb()
    .prepare('UPDATE stories SET cost_usd = ?, updated_at = ? WHERE id = ?')
    .run(value, new Date().toISOString(), storyId);
  return res.changes > 0;
}

/**
 * Persist cached/input tokens for a HU (KJC-TSK-0525, Φ0-G). Called by
 * the orchestrator alongside `setStoryCost` once the HU finishes. Both
 * values come from `BudgetTracker.since(huCursor)` (Φ0-E). Pass `null`
 * to clear either cell. Non-finite numbers throw so callers don't
 * silently null-out real telemetry.
 *
 * @param {string} storyId
 * @param {number|null} cachedTokens
 * @param {number|null} tokensIn
 * @returns {boolean} true when the row existed and was updated
 */
export function setStoryCachedTokens(storyId, cachedTokens, tokensIn) {
  const coerce = (v, name) => {
    if (v === null || v === undefined) return null;
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0) {
      throw new Error(`setStoryCachedTokens: ${name} must be a non-negative finite number or null (got ${v})`);
    }
    return Math.round(n);
  };
  const cached = coerce(cachedTokens, 'cachedTokens');
  const tin = coerce(tokensIn, 'tokensIn');
  const res = getDb()
    .prepare('UPDATE stories SET cached_tokens = ?, tokens_in = ?, updated_at = ? WHERE id = ?')
    .run(cached, tin, new Date().toISOString(), storyId);
  return res.changes > 0;
}

/**
 * List every distinct `plan_id` stamped on the stories of a given project.
 * Used by "mark plan ready" so the board can act on each plan of a project
 * without making the user pick one.
 * @param {string} projectId
 * @returns {string[]}
 */
export function listPlanIdsForProject(projectId) {
  return getDb()
    .prepare(`
      SELECT DISTINCT plan_id FROM stories
      WHERE project_id = ? AND plan_id IS NOT NULL
    `)
    .all(projectId)
    .map((r) => r.plan_id);
}

/**
 * Inserts or updates a session record.
 * @param {object} session
 */
export function upsertSession(session) {
  const stmt = getDb().prepare(`
    INSERT INTO sessions (
      id, project_id, task, status, created_at, updated_at,
      iterations, duration_ms, approved, commits, stages_completed,
      checkpoints, llm_calls, config_snapshot, budget
    ) VALUES (
      @id, @project_id, @task, @status, @created_at, @updated_at,
      @iterations, @duration_ms, @approved, @commits, @stages_completed,
      @checkpoints, @llm_calls, @config_snapshot, @budget
    )
    ON CONFLICT(id) DO UPDATE SET
      status = @status,
      task = COALESCE(@task, task),
      updated_at = @updated_at,
      iterations = COALESCE(@iterations, iterations),
      duration_ms = COALESCE(@duration_ms, duration_ms),
      approved = @approved,
      commits = COALESCE(@commits, commits),
      stages_completed = COALESCE(@stages_completed, stages_completed),
      checkpoints = COALESCE(@checkpoints, checkpoints),
      llm_calls = COALESCE(@llm_calls, llm_calls),
      config_snapshot = COALESCE(@config_snapshot, config_snapshot),
      budget = COALESCE(@budget, budget)
  `);
  stmt.run({
    id: session.id,
    project_id: session.project_id || 'default',
    task: session.task || null,
    status: session.status || 'unknown',
    created_at: session.created_at || new Date().toISOString(),
    updated_at: session.updated_at || new Date().toISOString(),
    iterations: session.iterations ?? 0,
    duration_ms: session.duration_ms ?? null,
    approved: session.approved ? 1 : 0,
    commits: session.commits || null,
    stages_completed: session.stages_completed || null,
    checkpoints: session.checkpoints || null,
    llm_calls: session.llm_calls || null,
    config_snapshot: session.config_snapshot || null,
    budget: session.budget || null,
  });
}

/**
 * Returns all projects with aggregated stats.
 * @returns {Array<object>}
 */
export function getProjects() {
  return getDb().prepare(`
    SELECT p.*,
      (SELECT COUNT(*) FROM stories s WHERE s.project_id = p.id) AS story_count,
      (SELECT COUNT(*) FROM stories s WHERE s.project_id = p.id AND s.status = 'certified') AS certified_count,
      (SELECT COUNT(*) FROM stories s WHERE s.project_id = p.id AND s.status = 'pending') AS pending_count,
      (SELECT COUNT(*) FROM sessions ss WHERE ss.project_id = p.id) AS session_count
    FROM projects p
    ORDER BY p.last_activity DESC
  `).all();
}

/**
 * Returns stories for a specific project.
 * @param {string} projectId
 * @returns {Array<object>}
 */
/**
 * Fetch all stories of a project ordered by plan_order ASC (roots first,
 * dependents last — matches what `kj run --plan` will actually execute)
 * and falling back to updated_at DESC for legacy rows that never had
 * plan_order stamped.
 */
export function getStoriesByProject(projectId) {
  return getDb().prepare(`
    SELECT * FROM stories WHERE project_id = ?
    ORDER BY plan_order IS NULL, plan_order ASC, updated_at DESC
  `).all(projectId);
}

/**
 * Aggregate $ cost for a project (KJC-TSK-0516, Cost E).
 * Sums stories.cost_usd, groups by plan_id ('unassigned' for NULL).
 * Returns null if project does not exist; otherwise an object with
 * totalUsd=0 and byPlan=[] when no stories carry cost_usd yet.
 * @param {string} projectId
 * @returns {{ totalUsd:number, byPlan:Array<{planId:string,totalUsd:number,huCount:number}>, unknownModelTokens:object, currency:string } | null}
 */
export function getProjectCost(projectId) {
  const project = getDb()
    .prepare('SELECT id FROM projects WHERE id = ?')
    .get(projectId);
  if (!project) return null;

  // Φ0-G: cached_tokens / tokens_in are nullable independently of
  // cost_usd, so we read all three columns but keep cost as the
  // primary filter (a row with only cache telemetry but no $ should
  // not appear in the per-plan totals — cost rules the byPlan list).
  const rows = getDb()
    .prepare(
      `SELECT plan_id, cost_usd, cached_tokens, tokens_in FROM stories
       WHERE project_id = ? AND cost_usd IS NOT NULL`
    )
    .all(projectId);

  const round4 = (n) => Math.round(n * 10000) / 10000;
  const byPlanMap = new Map();
  let totalUsd = 0;
  let totalCached = 0;
  let totalTokensIn = 0;
  for (const r of rows) {
    const planId = r.plan_id || 'unassigned';
    const cost = Number(r.cost_usd);
    if (!Number.isFinite(cost)) continue;
    totalUsd += cost;
    const cached = Number(r.cached_tokens);
    const tin = Number(r.tokens_in);
    if (Number.isFinite(cached) && cached >= 0) totalCached += cached;
    if (Number.isFinite(tin) && tin >= 0) totalTokensIn += tin;
    const cur = byPlanMap.get(planId) || { planId, totalUsd: 0, huCount: 0, cachedTokens: 0, tokensIn: 0 };
    cur.totalUsd += cost;
    cur.huCount += 1;
    if (Number.isFinite(cached) && cached >= 0) cur.cachedTokens += cached;
    if (Number.isFinite(tin) && tin >= 0) cur.tokensIn += tin;
    byPlanMap.set(planId, cur);
  }

  const ratio = (cached, tin) => tin > 0 ? Math.round((cached / tin) * 1000) / 10 : null;
  const byPlan = Array.from(byPlanMap.values())
    .map((p) => ({
      planId: p.planId,
      totalUsd: round4(p.totalUsd),
      huCount: p.huCount,
      cachedTokens: p.cachedTokens,
      tokensIn: p.tokensIn,
      cachedRatioPct: ratio(p.cachedTokens, p.tokensIn),
    }))
    .sort((a, b) => b.totalUsd - a.totalUsd);

  return {
    totalUsd: round4(totalUsd),
    byPlan,
    cachedTokens: totalCached,
    tokensIn: totalTokensIn,
    cachedRatioPct: ratio(totalCached, totalTokensIn),
    unknownModelTokens: { tokensIn: 0, tokensOut: 0, models: [] },
    currency: 'USD',
  };
}

/**
 * Returns full story detail including context requests.
 * @param {string} storyId
 * @returns {object | null}
 */
export function getStoryDetail(storyId) {
  const story = getDb().prepare('SELECT * FROM stories WHERE id = ?').get(storyId);
  if (!story) return null;

  const contextRequests = getDb().prepare(
    'SELECT * FROM context_requests WHERE story_id = ? ORDER BY requested_at DESC'
  ).all(storyId);

  return { ...story, context_requests: contextRequests };
}

/**
 * Returns sessions for a specific project.
 *
 * The `project_name` column is joined in so the UI can show a human
 * label like `tmp_kj-test-4 · trivial(doc) · 08:35` instead of just
 * the cryptic `s_2026-05-07T...` id.
 *
 * @param {string} projectId
 * @returns {Array<object>}
 */
export function getSessionsByProject(projectId) {
  return getDb().prepare(`
    SELECT s.id, s.project_id, s.task, s.status, s.created_at, s.updated_at,
           s.iterations, s.duration_ms, s.approved, s.stages_completed,
           p.name AS project_name
    FROM sessions s
    LEFT JOIN projects p ON p.id = s.project_id
    WHERE s.project_id = ?
    ORDER BY s.created_at DESC
  `).all(projectId);
}

/**
 * Returns full session detail (with the joined project_name).
 * @param {string} sessionId
 * @returns {object | null}
 */
export function getSessionDetail(sessionId) {
  return getDb().prepare(`
    SELECT s.*, p.name AS project_name
    FROM sessions s
    LEFT JOIN projects p ON p.id = s.project_id
    WHERE s.id = ?
  `).get(sessionId);
}

/**
 * Returns global dashboard statistics.
 * @returns {object}
 */
export function getDashboardStats() {
  const db = getDb();
  const totalStories = db.prepare('SELECT COUNT(*) AS count FROM stories').get().count;
  const certifiedStories = db.prepare("SELECT COUNT(*) AS count FROM stories WHERE status = 'certified'").get().count;
  const pendingStories = db.prepare("SELECT COUNT(*) AS count FROM stories WHERE status = 'pending'").get().count;
  const doneStories = db.prepare("SELECT COUNT(*) AS count FROM stories WHERE status = 'done'").get().count;
  const needsContextStories = db.prepare("SELECT COUNT(*) AS count FROM stories WHERE status = 'needs_context'").get().count;
  const avgQuality = db.prepare('SELECT AVG(quality_total) AS avg FROM stories WHERE quality_total IS NOT NULL').get().avg;
  const totalSessions = db.prepare('SELECT COUNT(*) AS count FROM sessions').get().count;
  const approvedSessions = db.prepare('SELECT COUNT(*) AS count FROM sessions WHERE approved = 1').get().count;
  const totalProjects = db.prepare('SELECT COUNT(*) AS count FROM projects').get().count;

  return {
    total_stories: totalStories,
    certified_stories: certifiedStories,
    pending_stories: pendingStories,
    done_stories: doneStories,
    needs_context_stories: needsContextStories,
    avg_quality: avgQuality ? Math.round(avgQuality * 10) / 10 : null,
    total_sessions: totalSessions,
    approved_sessions: approvedSessions,
    total_projects: totalProjects,
  };
}

/**
 * Inserts a context request for a story.
 * @param {object} req
 */
export function insertContextRequest(req) {
  getDb().prepare(`
    INSERT INTO context_requests (story_id, fields_needed, question, answer, requested_at, answered_at)
    VALUES (@story_id, @fields_needed, @question, @answer, @requested_at, @answered_at)
  `).run({
    story_id: req.story_id,
    fields_needed: req.fields_needed || null,
    question: req.question || null,
    answer: req.answer || null,
    requested_at: req.requested_at || new Date().toISOString(),
    answered_at: req.answered_at || null,
  });
}

/**
 * Delete a project and all its stories + sessions (cascade).
 * Returns true if the project existed.
 */
export function deleteProject(projectId) {
  const db = getDb();
  const existing = db.prepare('SELECT id FROM projects WHERE id = ?').get(projectId);
  if (!existing) return false;
  db.transaction(() => {
    db.prepare('DELETE FROM stories WHERE project_id = ?').run(projectId);
    db.prepare('DELETE FROM sessions WHERE project_id = ?').run(projectId);
    db.prepare('DELETE FROM projects WHERE id = ?').run(projectId);
  })();
  return true;
}

/**
 * Set or clear the `is_test` flag on a project. Drives the
 * ephemeral-cleanup heuristic in ephemeral-cleaner.js:
 *   - 1     → always treat as ephemeral (cleanup once last_activity > TTL)
 *   - 0     → NEVER auto-clean, regardless of id pattern (user override)
 *   - null  → follow the default id-pattern heuristic
 *
 * @param {string} projectId
 * @param {number|null} value  one of 0, 1, null
 * @returns {boolean} true when the project existed and was updated
 */
export function setProjectIsTest(projectId, value) {
  if (value !== 0 && value !== 1 && value !== null) {
    throw new Error(`setProjectIsTest: value must be 0, 1, or null (got ${value})`);
  }
  const db = getDb();
  const result = db
    .prepare('UPDATE projects SET is_test = ? WHERE id = ?')
    .run(value, projectId);
  return result.changes > 0;
}

/**
 * Delete a single story.
 */
export function deleteStory(storyId) {
  const db = getDb();
  const res = db.prepare('DELETE FROM stories WHERE id = ?').run(storyId);
  return res.changes > 0;
}

/**
 * Delete a single session.
 */
export function deleteSession(sessionId) {
  const db = getDb();
  const res = db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
  return res.changes > 0;
}

// --- Tombstones (KJC-TSK-0380) ---------------------------------------
// "This (resource_type, resource_id) is dead — don't bring it back." The
// sync layer consults this table BEFORE every upsert and skips records
// whose id is buried. Restoration is explicit via removeTombstone().

export function addTombstone(resourceType, resourceId, opts = {}) {
  getDb().prepare(`
    INSERT OR REPLACE INTO tombstones (resource_type, resource_id, deleted_at, source, fs_paths)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    resourceType, resourceId,
    new Date().toISOString(),
    opts.source || 'api',
    opts.fsPaths ? JSON.stringify(opts.fsPaths) : null,
  );
}

export function isTombstoned(resourceType, resourceId) {
  return !!getDb().prepare(
    'SELECT 1 FROM tombstones WHERE resource_type = ? AND resource_id = ? LIMIT 1'
  ).get(resourceType, resourceId);
}

/**
 * Read a single tombstone row (or null). Needed so callers can compare
 * `deleted_at` against a resource's own timestamp before deciding whether
 * to revive it (KJC-BUG-0055).
 */
export function getTombstone(resourceType, resourceId) {
  const row = getDb().prepare(
    'SELECT resource_type, resource_id, deleted_at, source, fs_paths FROM tombstones WHERE resource_type = ? AND resource_id = ?'
  ).get(resourceType, resourceId);
  if (!row) return null;
  return { ...row, fs_paths: row.fs_paths ? JSON.parse(row.fs_paths) : [] };
}

export function removeTombstone(resourceType, resourceId) {
  return getDb().prepare(
    'DELETE FROM tombstones WHERE resource_type = ? AND resource_id = ?'
  ).run(resourceType, resourceId).changes > 0;
}

export function listTombstones() {
  return getDb().prepare(
    'SELECT resource_type, resource_id, deleted_at, source, fs_paths FROM tombstones ORDER BY deleted_at DESC'
  ).all().map((row) => ({
    ...row,
    fs_paths: row.fs_paths ? JSON.parse(row.fs_paths) : [],
  }));
}

/**
 * Closes the database connection.
 */
export function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}
