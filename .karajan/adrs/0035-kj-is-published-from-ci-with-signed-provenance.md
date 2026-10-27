# kj is published from CI with signed provenance

Status: proposed
Date: 2026-10-27

## Context

Today a kj release is published from the maintainer's machine: `git archive` of the tag into a clean folder, `verify-pack`, then `npm publish` of both names (`karajan-code` and `@karajan-family/code`) with a one-time password. The SEA binaries are built by the Release SEA Binaries workflow on the tag. Nothing lets a user check that the package they install was built from that tag and not altered on the way: npm can only attach provenance (a Sigstore-signed attestation of the repo, commit and workflow that built the package) when the package is published from a supported CI, never from a laptop. The local flow also depends on a live npm session: on 2026-10-27 the session had expired and the 4.70.0 publish failed until the maintainer logged in again.

The user asked (2026-10-27) to sign kj's releases so they can be verified, for 5.0.0.

## Decision (proposed)

1. A release workflow publishes on the tag (`v*`), from that tag's tree: install, the full suite, `verify-pack`, the privacy scan of the tarball, then `npm publish --provenance` of both names.
2. npm trusted publishing (OIDC) authorises the workflow: no npm token is stored in the repo and no one-time password is needed. Each package is configured on npmjs.com to trust only this repo and this workflow file.
3. A protected GitHub environment (`npm-publish`) with the maintainer as required reviewer guards the publish job: a human still says yes, in GitHub instead of with an OTP.
4. The SEA binaries get a build provenance attestation (`actions/attest-build-provenance`) next to their checksums.
5. Users verify with `npm audit signatures` (which `kj audit --security` already runs, KJC-TSK-1253) and `gh attestation verify <binary> --repo manufosela/karajan-code`. The README and the landing say how.

## Alternatives considered

- **Keep publishing locally with an OTP.** Simplest and works today, but no provenance is possible and it depends on the maintainer's npm session.
- **Sign the tarballs by hand with cosign and attach the signatures to the GitHub release.** Possible locally, but npm does not show or check those signatures, so `npm install` users get nothing; it adds a key to guard.
- **Greenfield: CI publishing with provenance and trusted publishing (chosen).** It is what npm and GitHub verify natively, it removes the stored token and the OTP, and the environment review keeps the human gate.

## Consequences

- Only the maintainer can do the setup: the trusted publisher on npmjs.com for both packages, the `npm-publish` environment and its reviewer, and sealing the new workflow (workflows enter only sealed, `kj harden --commit`).
- A release becomes: tag, push, approve the environment. The release checklist and the memory of how kj is published change accordingly.
- Off-tag 4.x releases (cut from an earlier tag) work the same, since the trigger is the tag.
- A failed publish job can be re-run; the local flow stays documented as the fallback while trusted publishing is not configured.
