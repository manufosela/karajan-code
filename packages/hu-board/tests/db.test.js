import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { tmpdir } from 'node:os';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';

// Each test gets its own temp KJ_HOME so db.js creates its DB there.
let tmpDir;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'hu-board-test-'));
  process.env.KJ_HOME = tmpDir;
});

afterEach(async () => {
  // closeDb resets the module-level `db` variable
  const { closeDb } = await import('../src/db.js');
  closeDb();
  rmSync(tmpDir, { recursive: true, force: true });
  delete process.env.KJ_HOME;
});

// We re-import dynamically so the module picks up the fresh KJ_HOME each time.
async function freshDb() {
  const mod = await import('../src/db.js');
  mod.initDb();
  return mod;
}

// ---------------------------------------------------------------------------
// initDb
// ---------------------------------------------------------------------------
describe('initDb', () => {
  it('creates all expected tables', async () => {
    const { getDb } = await freshDb();
    const tables = getDb()
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all()
      .map((r) => r.name);

    expect(tables).toContain('projects');
    expect(tables).toContain('stories');
    expect(tables).toContain('sessions');
    expect(tables).toContain('context_requests');
  });

  it('creates expected indexes', async () => {
    const { getDb } = await freshDb();
    const indexes = getDb()
      .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .all()
      .map((r) => r.name);

    expect(indexes).toContain('idx_stories_project');
    expect(indexes).toContain('idx_stories_status');
    expect(indexes).toContain('idx_sessions_project');
    expect(indexes).toContain('idx_context_story');
  });
});

// ---------------------------------------------------------------------------
// upsertStory
// ---------------------------------------------------------------------------
describe('upsertStory', () => {
  it('inserts a new story', async () => {
    const { getDb, upsertStory } = await freshDb();
    upsertStory({ id: 'story-1', project_id: 'proj-1', status: 'pending', title: 'My story' });

    const row = getDb().prepare('SELECT * FROM stories WHERE id = ?').get('story-1');
    expect(row).toBeTruthy();
    expect(row.project_id).toBe('proj-1');
    expect(row.status).toBe('pending');
    expect(row.title).toBe('My story');
  });

  it('updates an existing story on conflict', async () => {
    const { getDb, upsertStory } = await freshDb();
    upsertStory({ id: 'story-1', project_id: 'proj-1', status: 'pending', title: 'V1' });
    upsertStory({ id: 'story-1', project_id: 'proj-1', status: 'certified', title: 'V2' });

    const row = getDb().prepare('SELECT * FROM stories WHERE id = ?').get('story-1');
    expect(row.status).toBe('certified');
    expect(row.title).toBe('V2');
  });

  it('stores quality dimensions', async () => {
    const { getDb, upsertStory } = await freshDb();
    upsertStory({
      id: 'story-q',
      project_id: 'proj-1',
      quality_total: 85,
      quality_d1: 90,
      quality_d2: 80,
      quality_d3: 85,
      quality_d4: 88,
      quality_d5: 82,
      quality_d6: 75,
    });

    const row = getDb().prepare('SELECT * FROM stories WHERE id = ?').get('story-q');
    expect(row.quality_total).toBe(85);
    expect(row.quality_d1).toBe(90);
    expect(row.quality_d6).toBe(75);
  });

  it('defaults project_id to "default" when omitted', async () => {
    const { getDb, upsertStory } = await freshDb();
    upsertStory({ id: 'story-def' });

    const row = getDb().prepare('SELECT * FROM stories WHERE id = ?').get('story-def');
    expect(row.project_id).toBe('default');
  });
});

