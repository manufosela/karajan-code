// C1-IAP (KJC-TSK-0798, ADR 0007) — identity behind Identity-Aware Proxy.
// IAP puts a signed assertion (ES256) in `x-goog-iap-jwt-assertion`; the console
// VERIFIES it against Google's public keys and the audience of THIS service. It
// never trusts the header for coming from a proxy: reaching the service by any
// other path must not grant entry. Keys rotate, so an unknown key is refetched
// once — but a verification that cannot be completed is a refusal, never a pass.
import { OAuth2Client } from "google-auth-library";

export const IAP_HEADER = "x-goog-iap-jwt-assertion";
const ISSUER = "https://cloud.google.com/iap";

/**
 * @param {{audience: string, client?: {getIapPublicKeys: Function, verifySignedJwtWithCertsAsync: Function}}} deps
 * @returns {(token: string) => Promise<object>} the verified payload (email, sub, hd, aud, exp).
 *   IAP does not emit `email_verified`: the account was authenticated by Google before reaching us.
 */
export function createIapVerifier({ audience, client = new OAuth2Client() }) {
  if (!audience) throw new TypeError("createIapVerifier: the audience of this service is required — without it any IAP token of the organisation would be accepted");
  let keys = null;
  const fetchKeys = async () => {
    keys = (await client.getIapPublicKeys()).pubkeys;
    return keys;
  };
  return async (token) => {
    const verify = async (certs) => (await client.verifySignedJwtWithCertsAsync(token, certs, audience, [ISSUER])).getPayload();
    const cached = keys !== null;
    try {
      return await verify(cached ? keys : await fetchKeys());
    } catch (err) {
      // A rotated key makes a good token look forged: refetch ONCE and try again. Keys just
      // fetched are not refetched — that would only hide a genuinely invalid token behind retries.
      if (!cached) throw err;
      keys = null;
      return verify(await fetchKeys());
    }
  };
}
