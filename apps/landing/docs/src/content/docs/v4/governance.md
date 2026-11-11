---
title: Governance
description: Policy as code, exceptions that expire, a decision log you can verify and an identity lock. What Karajan enforces, and where.
---

The [gates](/docs/v4/gates/) check each change. Governance decides what an agent may do at all, records every decision it takes, and keeps exceptions visible. It rests on three things:

- a **policy**, written as code and tracked in git;
- **decisions**, sealed one after another in a hash chain;
- **exceptions**, each with a name, a reason and an expiry date.

## The policy: `.karajan/policy.yml`

The policy is a YAML file in your repo. Its vocabulary is closed: the engine only accepts what it can enforce.

```yaml
version: 1
roles:
  coder:
    write:
      deny: ["infra/**", ".github/**"]
      enforcement: deny
    shell:
      deny: ["git push*", "curl *"]
invariants:
  - id: loc-budget
    kind: diff-threshold
    metric: net_lines_added
    max: 200
    enforcement: warn
```

- **Roles** (`coder`, `reviewer`...) have two capabilities: `write` (file globs) and `shell` (command patterns, matched from the start of the command, `*` meaning anything).
- Each capability takes `allow` and `deny` lists. Deny wins over allow, and an `allow` list turns everything outside it into a denial.
- `enforcement` is `warn` (the default) or `deny`. `class: security` marks a rule that no exception and no arbitration can lift.
- **Invariants** check the whole diff. Today there is one kind: `diff-threshold` on `net_lines_added`.

A role, a capability, a key or a value the engine does not know is a load error, never a silent default: `kj policy` exits 1, the commit gate fails with `policy.load`, and the Sentinel denies until the file is fixed.

You do not have to learn the vocabulary to write a rule. Say it in your own words:

```sh
kj policy add "the coder may not touch the infra folder"
# proposes the diff to policy.yml; nothing is written without --yes
```

## Where it is enforced: three tiers

The same policy is checked at up to three moments. Which ones you get depends on your host and your CI.

| Tier | When | Requires | What it guarantees |
| --- | --- | --- | --- |
| A | Tool time | Claude Code as host, with Karajan's hooks | The Sentinel runs `kj policy eval --strict` on each tool call and stops a forbidden action before it happens. |
| B | Commit time | Any host | `kj review --staged` and the pre-commit hook check the staged diff. A commit that breaks a `deny` rule does not enter. |
| C | Merge time | GitHub Actions, seeded by `kj harden` | The `kj-policy.yml` workflow runs `kj policy check --range --strict` on the pull request. A violation blocks the merge. |

Tier B is the floor: it holds on every host. Security rules cannot be exempted at any tier. `kj doctor` tells you which tiers are active in your repo.

You can run the same checks by hand:

```sh
kj policy check                          # the staged diff; warns by default
kj policy check --range main...HEAD --strict   # what CI runs: exit 2 on a deny
kj policy eval --tool Write --input '{"file_path":"infra/main.tf"}'   # one tool call: {decision, rule_id, reason}
```

`kj policy eval` is the contract for hook adapters: any host that can call a command before a tool runs can use it.

## Exceptions that expire

Sometimes a rule has to give way for a while. `kj policy grant` records that, in the open:

```sh
kj policy grant --rule roles.coder.write.deny \
  --until 2026-12-01T00:00:00Z \
  --reason "the deploy scripts move to infra/ this sprint"
```

- All three flags are required, and `--until` is a strict ISO-8601 date. Once it passes, the gate stops honouring the exception on its own.
- Security rules and Karajan's built-in defaults cannot be granted, and nothing can be granted while the policy file is invalid.
- Grants are appended to `.karajan/policy-exceptions.jsonl`. With `--global` they go to `~/.karajan` and apply to every project on your machine.
- Each grant records who made it, from your git and system user. That identity is declared, not authenticated: the record tells you who said they granted it.

**Renewal is a signal.** From the second grant on the same rule, kj warns that an exception that keeps being renewed is no longer an exception: either the rule is wrong or the work is. `kj policy report` lists it too.

## The decision log

Every deny, every exemption and each commit's allow is written to `.karajan/policy-decisions.jsonl`. Each entry carries the sha256 of the one before, the policy's hash and the hash of what was decided on, so changing or deleting a past entry breaks the chain.

```sh
kj policy report    # warnings, denials and exemptions per rule, open denials,
                    # live / expiring / expired grants, and the signals
kj policy anchor    # verifies the chain and seals its head in .karajan/policy-anchor.json
```

The log stays on your machine. The anchor is tracked in git, so each anchor commit fixes the state of the chain in the repo's history: a log rewritten afterwards no longer matches it. A broken chain makes `kj policy report` say where it breaks and exit 1, and `kj policy anchor` refuses to seal it.

## The identity lock

Many developers work with more than one GitHub account. The identity lock binds each clone to one:

```sh
kj identity set     # declares this clone's gh account and git email
kj identity show    # declared vs active; exit 2 on a mismatch or when undeclared
```

The declaration lives in `.karajan/identity.local.yml` and is never tracked. With it in place:

- the Sentinel stops `gh` (and per-account wrappers such as `gh-<account>`) when no identity is declared or the active account is not the declared one;
- the pre-commit hook checks the author and committer email;
- the pre-push hook checks every commit it is about to send.

There is no escape: if the identity is wrong, you switch accounts, not the lock.

## The kernel: `@karajan-family/governance`

The engine behind all of this is its own package in the Karajan family. It knows three things, Policy, Decision and Exception, and nothing about git, diffs or any agent's tools: it parses the policy, evaluates writes and commands, checks artifacts, records decisions and exceptions, and verifies the chain. It does no I/O and calls no model, so the same policy gives the same answer every time. Karajan Code is its first consumer, not its owner.

## See also

- [The gates](/docs/v4/gates/): the review gate and the other git gates.
- [The Sentinel](/docs/guides/sentinel/): what it stops at tool time, and why.
- [Hardening against AI](/docs/guides/hardening-against-ai/): what an agent cannot weaken.
