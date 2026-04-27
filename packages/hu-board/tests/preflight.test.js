import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runPreflight } from '../src/preflight.js';

let tmpProject;
let tmpKjHome;
let savedKjHome;

beforeEach(() => {
  tmpProject = join(tmpdir(), `kj-preflight-${process.pid}-${Date.now()}`);
  tmpKjHome = join(tmpdir(), `kj-preflight-home-${process.pid}-${Date.now()}`);
  mkdirSync(tmpProject, { recursive: true });
  mkdirSync(tmpKjHome, { recursive: true });
  savedKjHome = process.env.KJ_HOME;
  process.env.KJ_HOME = tmpKjHome;
});

afterEach(() => {
  if (savedKjHome === undefined) delete process.env.KJ_HOME;
  else process.env.KJ_HOME = savedKjHome;
  try { rmSync(tmpProject, { recursive: true, force: true }); } catch { /* ignore */ }
  try { rmSync(tmpKjHome,   { recursive: true, force: true }); } catch { /* ignore */ }
});

describe('runPreflight', () => {
  it('returns the consistent shape regardless of project state', async () => {
    const result = await runPreflight({ projectId: 'fake', projectDir: tmpProject });
    expect(result).toHaveProperty('checks');
    expect(result).toHaveProperty('blockers');
    expect(result).toHaveProperty('warnings');
    expect(result.projectId).toBe('fake');
    expect(Array.isArray(result.checks)).toBe(true);
  });

  it('flags missing git as a blocker', async () => {
    const result = await runPreflight({ projectId: 'fake', projectDir: tmpProject });
    const gitInit = result.checks.find(c => c.id === 'git_init');
    expect(gitInit?.status).toBe('fail');
    expect(gitInit?.blocking).toBe(true);
    expect(result.blockers.some(b => b.id === 'git_init')).toBe(true);
  });

  it('flags missing remote as a warning (not blocking)', async () => {
    execSync(`git -C "${tmpProject}" init -q`, { stdio: 'ignore' });
    execSync(`git -C "${tmpProject}" config user.email t@t.t`, { stdio: 'ignore' });
    execSync(`git -C "${tmpProject}" config user.name Tester`, { stdio: 'ignore' });
    writeFileSync(join(tmpProject, '.gitkeep'), '');
    execSync(`git -C "${tmpProject}" add -A`, { stdio: 'ignore' });
    execSync(`git -C "${tmpProject}" commit -q -m init`, { stdio: 'ignore' });

    const result = await runPreflight({ projectId: 'fake', projectDir: tmpProject });
    const gitInit = result.checks.find(c => c.id === 'git_init');
    const gitRemote = result.checks.find(c => c.id === 'git_remote');
    expect(gitInit?.status).toBe('ok');
    expect(gitRemote?.status).toBe('warn');
    expect(gitRemote?.blocking).toBe(false);
    expect(gitRemote?.consequence).toMatch(/Pull Requests/);
    // No blockers — only a warning
    expect(result.blockers.length).toBe(0);
    expect(result.warnings.some(w => w.id === 'git_remote')).toBe(true);
  });

  it('marks a configured remote as ok and surfaces its URL', async () => {
    execSync(`git -C "${tmpProject}" init -q`, { stdio: 'ignore' });
    execSync(`git -C "${tmpProject}" remote add origin git@github.com:test/repo.git`, { stdio: 'ignore' });
    const result = await runPreflight({ projectId: 'fake', projectDir: tmpProject });
    const gitRemote = result.checks.find(c => c.id === 'git_remote');
    expect(gitRemote?.status).toBe('ok');
    expect(gitRemote?.detail).toContain('github.com');
  });

  it('flags a missing projectDir as a blocker (run cannot proceed)', async () => {
    const result = await runPreflight({ projectId: 'no-plans-yet', projectDir: null });
    const projectDir = result.checks.find(c => c.id === 'project_dir');
    expect(projectDir?.status).toBe('warn');
    expect(projectDir?.blocking).toBe(true);
    expect(result.blockers.length).toBe(0);     // not flagged as fail-status
    // The "project_dir" warn with blocking:true is a fail in the
    // safety modal sense — verify the front sees it via the
    // blocking flag, even though `status` is "warn".
    expect(result.checks.some(c => c.id === 'project_dir' && c.blocking)).toBe(true);
  });

  it('always reports Node + Karajan version regardless of project', async () => {
    const result = await runPreflight({ projectId: 'x', projectDir: null });
    const node = result.checks.find(c => c.id === 'node_version');
    const kj = result.checks.find(c => c.id === 'kj_version');
    expect(node).toBeDefined();
    expect(node.detail).toMatch(/^v\d+/);
    expect(kj).toBeDefined();
  });

  it('reports each agent CLI individually', async () => {
    const result = await runPreflight({ projectId: 'x', projectDir: null });
    const ids = result.checks.map(c => c.id);
    expect(ids).toContain('agent_claude');
    expect(ids).toContain('agent_codex');
    expect(ids).toContain('agent_gemini');
    expect(ids).toContain('agent_aider');
  });

  // PR-C: agent absence is informational, NOT a warning, unless the
  // user's kj.config.yml actually declares using that agent.
  describe('agent CLI status semantics (PR-C)', () => {
    const { writeFileSync, mkdirSync: mkdir } = require('node:fs');

    it('absent agent that is not declared anywhere → info, not warn', async () => {
      // Aider is almost certainly not on the test machine's PATH.
      // With no config declaring it, it must come back as "info".
      const home = process.env.KJ_HOME;
      mkdir(`${home}/.karajan`, { recursive: true });
      // Write a minimal config that declares only claude as coder.
      writeFileSync(`${home}/.karajan/kj.config.yml`, 'coder: claude\nreviewer: codex\n');
      const result = await runPreflight({ projectId: 'x', projectDir: null });
      const aider = result.checks.find(c => c.id === 'agent_aider');
      expect(['info', 'ok']).toContain(aider.status);
      if (aider.status === 'info') {
        expect(aider.detail).toBe('no instalado');
        expect(aider.consequence).toBeUndefined();
      }
    });

    it('absent agent that IS declared → warn with consequence', async () => {
      const home = process.env.KJ_HOME;
      mkdir(`${home}/.karajan`, { recursive: true });
      writeFileSync(`${home}/.karajan/kj.config.yml`, 'coder: aider\n');
      const result = await runPreflight({ projectId: 'x', projectDir: null });
      const aider = result.checks.find(c => c.id === 'agent_aider');
      // Only meaningful if aider really isn't on PATH (true on CI).
      if (aider.status !== 'ok') {
        expect(aider.status).toBe('warn');
        expect(aider.consequence).toMatch(/instálalo o cambia el agente/i);
      }
    });
  });
});
