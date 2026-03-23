import { describe, it, expect } from 'vitest';
import { validateDNI } from './validateDNI.js';

describe('validateDNI', () => {
  it('returns valid for a correct DNI', () => {
    // 12345678Z is valid: 12345678 % 23 = 14 → letter 'Z'
    expect(validateDNI('12345678Z')).toEqual({ valid: true, error: null });
  });

  it('is case-insensitive', () => {
    expect(validateDNI('12345678z')).toEqual({ valid: true, error: null });
  });

  it('returns error for wrong letter', () => {
    const result = validateDNI('12345678A');
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/letra/i);
  });

  it('returns error for invalid format - too few digits', () => {
    const result = validateDNI('1234567Z');
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/formato/i);
  });

  it('returns error for invalid format - too many digits', () => {
    const result = validateDNI('123456789Z');
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/formato/i);
  });

  it('returns error for invalid format - no letter', () => {
    const result = validateDNI('123456789');
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/formato/i);
  });

  it('returns error for empty input', () => {
    const result = validateDNI('');
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/formato/i);
  });

  it('returns error for null/undefined', () => {
    expect(validateDNI(null).valid).toBe(false);
    expect(validateDNI(undefined).valid).toBe(false);
  });

  it('validates several known-good DNIs', () => {
    // 00000000T → 0 % 23 = 0 → 'T'
    expect(validateDNI('00000000T')).toEqual({ valid: true, error: null });
    // 99999999R → 99999999 % 23 = 3 → 'R'
    expect(validateDNI('99999999R')).toEqual({ valid: true, error: null });
  });

  it('rejects DNI with spaces or special chars', () => {
    const result = validateDNI('1234 678Z');
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/formato/i);
  });
});
