# kj-quality defers to the repo's own CI

Status: accepted
Date: 2026-11-18

## Context

Issue 4611: in a repo whose own CI builds workspace types before lint and sets up Java for its tests, the kj-quality workflow kj harden adds runs npm ci, lint and test without those steps, fails, and its red check makes the merge gate block every PR. The workflow is governance configuration, so the person cannot adapt it, and kj harden --no-ci drops the other kj workflows too.

## Decision

When a workflow of the repo's own (not kj-*) already runs the repo's tests, kj harden generates no kj-quality workflow, removes a managed one it finds, and says which workflow it defers to. kj-quality stays for repos without CI of their own.

## Consequences

The quality gate of such a repo is its own CI: kj does not judge how strong it is. kj no longer copies or guesses the repo's build steps (typecheck, Java, emulators), and the person writes no configuration.
