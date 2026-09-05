// KJC-BUG-0160: cada worktree/carril re-registraba el MISMO repo como
// proyecto nuevo del board (13+ «brain-backlog» en el picker, uno por
// ruta). La identidad de proyecto es el root del repo — el git-common-dir
// resuelve el worktree enlazado a su árbol principal; lo que no es git se
// identifica por su ruta, como siempre.
import { describe, it, expect } from 'vitest';
import { canonicalProjectDir, deriveProjectIdFromDir } from '../src/sync.js';

describe('canonicalProjectDir (KJC-BUG-0160)', () => {
  it('un worktree enlazado resuelve al root del árbol principal', () => {
    const git = () => '/home/u/grebla-app/.git';
    expect(
      canonicalProjectDir('/home/u/grebla-app/.claude/worktrees/agent-x', git),
    ).toBe('/home/u/grebla-app');
  });

  it('el árbol principal se identifica a sí mismo (common-dir relativo .git)', () => {
    const git = () => '.git';
    expect(canonicalProjectDir('/home/u/grebla-app', git)).toBe('/home/u/grebla-app');
  });

  it('un directorio sin git conserva su ruta como identidad', () => {
    const git = () => {
      throw new Error('not a git repository');
    };
    expect(canonicalProjectDir('/home/u/notas', git)).toBe('/home/u/notas');
  });

  it('dos worktrees del mismo repo derivan el MISMO project_id', () => {
    const git = () => '/home/u/grebla-app/.git';
    const a = deriveProjectIdFromDir(canonicalProjectDir('/home/u/grebla-app/.claude/worktrees/agent-x', git));
    const b = deriveProjectIdFromDir(canonicalProjectDir('/home/u/grebla-app/.claude/worktrees/agent-y', git));
    expect(a).toBe(b);
    expect(a).toBe('home_u_grebla-app');
  });

  it('cachea por ruta: el runner de git corre una vez por directorio', () => {
    let calls = 0;
    const git = () => {
      calls += 1;
      return '/home/u/cacheado/.git';
    };
    canonicalProjectDir('/home/u/cacheado/.claude/worktrees/w1', git);
    canonicalProjectDir('/home/u/cacheado/.claude/worktrees/w1', git);
    expect(calls).toBe(1);
  });
});
