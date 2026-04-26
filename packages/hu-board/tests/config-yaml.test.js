import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import yaml from 'js-yaml';
import { readConfig, writeConfigPatch, EDITABLE_FIELDS } from '../src/config-yaml.js';

let tmpHome;
let savedKjHome;

beforeEach(() => {
  tmpHome = join(tmpdir(), `kj-cfg-${process.pid}-${Date.now()}`);
  mkdirSync(tmpHome, { recursive: true });
  savedKjHome = process.env.KJ_HOME;
  process.env.KJ_HOME = tmpHome;
});

afterEach(() => {
  if (savedKjHome === undefined) delete process.env.KJ_HOME;
  else process.env.KJ_HOME = savedKjHome;
  try { rmSync(tmpHome, { recursive: true, force: true }); } catch { /* ignore */ }
});

function writeYml(content) {
  writeFileSync(join(tmpHome, 'kj.config.yml'), content, 'utf8');
}
function readYmlBack() {
  return yaml.load(readFileSync(join(tmpHome, 'kj.config.yml'), 'utf8'), { json: true });
}

describe('readConfig', () => {
  it('returns sensible defaults when the file does not exist yet', () => {
    const cfg = readConfig();
    expect(cfg.exists).toBe(false);
    expect(cfg.fields.length).toBe(EDITABLE_FIELDS.length);
    const coder = cfg.fields.find(f => f.key === 'coder');
    expect(coder.value).toBe('claude');     // default
  });

  it('reads existing values from the yml', () => {
    writeYml('coder: codex\nreviewer: claude\nsession:\n  max_iteration_minutes: 5\n');
    const cfg = readConfig();
    expect(cfg.exists).toBe(true);
    expect(cfg.fields.find(f => f.key === 'coder').value).toBe('codex');
    expect(cfg.fields.find(f => f.key === 'reviewer').value).toBe('claude');
    expect(cfg.fields.find(f => f.key === 'maxIterationMinutes').value).toBe(5);
  });

  it('derives modelMode=auto when no roles.<r>.model is set', () => {
    writeYml('coder: claude\n');
    const cfg = readConfig();
    expect(cfg.fields.find(f => f.key === 'modelMode').value).toBe('auto');
  });

  it('derives modelMode=sonnet when every role pins sonnet', () => {
    writeYml(`coder: claude\nroles:\n  coder: { model: sonnet }\n  reviewer: { model: sonnet }\n  planner: { model: sonnet }\n  architect: { model: sonnet }\n  triage: { model: sonnet }\n  researcher: { model: sonnet }\n  tester: { model: sonnet }\n  security: { model: sonnet }\n  refactorer: { model: sonnet }\n  impeccable: { model: sonnet }\n`);
    const cfg = readConfig();
    expect(cfg.fields.find(f => f.key === 'modelMode').value).toBe('sonnet');
  });
});

describe('writeConfigPatch', () => {
  it('writes a fresh yml when the file does not exist', () => {
    const r = writeConfigPatch({ coder: 'codex', maxIterationMinutes: 10 });
    expect(r.written).toBe(true);
    expect(r.errors).toEqual([]);
    const yml = readYmlBack();
    expect(yml.coder).toBe('codex');
    expect(yml.session.max_iteration_minutes).toBe(10);
  });

  it('preserves unrelated keys (whitelist semantics)', () => {
    writeYml('coder: claude\nbecaria:\n  enabled: true\n  custom_field: kept\n');
    const r = writeConfigPatch({ coder: 'codex' });
    expect(r.written).toBe(true);
    const yml = readYmlBack();
    expect(yml.coder).toBe('codex');
    expect(yml.becaria).toEqual({ enabled: true, custom_field: 'kept' });
  });

  it('rejects unknown keys', () => {
    const r = writeConfigPatch({ doesNotExist: 'foo' });
    expect(r.written).toBe(false);
    expect(r.errors[0]).toMatch(/Campo desconocido/);
  });

  it('rejects out-of-range numbers', () => {
    const r = writeConfigPatch({ maxIterationMinutes: 9999 });
    expect(r.written).toBe(false);
    expect(r.errors[0]).toMatch(/máximo/);
  });

  it('rejects invalid select values', () => {
    const r = writeConfigPatch({ coder: 'gpt-99' });
    expect(r.written).toBe(false);
    expect(r.errors[0]).toMatch(/Permitidos/);
  });

  it('modelMode=sonnet pins every editable role to sonnet', () => {
    const r = writeConfigPatch({ modelMode: 'sonnet' });
    expect(r.written).toBe(true);
    const yml = readYmlBack();
    expect(yml.roles.coder.model).toBe('sonnet');
    expect(yml.roles.reviewer.model).toBe('sonnet');
    expect(yml.roles.planner.model).toBe('sonnet');
  });

  it('modelMode=auto removes the role.model overrides without nuking other role keys', () => {
    writeYml(`coder: claude\nroles:\n  coder: { model: sonnet, provider: claude }\n  reviewer: { model: sonnet }\n`);
    const r = writeConfigPatch({ modelMode: 'auto' });
    expect(r.written).toBe(true);
    const yml = readYmlBack();
    expect(yml.roles.coder.model).toBeUndefined();
    expect(yml.roles.coder.provider).toBe('claude');     // preserved
    // Empty role objects get cleaned up
    expect(yml.roles.reviewer).toBeUndefined();
  });

  it('keeps a .bak file when overwriting', () => {
    writeYml('coder: claude\n');
    writeConfigPatch({ coder: 'codex' });
    expect(existsSync(join(tmpHome, 'kj.config.yml.bak'))).toBe(true);
    expect(readFileSync(join(tmpHome, 'kj.config.yml.bak'), 'utf8')).toMatch(/coder: claude/);
  });

  it('is atomic (no partial write on validation error)', () => {
    writeYml('coder: claude\n');
    const r = writeConfigPatch({ coder: 'codex', doesNotExist: 'foo' });
    expect(r.written).toBe(false);
    // Original file untouched.
    expect(readFileSync(join(tmpHome, 'kj.config.yml'), 'utf8')).toMatch(/coder: claude/);
  });
});
