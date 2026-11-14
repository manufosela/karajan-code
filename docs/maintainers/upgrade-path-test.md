# Upgrade-path test (KJC-TSK-1619)

Before a release, prove that a repo hardened with the previous published kj can take the
candidate: re-harden, seal, and the seal PR passes every judge. On 14-nov a team's seal PR could
not pass its `secrets` check, because the judges run with the base's pinned kj
(`pull_request_target`), and that older kj lacked what the new workflow used. kj must never
leave a user's repo blocked.

## Run it

It needs the network (npm), so it is skipped unless asked for:

```sh
KJ_UPGRADE_PATH=1 npx vitest run tests/e2e/upgrade-path.test.js
```

## What it does

1. Reads from the registry the newest published version below this checkout's `package.json`
   version, and installs it as the judge workflows install the base's pinned kj.
2. Creates a temp repo on `main`, hardens it with that previous kj, enrolls a test signer roster
   and commits a seal signed by a throwaway test key (never a real key, never the phone).
3. On a branch, re-hardens with this checkout (`bin/kj.js`), merges the generated contract and
   leaves the seal as the PR's only commit, signed with the same test key.
4. Runs every judge of that seal PR, with the previous kj (as CI would) and with this checkout:
   `kj privacy scan --range main...<branch>` from the base's checkout,
   `kj policy check --range main...HEAD --strict` from the PR's tree, and the verify-pr check
   (`verifyPrReview`, with GitHub faked: no published review) on the seal-only rule.

## Reading a failure

Each failing judge is named with the kj version that ran it and its full output. A line starting
with `BLOCKS USERS` means a judge fails with the previous kj and passes with the candidate: only a
newer base fixes it, so releasing the candidate would leave repos pinned to the previous version
unable to merge their seal PR. Do not release until that is solved.

Wiring this test into the release workflow is a later, sealed step.
