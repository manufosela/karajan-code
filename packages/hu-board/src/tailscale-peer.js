/**
 * Tailscale peers (KJC-TSK-1465).
 *
 * Tailscale already authenticates every device on the tailnet with its own
 * key, so a request that travels over it needs no board token on top. The
 * user asked for it: the token was an extra step on every device for no gain.
 *
 * Both ends must be tailnet addresses. A peer address alone is not enough:
 * with `--bind 0.0.0.0`, a request from a 100.64.0.0/10 address could arrive
 * through another interface (carrier-grade NAT uses the same range), and that
 * one keeps needing the token.
 */

const MAPPED_V4 = '::ffff:';
/** Tailscale's IPv6 ULA prefix, fd7a:115c:a1e0::/48. */
const TAILNET_V6 = /^fd7a:115c:a1e0:/i;

/**
 * @param {string|undefined} address
 * @returns {boolean} whether it is a Tailscale address (100.64.0.0/10 or its IPv6 prefix)
 */
function isTailnetAddress(address) {
  if (typeof address !== 'string') return false;
  if (TAILNET_V6.test(address)) return true;
  const v4 = address.startsWith(MAPPED_V4) ? address.slice(MAPPED_V4.length) : address;
  const octets = v4.split('.').map(Number);
  if (octets.length !== 4 || octets.some((n) => !Number.isInteger(n))) return false;
  return octets[0] === 100 && octets[1] >= 64 && octets[1] <= 127;
}

/**
 * @param {string|undefined} remote the peer's address
 * @param {string|undefined} local the address of this machine the request reached
 * @returns {boolean} true when the request came over the tailnet
 */
export function isTailscalePeer(remote, local) {
  return isTailnetAddress(remote) && isTailnetAddress(local);
}
