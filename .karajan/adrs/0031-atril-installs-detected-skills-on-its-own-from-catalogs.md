# atril installs detected skills on its own, from catalogs it keeps current

Status: accepted
Date: 2026-10-26

## Context

Step 15c of ADR 0021 takes the skill detection out of Karajan and delegates it to atril. Today the pre-loop clones addyosmani/agent-skills (git pull every 7 days), detects stack skills from the task and its dependencies, installs them through OpenSkills for the run and removes them when it ends. The removal existed because OpenSkills installs into folders every CLI loads at session start, so a skill left there cost context in every session; atril's store is not loaded on its own, so that reason is gone.

ADR 0021 (decision 12) says installing from a catalog is an explicit step. Read as "a human accepts each skill", that would break Karajan's autonomy: the human would judge each skill by the same description atril already ranks. The trust that matters is which sources the catalogs hold, at which commit.

## Decision

The maintainer chose full autonomy:

1. **atril installs what fits on its own.** For each run, atril resolves the task and the roles; what fits from the catalogs and is not installed yet is installed into the store and stays there (no removal at the end of the run). Fit is atril's ranking of the task against each artifact's name, keywords, description and body, filtered by role.
2. **Only from catalogs.** The sources are Karajan's own catalog (`templates/atril`) and addyosmani/agent-skills, each pinned to a commit. A source outside the catalogs is never installed on its own.
3. **The catalogs keep themselves current.** Moving a source to a newer commit, or adding a better source, is proposed by one AI, its diff of the skills is reviewed by an AI of another family (skills are instructions an agent follows, so they are reviewed like code), and Solomon arbitrates a disagreement.
4. **The human enters only when the Brain and Solomon cannot settle it.**

This is how ADR 0021's "explicit step" applies to Karajan: the explicit act is putting a source and its commit into a catalog, reviewed; installing from a reviewed catalog needs no further act.

## Consequences

- The pipeline stays autonomous: no question per skill, and a fresh project gets the skills its tasks need from its first run.
- Every installed skill comes from a commit that was reviewed, by the catalog's cross-AI review instead of by a human per run.
- The store grows with what tasks needed; nothing is installed twice.
- New work: `atril update` (move a pin, showing the diff) and the autonomous catalog maintenance with cross-AI review, before or with step 15c. Step 16 (deleting `src/skills`) follows 15c.
