// KJC-TSK-0542: the board's SQLite connection, its schema and migrations. Other modules reach the
// handle through getDb(); db.js re-exports these functions, so callers keep importing from there.
// KJC-TSK-0617 (SQL-C): the handle is karajan-core's better-sqlite3-compatible adapter over
// node:sqlite, built into Node: no native addon to compile.
import { openDatabase } from 'karajan-core/db';
import { join } from 'node:path';
import { mkdirSync, renameSync } from 'node:fs';

import { getKjHome } from './db-paths.js';

/** @type {ReturnType<typeof openDatabase> | null} */
let db = null;

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
 * @returns {ReturnType<typeof openDatabase>}
 */
function openDbResilient(dbPath) {
  let handle = null;
  try {
    handle = openDatabase(dbPath);
    // SQLite reads the file header on the first statement, which is what
    // surfaces "file is not a database". Probe `schema_version` (a built-in
    // SQLite pragma) to force it.
    handle.pragma("schema_version", { simple: true });
    return handle;
  } catch (err) {
    const code = err?.code || "";
    const msg = err?.message || "";
    if (code === "SQLITE_CORRUPT" || code === "SQLITE_NOTADB" || /malformed|not a database/i.test(msg)) {
      try { handle?.close(); } catch { /* already unusable */ }
      const aside = `${dbPath}.corrupt-${Date.now()}`;
      try { renameSync(dbPath, aside); } catch { /* may already be gone */ }
      // eslint-disable-next-line no-console
      console.warn(`[hu-board] DB at ${dbPath} was corrupt; moved aside to ${aside}. Rebuilding from disk via fullScan.`);
      return openDatabase(dbPath);
    }
    throw err;
  }
}

/**
 * Initializes the SQLite database and creates tables if they don't exist.
 * @returns {ReturnType<typeof openDatabase>}
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
 * @returns {ReturnType<typeof openDatabase>}
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
 * Closes the database connection.
 */
export function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}
