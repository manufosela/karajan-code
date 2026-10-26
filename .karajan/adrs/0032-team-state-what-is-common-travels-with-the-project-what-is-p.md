# Team state: what is common travels with the project, what is personal stays local

Status: accepted
Date: 2026-10-26

## Context

A team works on one project with Karajan; the board is shared already (backend github). An inventory of what kj keeps (2026-10-26) found: tracked in git: adrs, rules.yml, policy.yml, policy-anchor.json, board.yml, supervisor files, hooks, review-gate. Local although common to the team: kj.config.yml (the project config), coder-rules.md and review-rules.md (the team rules the roles apply), and the plans; kj init also ignores .reviews/, one of the three sources of the qmd wiki (docs/, .reviews/, .karajan/plans/). Leaks across projects: .karajan/plans is a symlink to ~/.kj/plans, a global folder with the plans of every project, and .karajan/audits and .karajan/hu-stories hold other projects data. Personal and correctly local: identity.local.yml, rules.local.yml, karajan.env (secrets), handoffs, sessions and logs, and everything in ~/.karajan (Sonar token, phone enrollment, privacy rules, memories). Regenerable and local: rag.db, the qmd index (~/.cache/qmd, with absolute paths and private collections), skills-cache, board-cache.json, hu-board.db, audit-history.db.

## Decision

Proposed: (1) Common state travels with the project in git, under .karajan/ re-included by name: kj.config.yml, coder-rules.md, review-rules.md, plans/ (a real per-project folder, no longer a symlink to a global one), and atril.json with its catalogs and lockfile (the npm model: the manifest and the lock are shared, the installed store is rebuilt by each member). (2) Personal overrides go into *.local.* files that git ignores, the pattern identity.local.yml and rules.local.yml already use (kj.config.local.yml for personal config). (3) Indexes and caches are never shared: each member indexes the same shared sources (the qmd wiki, the RAG); the board Wiki panel keeps querying the local qmd. (4) The wiki sources are docs/ and .karajan/plans/; .reviews/ (legacy, ignored by kj init) leaves the wiki. (5) Each project folder holds only its own data: audits, stories and plans of other projects move out to where they belong. kj init writes these .gitignore rules and migrates an existing project.

## Consequences

A teammate cloning the project gets the same config, team rules, plans, ADRs, catalogs and board, and a wiki with the same sources; nobody shares secrets, identities or caches. Personal config needs the split between kj.config.yml and kj.config.local.yml, and existing projects need a migration (plans out of the global symlink, other projects data out of .karajan). Committed plans and config show in diffs and reviews like any other change.