// ---------------------------------------------------------------------------
// upsertProject
// ---------------------------------------------------------------------------
describe('upsertProject', () => {
  it('inserts a new project', async () => {
    const { getDb, upsertProject } = await freshDb();
    upsertProject({ id: 'proj-1', name: 'My Project' });

    const row = getDb().prepare('SELECT * FROM projects WHERE id = ?').get('proj-1');
    expect(row).toBeTruthy();
    expect(row.name).toBe('My Project');
  });

  it('updates existing project on conflict', async () => {
    const { getDb, upsertProject } = await freshDb();
    upsertProject({ id: 'proj-1', name: 'V1', total_stories: 0 });
    upsertProject({ id: 'proj-1', name: 'V2', total_stories: 5 });

    const row = getDb().prepare('SELECT * FROM projects WHERE id = ?').get('proj-1');
    expect(row.name).toBe('V2');
    expect(row.total_stories).toBe(5);
  });

  it('uses id as name when name is omitted', async () => {
    const { getDb, upsertProject } = await freshDb();
    upsertProject({ id: 'proj-x' });

    const row = getDb().prepare('SELECT * FROM projects WHERE id = ?').get('proj-x');
    expect(row.name).toBe('proj-x');
  });
});

// ---------------------------------------------------------------------------
// upsertSession
// ---------------------------------------------------------------------------
describe('upsertSession', () => {
  it('inserts a new session', async () => {
    const { getDb, upsertSession } = await freshDb();
    upsertSession({
      id: 'sess-1',
      project_id: 'proj-1',
      task: 'Implement feature',
      status: 'approved',
      iterations: 3,
      approved: true,
    });

    const row = getDb().prepare('SELECT * FROM sessions WHERE id = ?').get('sess-1');
    expect(row).toBeTruthy();
    expect(row.task).toBe('Implement feature');
    expect(row.status).toBe('approved');
    expect(row.iterations).toBe(3);
    expect(row.approved).toBe(1);
  });

  it('updates existing session on conflict', async () => {
    const { getDb, upsertSession } = await freshDb();
    upsertSession({ id: 'sess-1', status: 'running', approved: false });
    upsertSession({ id: 'sess-1', status: 'approved', approved: true, iterations: 5 });

    const row = getDb().prepare('SELECT * FROM sessions WHERE id = ?').get('sess-1');
    expect(row.status).toBe('approved');
    expect(row.approved).toBe(1);
    expect(row.iterations).toBe(5);
  });

  it('defaults project_id to "default" when omitted', async () => {
    const { getDb, upsertSession } = await freshDb();
    upsertSession({ id: 'sess-def' });

    const row = getDb().prepare('SELECT * FROM sessions WHERE id = ?').get('sess-def');
    expect(row.project_id).toBe('default');
  });

  it('stores JSON fields as strings', async () => {
    const { getDb, upsertSession } = await freshDb();
    const commits = JSON.stringify([{ hash: 'abc', message: 'fix' }]);
    upsertSession({ id: 'sess-json', commits });

    const row = getDb().prepare('SELECT * FROM sessions WHERE id = ?').get('sess-json');
    expect(JSON.parse(row.commits)).toEqual([{ hash: 'abc', message: 'fix' }]);
  });
});

