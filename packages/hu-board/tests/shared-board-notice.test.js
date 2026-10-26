// KJC-TSK-1197: opening a project whose board mirrors the shared board (GitHub Issues)
// tells the user what they are looking at, how it changes and where its issues live.
//
// shared-board-notice.js is a classic browser script (no exports), so the test loads it
// into a node:vm context and asserts against the hoisted function declaration.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const src = readFileSync(
  fileURLToPath(new URL('../public/utils/shared-board-notice.js', import.meta.url)),
  'utf8'
);

function load() {
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const ctx = { esc, encodeURIComponent };
  vm.createContext(ctx);
  vm.runInContext(src, ctx);
  return ctx;
}

const mirror = { planId: 'plan-github-board', readonly: 'github', repo: 'acme/app' };

describe('the shared board notice (KJC-TSK-1197)', () => {
  it('says it is the shared board, that kj hu changes it, and links to its issues', () => {
    const html = load().sharedBoardNoticeHtml([{ planId: 'plan-local' }, mirror]);
    expect(html).toContain('shared board');
    expect(html).toContain('kj hu move');
    expect(html).toContain('href="https://github.com/acme/app/issues?q=label%3Akj%3Ahu"');
    expect(html).toContain('rel="noopener"');
  });

  it('shows nothing when no plan of the project mirrors the shared board', () => {
    expect(load().sharedBoardNoticeHtml([{ planId: 'plan-local' }])).toBe('');
    expect(load().sharedBoardNoticeHtml([])).toBe('');
  });

  it('keeps the notice but drops the link when the repo is not a plain owner/name', () => {
    const html = load().sharedBoardNoticeHtml([{ ...mirror, repo: 'evil" onmouseover="x/app' }]);
    expect(html).toContain('shared board');
    expect(html).not.toContain('href=');
    expect(html).not.toContain('onmouseover="x');
  });
});
