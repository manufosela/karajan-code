// Production verifier: Google ID tokens checked against Google's keys with
// google-auth-library. Kept in its own module so tests never import it.
import { OAuth2Client } from "google-auth-library";

/**
 * Signature, issuer and expiry are Google's business; the AUDIENCE is checked by
 * createAuth against console.config.json so the `wrong_audience` refusal stays
 * ours (review catch: passing it here would surface as invalid_token).
 * @returns {(token: string) => Promise<object>} the payload (email, email_verified, hd, aud, sub).
 */
export function createGoogleVerifier() {
  const client = new OAuth2Client();
  return async (token) => (await client.verifyIdToken({ idToken: token })).getPayload();
}