// ---------------------------------------------------------------------------
// getProjects
// ---------------------------------------------------------------------------
describe('getProjects', () => {
  it('returns all projects with aggregated stats', async () => {
    const { upsertProject, upsertStory, upsertSession, getProjects } = await freshDb();

    upsertProject({ id: 'proj-1', name: 'P1' });
    upsertStory({ id: 's1', project_id: 'proj-1', status: 'certified' });
    upsertStory({ id: 's2', project_id: 'proj-1', status: 'pending' });
    upsertSession({ id: 'ses1', project_id: 'proj-1' });

    const projects = getProjects();
    expect(projects).toHaveLength(1);
    expect(projects[0].story_count).toBe(2);
    expect(projects[0].certified_count).toBe(1);
    expect(projects[0].pending_count).toBe(1);
    expect(projects[0].session_count).toBe(1);
  });

  it('returns empty array when no projects exist', async () => {
    const { getProjects } = await freshDb();
    expect(getProjects()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// getStoriesByProject
// ---------------------------------------------------------------------------
describe('getStoriesByProject', () => {
  it('filters stories by project', async () => {
    const { upsertStory, getStoriesByProject } = await freshDb();
    upsertStory({ id: 's1', project_id: 'proj-1' });
    upsertStory({ id: 's2', project_id: 'proj-2' });
    upsertStory({ id: 's3', project_id: 'proj-1' });

    const stories = getStoriesByProject('proj-1');
    expect(stories).toHaveLength(2);
    expect(stories.every((s) => s.project_id === 'proj-1')).toBe(true);
  });

  it('returns empty array for unknown project', async () => {
    const { getStoriesByProject } = await freshDb();
    expect(getStoriesByProject('nonexistent')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// getStoryDetail
// ---------------------------------------------------------------------------
describe('getStoryDetail', () => {
  it('returns story with context_requests', async () => {
    const { upsertStory, insertContextRequest, getStoryDetail } = await freshDb();
    upsertStory({ id: 'story-d', project_id: 'proj-1', status: 'needs_context' });
    insertContextRequest({ story_id: 'story-d', question: 'Who is the user?', requested_at: new Date().toISOString() });
    insertContextRequest({ story_id: 'story-d', question: 'What is the scope?', requested_at: new Date().toISOString() });

    const detail = getStoryDetail('story-d');
    expect(detail).toBeTruthy();
    expect(detail.id).toBe('story-d');
    expect(detail.context_requests).toHaveLength(2);
  });

  it('returns null for unknown story', async () => {
    const { getStoryDetail } = await freshDb();
    expect(getStoryDetail('nonexistent')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// getSessionsByProject
// ---------------------------------------------------------------------------
describe('getSessionsByProject', () => {
  it('filters sessions by project', async () => {
    const { upsertSession, getSessionsByProject } = await freshDb();
    upsertSession({ id: 'ses1', project_id: 'proj-1', status: 'approved' });
    upsertSession({ id: 'ses2', project_id: 'proj-2', status: 'failed' });
    upsertSession({ id: 'ses3', project_id: 'proj-1', status: 'running' });

    const sessions = getSessionsByProject('proj-1');
    expect(sessions).toHaveLength(2);
    expect(sessions.every((s) => s.project_id === 'proj-1')).toBe(true);
  });

  it('returns empty array for unknown project', async () => {
    const { getSessionsByProject } = await freshDb();
    expect(getSessionsByProject('nonexistent')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// getDashboardStats
// ---------------------------------------------------------------------------
describe('getDashboardStats', () => {
  it('returns correct counts with data', async () => {
    const { upsertProject, upsertStory, upsertSession, getDashboardStats } = await freshDb();

    upsertProject({ id: 'proj-1' });
    upsertProject({ id: 'proj-2' });
    upsertStory({ id: 's1', project_id: 'proj-1', status: 'certified', quality_total: 90 });
    upsertStory({ id: 's2', project_id: 'proj-1', status: 'pending', quality_total: 80 });
    upsertStory({ id: 's3', project_id: 'proj-2', status: 'done' });
    upsertStory({ id: 's4', project_id: 'proj-2', status: 'needs_context' });
    upsertSession({ id: 'ses1', project_id: 'proj-1', approved: true });
    upsertSession({ id: 'ses2', project_id: 'proj-2', approved: false });

    const stats = getDashboardStats();
    expect(stats.total_stories).toBe(4);
    expect(stats.certified_stories).toBe(1);
    expect(stats.pending_stories).toBe(1);
    expect(stats.done_stories).toBe(1);
    expect(stats.needs_context_stories).toBe(1);
    expect(stats.avg_quality).toBe(85);
    expect(stats.total_sessions).toBe(2);
    expect(stats.approved_sessions).toBe(1);
    expect(stats.total_projects).toBe(2);
  });

  it('returns zeros and null for empty database', async () => {
    const { getDashboardStats } = await freshDb();
    const stats = getDashboardStats();

    expect(stats.total_stories).toBe(0);
    expect(stats.certified_stories).toBe(0);
    expect(stats.pending_stories).toBe(0);
    expect(stats.done_stories).toBe(0);
    expect(stats.needs_context_stories).toBe(0);
    expect(stats.avg_quality).toBeNull();
    expect(stats.total_sessions).toBe(0);
    expect(stats.approved_sessions).toBe(0);
    expect(stats.total_projects).toBe(0);
  });
});
