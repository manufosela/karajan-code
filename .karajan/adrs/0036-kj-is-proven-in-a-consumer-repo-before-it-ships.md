# kj is proven in a consumer repo before it ships; every control point has a threat model; the Sentinel judges by write verb

Status: accepted
Date: 2026-10-28

## Context

On 2026-10-28 eleven bugs came up in one day. About eight came from how kj is designed or verified, not from rare corner cases, and they share three causes:

1. **What kj writes into other repos was tested as text, never run there.** The tests checked that the `kj-policy.yml` template said the right things; nobody ran it in a consumer repo. So the CI policy check never worked outside kj's own repo (`npx` could not tell which binary to run, issue #2666), it pinned an unpublished version (issue #2664), the PR that moves its trigger could never report the required check (KJC-BUG-0424), and a PR could rewrite its own judge (GHSA-3xrh-frxv-mwxr). Everything was green in karajan-code.
2. **Nobody asked who controls the judge's code.** The policy check ran the PR's own copy of its workflow: the judged controlled the judge.
3. **The Sentinel judges a command by its text.** Naming a supervisor path (in a PR description, issue #2679) counts as writing it: a family of false positives that has come back several times.

The user decided the remedy on 2026-10-28, one decision at a time.

## Decision

1. **The consumer repo is `kj-demo-harden`.** It is already a repo that consumes kj apart from karajan-code.
2. **It runs before every publish and blocks.** A release whose consumer run is red is not published.
3. **It checks real PRs and the install.** After `kj harden` there: a normal PR passes, a PR that edits `.karajan/policy.yml` is red, and a PR that rewrites `kj-policy.yml` cannot disable the judge. And a clean global install with the current npm leaves `kj doctor` green. The phone seal cannot be automated and stays out.
4. **The maintainer's session runs it with a local command** (`kj release canary`), with the gh session of the account that owns the repos, before asking for the OTP. No new secret goes into CI. The test PRs are closed and their branches deleted when it ends.
5. **`docs/threat-model.md` is a living threat model.** Each control point (hooks, Sentinel, CI, seal, review) says where its judge runs, who controls the judge's code and what a PR or the agent can change. A PR that adds or changes a gate updates its entry, and the cross-AI review checks it.
6. **The Sentinel's guards decide by write verb.** They block when a command writes to the guarded paths (redirection, `cp`, `mv`, `rm`, `sed -i`, `git checkout`/`git restore` of those paths...), not when it only names them. A command that cannot be analysed is still denied (fail closed). The supervisor guard goes first, with real-write counterexamples in its tests.

## Alternatives considered

- **A dedicated canary repo** (recommended at the time): keeps the talk demo free of test PRs. The user chose `kj-demo-harden`.
- **A nightly run on main instead of a release gate**: it warns a day late and does not stop a broken publish.
- **A GitHub Actions workflow for the canary**: fully automatic, but karajan-code would store a token or a GitHub App with rights over another repo.
- **A one-off security audit instead of a living threat model**: faster today, but the next gate would be born with the same blind spot.
- **A narrow exemption for gh and git commit text instead of write verbs**: fixes issue #2679 alone and leaves the family of false positives.
- **Greenfield**: a consumer repo with its own CI that installs every kj tag and reports back. It is the same idea with more moving parts (cross-repo triggers and a token); the local command reaches the same evidence without them.

## Consequences

- A release gains a step before the OTP and takes longer (the consumer PRs wait for their CI).
- `kj-demo-harden` gets test PRs at each release (closed and cleaned up), and it must stay hardened and sealed with the current kj.
- The canary acts on another repo through GitHub and a temporary clone, never through another session's working tree. That crossing is this decision's, made by the user.
- Work: KJC-TSK-1263 (the canary), KJC-TSK-1264 (the threat model and its review rule), KJC-BUG-0425 (guards by write verb, from issue #2679).
