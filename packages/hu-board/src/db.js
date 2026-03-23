import Database from 'better-sqlite3';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';

/** @type {import('better-sqlite3').Database | null} */
let db = null;

/**
 * Returns the KJ home directory, respecting KJ_HOME env var.
 * @returns {string}
 */
export function getKjHome() {
  return process.env.KJ_HOME || join(process.env.HOME || '/root', '.karajan');
}

/**
 * Initializes the SQLite database and creates tables if they don't exist.
 * @returns {import('better-sqlite3').Database}
 */
export function initDb() {
  const kjHome = getKjHome();
  mkdirSync(kjHome, { recursive: true });

  const dbPath = join(kjHome, 'hu-board.db');
  db = new Database(dbPath);

  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

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

    CREATE INDEX IF NOT EXISTS idx_stories_project ON stories(project_id);
    CREATE INDEX IF NOT EXISTS idx_stories_status ON stories(status);
    CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project_id);
    CREATE INDEX IF NOT EXISTS idx_context_story ON context_requests(story_id);
  `);

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
 * Inserts or updates a project record.
 * @param {{ id: string, name?: string, first_seen?: string, last_activity?: string, total_stories?: number }} project
 */
export function upsertProject(project) {
  const stmt = getDb().prepare(`
    INSERT INTO projects (id, name, first_seen, last_activity, total_stories)
    VALUES (@id, @name, @first_seen, @last_activity, @total_stories)
    ON CONFLICT(id) DO UPDATE SET
      name = COALESCE(@name, name),
      last_activity = COALESCE(@last_activity, last_activity),
      total_stories = COALESCE(@total_stories, total_stories)
  `);
  stmt.run({
    id: project.id,
    name: project.name || project.id,
    first_seen: project.first_seen || new Date().toISOString(),
    last_activity: project.last_activity || new Date().toISOString(),
    total_stories: project.total_stories || 0,
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
      created_at, updated_at, certified_at
    ) VALUES (
      @id, @project_id, @session_id, @status, @title, @original_text,
      @certified_as, @certified_want, @certified_so_that,
      @quality_total, @quality_d1, @quality_d2, @quality_d3, @quality_d4, @quality_d5, @quality_d6,
      @antipatterns, @ac_format, @acceptance_criteria,
      @created_at, @updated_at, @certified_at
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
      certified_at = COALESCE(@certified_at, certified_at)
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
  });
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
export function getStoriesByProject(projectId) {
  return getDb().prepare(`
    SELECT * FROM stories WHERE project_id = ? ORDER BY updated_at DESC
  `).all(projectId);
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
 * @param {string} projectId
 * @returns {Array<object>}
 */
export function getSessionsByProject(projectId) {
  return getDb().prepare(`
    SELECT id, project_id, task, status, created_at, updated_at,
           iterations, duration_ms, approved, stages_completed
    FROM sessions WHERE project_id = ? ORDER BY created_at DESC
  `).all(projectId);
}

/**
 * Returns full session detail.
 * @param {string} sessionId
 * @returns {object | null}
 */
export function getSessionDetail(sessionId) {
  return getDb().prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);
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
 * Closes the database connection.
 */
export function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}
