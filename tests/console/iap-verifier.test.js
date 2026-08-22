// C1-IAP (KJC-TSK-0798, ADR 0007) — the IAP assertion is VERIFIED, never trusted:
// signature against Google's keys, audience of this service, IAP as issuer. Keys
// rotate, so an unknown key is refetched once; a verification that cannot be
// completed is a refusal.
import { describe, it, expect, vi } from "vitest";
import { createIapVerifier, IAP_HEADER } from "../../packages/console/src/iap-verifier.js";

const AUD = "/projects/123456789/locations/europe-west1/services/atlas-console";
const payload = { email: "someone@example.com", hd: "example.com", sub: "42" };
// Google's keys rotate: `stale` holds the ones that stopped being valid.
const fakeClient = () => {
  let served = 0;
  const stale = new Set();
  return {
    stale,
    getIapPublicKeys: vi.fn(async () => ({ pubkeys: { k: `key-${(served += 1)}` } })),
    verifySignedJwtWithCertsAsync: vi.fn(async (token, certs, audience, issuers) => {
      if (audience !== AUD) throw new Error(`wrong audience ${audience}`);
      if (!issuers.includes("https://cloud.google.com/iap")) throw new Error("wrong issuer");
      if (stale.has(certs.k)) throw new Error("unknown key");
      if (token !== "good") throw new Error("invalid signature");
      return { getPayload: () => payload };
    }),
  };
};

describe("iap verifier (C1-IAP)", () => {
  it("verifies against the service audience and IAP as issuer, and caches the keys", async () => {
    const client = fakeClient();
    const verify = createIapVerifier({ audience: AUD, client });
    expect(await verify("good")).toEqual(payload);
    expect(await verify("good")).toEqual(payload);
    expect(client.getIapPublicKeys).toHaveBeenCalledTimes(1); // fetched once, reused
    const [, , audience, issuers] = client.verifySignedJwtWithCertsAsync.mock.calls[0];
    expect(audience).toBe(AUD);
    expect(issuers).toEqual(["https://cloud.google.com/iap"]);
    expect(IAP_HEADER).toBe("x-goog-iap-jwt-assertion");
  });

  it("when the cached key rotates, it is refetched ONCE and the good token still verifies", async () => {
    const client = fakeClient();
    const verify = createIapVerifier({ audience: AUD, client });
    await verify("good");
    client.stale.add("key-1"); // Google rotated while we held it
    expect(await verify("good")).toEqual(payload);
    expect(client.getIapPublicKeys).toHaveBeenCalledTimes(2);
  });

  it("a token that does not verify is refused, and the refusal is not retried forever", async () => {
    const client = fakeClient();
    const verify = createIapVerifier({ audience: AUD, client });
    await expect(verify("forged")).rejects.toThrow(/invalid signature/);
    expect(client.getIapPublicKeys).toHaveBeenCalledTimes(1);
    await expect(verify("forged")).rejects.toThrow(/invalid signature/);
    expect(client.getIapPublicKeys).toHaveBeenCalledTimes(2); // one refetch per attempt, never a pass
  });

  it("without an audience it refuses to exist: any token of the organisation would be accepted", () => {
    expect(() => createIapVerifier({ audience: "", client: fakeClient() })).toThrow(/audience of this service is required/);
  });
});
