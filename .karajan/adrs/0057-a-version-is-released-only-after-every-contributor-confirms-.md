# A version is released only after every contributor is asked, none holds it, and a human approves it

The confirmation is an objection window, not a unanimous vote: each participant can confirm, hold or ask to include work, and silence after the deadline counts as no objection.

Status: accepted
Date: 2026-11-13

## Context

kj now serves teams: several people, each with several agents, on one repo or monorepo. Today one session decides a release on its own: teammates with open lanes, open PRs or merged work learn about it after npm has it, and nobody checks that their part still works on the release candidate. The 5.22.0 release was being cut this way (2026-11-13) while a contributor and the kj-stage session had work in flight. The maintainer asked that every person developing with kj on a project learn that a release is wanted, say which part of theirs goes out, check that it is compatible, and that a human approve and publish it.

## Decision

Accepted by the maintainer on 2026-11-13, with the answers below. A release is a coordinated act in three stages. (1) Propose: kj release propose <version> opens a GitHub issue labelled release, the one channel every contributor of a repo shares (the shared HU Board already lives on GitHub Issues). It lists the commits since the last tag grouped by author and lane (what goes out) and the open lanes and PRs that stay out, mentions each of those authors, and live boards show it through the kj stage room. (2) Confirm: each participant answers from their own session with kj release ack ok, or hold with a reason, or include #PR. Their agent runs the compatibility check: the full suite on the candidate commit and their open lane rebased onto it, and the ack records the result. (3) Approve: a human with a signer in the roster runs kj release approve, a human act signed with the passkey and never run from an agent. Only then is the tag created; release-npm.yml refuses a tag without that signed approval or with a hold still open. Alternatives: a Planning Game card (not every team uses PG); only the kj stage room (live but ephemeral, a person offline misses it); greenfield, a release-please style release PR with CODEOWNERS reviews (reuses GitHub, but reviews only humans by path and sees neither open lanes nor agent compatibility checks). The GitHub issue plus signed approval wins because it reaches everyone with repo access, keeps a durable record, and binds the publish to a human act that CI can verify. 

The maintainer's answers (2026-11-13):

- **Deadline: 4 hours.** A participant who has not answered 4 hours after the proposal counts as no objection. A hold always blocks, whatever the time, and the approver sees who did not answer.
- **Participants: authors and lane owners.** Everyone with commits since the last tag answers for their part, and everyone with an open lane or PR checks that the candidate does not break the work in flight.

## Consequences

A release takes longer: it waits for answers or for the deadline. Every contributor needs kj in their session to ack; a person without kj answers in the issue by hand. CI gains one more check on the tag. A solo repo keeps working: with one participant the proposer acks and approves. Until this lands, no release is tagged here: 5.22.0 waits for it.
