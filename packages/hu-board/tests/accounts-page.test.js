// HU-4683: the accounts page. accounts.js is a classic browser script (no exports), so the
// test loads it into a node:vm context whose document has no #accounts-app (no boot).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const read = (name) => readFileSync(fileURLToPath(new URL(`../public/${name}`, import.meta.url)), 'utf8');

function load() {
  const ctx = { document: { getElementById: () => null }, location: { search: '' }, localStorage: { getItem: () => null }, URLSearchParams };
  vm.createContext(ctx);
  vm.runInContext(read('accounts.js'), ctx);
  return ctx;
}

const PAYLOAD = {
  accounts: [
    { id: 'work', provider: 'claude', dir: '/home/me/.claude-work', pace: { gap: 5, max: 3 } },
    { id: '<script>x</script>', provider: 'codex', dir: '/tmp/<b>', pace: undefined },
  ],
  default: { claude: 'work' },
  projects: { app: { claude: ['work'] } },
};

describe('accounts page (HU-4683)', () => {
  it('links its script and the stylesheet, with a nav back to the board', () => {
    const html = read('accounts.html');
    expect(html).toContain('src="/accounts.js"');
    expect(html).toContain('href="/styles.css"');
    expect(html).toContain('href="/"');
  });

  it('is linked from the board nav beside Usage', () => {
    expect(read('index.html')).toContain('href="/accounts.html"');
  });

  it('has no field for a key', () => {
    expect(read('accounts.html') + read('accounts.js')).not.toMatch(/api[-_ ]?key|secret|token-input/i);
  });

  it('turns the payload into rows whose fields stay text', () => {
    const { rows, orders } = load().renderAccounts(PAYLOAD);
    expect(rows[0]).toMatchObject({ id: 'work', provider: 'claude', dir: '/home/me/.claude-work', isDefault: true });
    expect(rows[0].pace).toBe('gap 5 · max 3');
    expect(rows[1]).toMatchObject({ id: '<script>x</script>', isDefault: false, pace: 'default pace' });
    expect(orders).toEqual([{ project: 'app', provider: 'claude', ids: ['work'] }]);
  });

  it('builds the DOM with textContent, never innerHTML', () => {
    expect(read('accounts.js')).not.toContain('innerHTML');
  });
});
