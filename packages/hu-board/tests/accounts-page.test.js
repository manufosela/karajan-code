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

describe('rescue section (HU-4718)', () => {
  const RESCUE = {
    claude: { hasKey: true, rules: { when: { limit: true, window: { from: 9, to: 18 } }, roles: ['coder'], models: ['<b>x</b>'], dailyBudget: 5, monthlyBudget: 50 } },
    codex: { hasKey: false, rules: {} },
  };

  it('renders hasKey and the rules in words, markup staying text', () => {
    const [claude, codex] = load().renderRescue(RESCUE);
    expect(claude).toMatchObject({ provider: 'claude', hasKey: true });
    expect(claude.rules).toBe('on limit · between 9 and 18 · roles coder · models <b>x</b> · daily 5 · monthly 50');
    expect(codex).toMatchObject({ provider: 'codex', hasKey: false, rules: 'no rules' });
  });

  it('sends only the filled fields, typed', () => {
    const { rescueBody } = load();
    expect(rescueBody('claude', {})).toEqual({ provider: 'claude' });
    const body = rescueBody('codex', { limit: true, from: '9', to: '18', roles: 'coder, tester', models: '', daily: '5', monthly: '' });
    expect(JSON.parse(JSON.stringify(body))).toEqual({ provider: 'codex', limit: true, window: '9-18', roles: ['coder', 'tester'], daily: 5 });
  });

  it('leaves the window out when only one hour is filled', () => {
    const { rescueBody } = load();
    expect(rescueBody('claude', { from: '9', to: '' })).toEqual({ provider: 'claude' });
    expect(rescueBody('claude', { to: '18' })).toEqual({ provider: 'claude' });
  });
  it('has no key input, only the terminal hint, and routes through call()', () => {
    const js = read('accounts.js');
    expect(js).toContain('kj account rescue');
    expect(js).toContain('--key-stdin');
    expect(js).not.toMatch(/name:\s*"key"|type:\s*"password"/);
    expect(js).toContain('"rescue/remove"');
  });
});
