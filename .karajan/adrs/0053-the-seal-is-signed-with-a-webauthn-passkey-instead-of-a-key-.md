# The seal is signed with a WebAuthn passkey instead of a key kept in the browser

Status: proposed
Date: 2026-11-11

## Context

The maintainer raised it on 2026-11-11, while fixing #3887: why not a passkey, which now works everywhere, instead of the enrollment and the QR?

Today the signer is an Ed25519 key that the signer page (karajancode.com/sign) generates and keeps in its browser's IndexedDB. Consequences:

- Clearing the browser data, or opening the link in another browser, loses the key.
- Enrolling means copying a 44-character public key by hand.
- A signature needs only a tap, with no proof that a person is there.

Synced passkeys (WebAuthn, FIDO2) now work in every major browser and phone.

## Decision

Proposed; the maintainer decides.

1. **Credential.** A signer is a WebAuthn passkey:
   - rpId `karajancode.com`, origin `https://karajancode.com`;
   - `userVerification: "required"` on create and get, so each act asks for the fingerprint, face or PIN;
   - attestation `none`;
   - algorithms ES256 (-7) and Ed25519 (-8).

   The roster entry gains `type: "webauthn"`, `credentialId`, `publicKey` (SPKI, base64) and `alg`. An entry without `type` is today's Ed25519 key.
2. **Enrollment.** `kj identity enroll-phone` without a key posts a register request to the relay. The page runs `navigator.credentials.create` and returns the credential. Admission is unchanged:
   - no signer anywhere: the four human layers (bootstrap);
   - signers present: one of them signs the new entry, as in #3887;
   - or the recovery code.
3. **Signing.**
   - The challenge is the sha256 of today's canonical payload.
   - The page runs `navigator.credentials.get` with the roster credentials.
   - kj and CI verify it offline:
     - `clientDataJSON.type` is `webauthn.get`;
     - its challenge and origin are the expected ones;
     - the authenticatorData starts with sha256(rpId) and has the UP and UV flags;
     - the signature over `authenticatorData || sha256(clientDataJSON)` checks with the roster key.
   - The provenance stores `authenticatorData`, `clientDataJSON`, `signature` and `credentialId`.
   - The signature counter is not checked: synced passkeys report 0.
4. **Transition.**
   - Ed25519 entries keep signing and verifying.
   - A current signer moves to a passkey by enrolling it with a signature from the old key. The old key is then revoked.
   - Removing Ed25519 is a later decision.
5. **Order of the work** (epic KJC-PCS-0110): judges first.
   1. kj and CI verify a passkey assertion.
   2. The page registers and signs.
   3. Enrollment through the relay.
   4. The acts and the provenance carry the assertion.
   5. Migration and docs.
   6. Release and re-harden.

## Consequences

- The key is managed by the authenticator or passkey provider, not by the page. Whether it is hardware-bound depends on that authenticator and platform; requiring device-bound passkeys is the separate decision below. It survives clearing the browser and, when synced, follows the person to a new device. The "new laptop" loop of #3887 disappears for the owner.
- A collaborator is still admitted by a current signer: the passkey is theirs, the roster is the repo's.
- **Risks the maintainer weighs:**
  - A synced passkey is as safe as the cloud account it syncs through (Google, iCloud).
  - A passkey on the same laptop the agent runs on is out of the agent's reach only through the platform's biometric or PIN prompt.
  - The rpId ties every passkey to karajancode.com: moving the signer page to another domain means re-enrolling.
- **Open for the maintainer:**
  - Accept synced passkeys, or require device-bound ones (the BE/BS flags tell them apart).
  - Whether a passkey on the same machine is allowed.
  - When Ed25519 stops being accepted.
