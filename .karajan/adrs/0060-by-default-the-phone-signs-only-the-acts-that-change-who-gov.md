# By default the phone signs only the acts that change who governs; paranoid mode signs every act

Status: accepted
Date: 2026-11-16

## Context

ADR 0018 made `max` the default level: every act of the catalog of human acts is signed on the phone, in every repo. The catalog has grown to nine acts (seal, rules approve, enroll the phone, lower the level, loosen a gate, the main-guard exception, hooks set, release approve, handoff run). Two of them multiply the signatures:

- **The seal.** Every kj version that changes the files kj generates (hooks, the Sentinel) asks every repo for a new signed seal, even when the project changed nothing.
- **Release approve.** A release is signed on the phone and then approved again in GitHub ("Review deployments" of the npm environment).

The maintainer signs in every project at every kj release, and users of kj meet the same wall. The maintainer asked for this on 2026-11-16: sign only what is critical by default, and keep a paranoid mode that signs everything as today.

## Decision

Three levels, in `.karajan/security-level.json`:

- **`critical`, the new default.** The phone signs only the acts that change who governs: enrolling a phone, lowering the level, loosening a gate, and the main-guard exception. The other acts (rules approve, hooks set, release approve, handoff run, and a seal) are confirmed by a person at their own terminal, with the layers of ADR 0009 (typed by hand, never from an agent's process).
- **`max`, the paranoid mode.** Every act of the catalog is signed on the phone, as today. `kj security max` turns it on, with no signature (going up is free).
- **`normal`.** Every act, including the critical ones, is confirmed at the terminal, with no phone. Going down to it stays a signed act.

A seal is renewed **without a person** when what changed is only what kj generates: kj regenerates the harness with the installed version, checks that it is the published package (its version and integrity on npm) and that the project's own inputs (policy, rules, sealed files) are byte for byte those of the last seal, and commits the renewal naming the kj version. Anything else in the seal is an act of the level in force.

Publishing keeps one human gate: the approval of the npm environment in GitHub. `kj release approve` stays the act that tags the candidate, confirmed at the terminal at `critical` and signed at `max`.

A repo whose record already says `max` stays paranoid; a repo with no record moves to `critical`.

## Consequences

A new kj version no longer asks every repo for a signature, and a release asks for one approval. What changes who governs is still signed on the phone by default. Whoever wants today's guarantee writes `max` once per repo. A kj package that is not the published one never renews a seal by itself. The implementation is split into PRs: the levels and the catalog's signing rule first, then the seal renewal, then the docs.
