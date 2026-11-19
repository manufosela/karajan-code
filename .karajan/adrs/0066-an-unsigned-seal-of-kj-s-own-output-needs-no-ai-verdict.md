# An unsigned seal of kj's own output needs no AI verdict

Status: accepted
Date: 2026-11-18

## Context

Issue 4653, 2026-11-19. In a repo without a phone roster the seal is unsigned, and kj-verdicts asked for a cross-AI verdict of the seal commit. Since KJC-TSK-1444 that commit takes kj's hooks out of the shared Claude settings; the reviewer rejects it as guardrails removed, a security finding Solomon does not arbitrate, so the seal never got a verdict and the PR could not merge.

## Decision

The maintainer chose (option 1) that, with no roster, a seal commit is the seal act when every file it brings is kj's own output, recomputed: a hook the seal's verification re-rendered, a workflow whose only change is its kj pin moved up, the shared settings equal to their parent minus kj's hook entries, and the provenance. Any other change, a deletion included, still needs the cross-AI verdict. With a roster only a signed seal is the act, as before. Alternatives: tell the AI reviewer in its prompt that kj moves its hooks (rejected: it still depends on an AI accepting it); require a roster in every repo (as if the code did not exist: the signature is the only proof, but it blocks every team without a phone enrolled).

## Consequences

A repo without a roster seals and merges without an AI review of kj's own output; nobody can slip anything else in, because any byte kj would not write sends the commit back to the review. A seal that also deletes a file, or changes a workflow beyond its pin, still waits for a verdict or a signature.
