# The pipeline proposes detected skills through atril instead of installing them

Status: proposed
Date: 2026-10-26

## Context

Step 15c of ADR 0021 moves the pre-loop skill detection onto atril catalogs. Today the pre-loop clones addyosmani/agent-skills (git pull every 7 days), detects stack skills from the task and its dependencies, installs them through OpenSkills for the session (skill-detector autoInstallSkills) and removes them when the session ends (cleanupAutoInstalledSkills). ADR 0021 decision 12 says installing from a catalog is always an explicit step, which the session auto-install contradicts.

## Decision

Option A (recommended): Karajan passes atril its own catalog (templates/atril) and addyosmani/agent-skills as a git source pinned to a commit; the pre-loop resolves the task and roles use only what is installed, while what fits and is not installed comes back as available and is shown to the user (kj skills install kind:name installs it). Option B: keep a temporary automatic install into .karajan for the session, removed at its end, as a stated exception to ADR 0021 decision 12. Until one is chosen, steps 15c and 16 (deleting src/skills) wait.

## Consequences

A: no network or install during a run, every skill a role uses was installed on purpose, and the pinned commit is what was reviewed; a fresh project starts with fewer skills until the user installs the proposed ones. B: today behavior is kept, at the cost of an exception to the trust rule and of writes to the store during every run.
