import { describe, it, expect } from 'vitest';
import { isTailscalePeer } from '../src/tailscale-peer.js';

describe('isTailscalePeer', () => {
  it('trusts a tailnet peer that reached a tailnet address of this machine', () => {
    expect(isTailscalePeer('100.101.2.3', '100.116.55.77')).toBe(true);
    expect(isTailscalePeer('::ffff:100.101.2.3', '::ffff:100.116.55.77')).toBe(true);
    expect(isTailscalePeer('fd7a:115c:a1e0::1', 'fd7a:115c:a1e0::2')).toBe(true);
  });

  it('covers the whole 100.64.0.0/10 range and nothing beside it', () => {
    expect(isTailscalePeer('100.64.0.1', '100.127.255.254')).toBe(true);
    expect(isTailscalePeer('100.63.255.255', '100.116.55.77')).toBe(false);
    expect(isTailscalePeer('100.128.0.1', '100.116.55.77')).toBe(false);
  });

  it('does not trust a tailnet-looking peer that came in through another interface', () => {
    expect(isTailscalePeer('100.101.2.3', '192.168.1.20')).toBe(false);
    expect(isTailscalePeer('100.101.2.3', '0.0.0.0')).toBe(false);
  });

  it('does not trust LAN peers or missing addresses', () => {
    expect(isTailscalePeer('192.168.1.30', '100.116.55.77')).toBe(false);
    expect(isTailscalePeer(undefined, '100.116.55.77')).toBe(false);
    expect(isTailscalePeer('100.101.2.3', undefined)).toBe(false);
    expect(isTailscalePeer('fd7a:115c:a1e1::1', 'fd7a:115c:a1e0::2')).toBe(false);
  });
});
