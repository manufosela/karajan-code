// KJC-TSK-0820 — two-level nav: generic top bar vs project sub-bar.
//
// The user's order: generic buttons (Dashboard) can never share a bar with
// project-scoped ones (Board, Governance, …) — it made Governance look
// global. The project sub-bar (#project-nav) appears only once a project
// is loaded from the dashboard, and the confusing project <select> is gone:
// the ONLY way to switch project is going back to the dashboard.
//
// index.html is a static file, so the contract is asserted structurally;
// the visibility rule is a pure function in app.js, loaded via node:vm
// (same pattern as maggle-mode.test.js — classic scripts, no exports).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const appSrc = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');

const headerNav = html.slice(
  html.indexOf('<nav class="header__nav">'),
  html.indexOf('</header>')
);
const projectNavStart = html.indexOf('id="project-nav"');
const projectNav = projectNavStart === -1
  ? ''
  : html.slice(projectNavStart, html.indexOf('</nav>', projectNavStart));

function loadApp() {
  const ctx = { window: { location: { pathname: '/', hash: '' } } };
  vm.createContext(ctx);
  vm.runInContext(appSrc, ctx);
  return ctx;
}

describe('two-level nav (KJC-TSK-0820)', () => {
  it('the project <select> is gone — switching projects happens on the dashboard only', () => {
    expect(html).not.toContain('project-select');
  });

  it('the generic top bar holds only entries not tied to one project', () => {
    expect(headerNav).toContain('data-view="dashboard"');
    for (const scoped of ['data-view="board"', 'data-view="graph"', 'data-view="sessions"', 'data-view="governance"', '/pipeline.html', '/rag.html', '/wiki.html']) {
      expect(headerNav).not.toContain(scoped);
    }
  });

  it('the project sub-bar holds every project-scoped entry plus the project name slot', () => {
    expect(projectNav).not.toBe('');
    expect(projectNav).toContain('id="project-nav-name"');
    for (const scoped of ['data-view="board"', 'data-view="graph"', 'data-view="sessions"', 'data-view="governance"', '/pipeline.html', '/rag.html', '/wiki.html']) {
      expect(projectNav).toContain(scoped);
    }
  });

  it('project-scoped buttons carry their own visual level (nav-btn--project)', () => {
    expect(projectNav).toContain('nav-btn--project');
    expect(headerNav).not.toContain('nav-btn--project');
  });

  describe('projectNavVisibility (pure)', () => {
    it('shows the project bar only when a project is loaded', () => {
      const app = loadApp();
      expect(app.projectNavVisibility('board', 'my-project')).toEqual({ generic: true, project: true });
      expect(app.projectNavVisibility('board', '')).toEqual({ generic: true, project: false });
    });

    it('hides the project bar on the dashboard even with a project in the route', () => {
      const app = loadApp();
      expect(app.projectNavVisibility('dashboard', 'my-project')).toEqual({ generic: true, project: false });
    });

    it('the generic bar is always visible', () => {
      const app = loadApp();
      for (const view of ['board', 'dashboard', 'sessions', 'governance']) {
        expect(app.projectNavVisibility(view, '').generic).toBe(true);
      }
    });
  });

  it('no orphan references to the removed select survive in the frontend scripts', () => {
    for (const file of ['app.js', 'utils/init-listeners.js', 'utils/project-actions.js']) {
      const src = readFileSync(new URL(`../public/${file}`, import.meta.url), 'utf8');
      expect(src, `${file} still references the removed project select`).not.toMatch(/populateProjectSelect|project-select/);
    }
  });
});
