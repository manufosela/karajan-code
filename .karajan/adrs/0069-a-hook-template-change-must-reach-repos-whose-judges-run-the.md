# A hook template change must reach repos whose judges run the older kj

Status: proposed
Date: 2026-11-28

## Context

The 5.41.0 release run stopped at the upgrade-path guard: the pre-push template changed (#4996). At the default level (critical) a seal that does not change who governs is not signed, so its hooks count only if the judge recomputes them; the base pinned kj 5.40.0 renders the old pre-push, so kj-policy.yml denies the seal PR (defaults.supervisor.write, no escape) and an upgraded repo could never merge its seal. Same for any repo without a phone.

## Decision

The maintainer chose A on 28-nov, but the cross review rejects the revert as a security regression
(the identity lock would trust stale remote-tracking refs again), and a security finding is never
overridden. Proposed instead (D): the seal goes in two steps. When a hook template changed and the
base's judge kj is older than this one, kj harden seals first only the workflow pin bump, which the
old judge accepts as a pin-only upgrade; the hooks are sealed by the next kj harden, once the base
runs this kj and can recompute them. Nobody is blocked, with or without a phone (#5032).

The options weighed before: (A) ship 5.41.0 without the pre-push template change and keep it for a release that carries the mechanism; (B) at critical, a seal that changes a hook bytes asks the phone, which old verifiers accept as a signed older seal, but repos with no phone stay blocked; (C) the verifier recomputes a hook with the kj version the seal names, fetched from npm.

## Consequences

A unblocks the release today and leaves #4808 point 4 open; B adds a phone signature per template change and does not cover phoneless repos; C is the general fix but adds a network fetch to the judge.
