// KJC-BUG-0076 — guard against CWE-915 (prototype pollution) in the
// dot-path mutators used by writeConfigPatch. The deterministic audit
// flagged setDeep/deleteDeep as HIGH because a crafted YAML key like
// `__proto__.polluted` would walk into Object.prototype. The guard
// silently skips writes whose path contains __proto__, constructor or
// prototype, so the rest of the patch still lands.
import { describe, expect, it, afterEach } from 'vitest';
import { __pollutionInternals } from '../src/config-yaml.js';

const { setDeep, deleteDeep } = __pollutionInternals;

describe('config-yaml prototype pollution guards', () => {
  afterEach(() => {
    // Belt-and-suspenders: scrub any pollution a failing test might
    // leave behind so it does not leak to the next test file.
    delete Object.prototype.polluted;
    delete Object.prototype.viaConstructor;
    delete Object.prototype.viaPrototype;
  });

  it('setDeep refuses to walk into __proto__', () => {
    const obj = {};
    setDeep(obj, '__proto__.polluted', 'pwned');
    expect(({}).polluted).toBeUndefined();
    expect(obj.polluted).toBeUndefined();
  });

  it('setDeep refuses to walk into constructor.prototype', () => {
    const obj = {};
    setDeep(obj, 'constructor.prototype.viaConstructor', 'pwned');
    expect(({}).viaConstructor).toBeUndefined();
  });

  it('setDeep refuses to walk into prototype', () => {
    const obj = {};
    setDeep(obj, 'prototype.viaPrototype', 'pwned');
    expect(({}).viaPrototype).toBeUndefined();
  });

  it('setDeep still writes safe nested paths', () => {
    const obj = {};
    setDeep(obj, 'foo.bar.baz', 42);
    expect(obj.foo.bar.baz).toBe(42);
  });

  it('deleteDeep refuses to remove keys on Object.prototype', () => {
    Object.prototype.polluted = 'sentinel';
    const obj = {};
    deleteDeep(obj, '__proto__.polluted');
    expect(({}).polluted).toBe('sentinel');
    delete Object.prototype.polluted;
  });

  it('deleteDeep still removes safe nested keys', () => {
    const obj = { foo: { bar: 'gone' } };
    deleteDeep(obj, 'foo.bar');
    expect(obj.foo.bar).toBeUndefined();
  });
});
