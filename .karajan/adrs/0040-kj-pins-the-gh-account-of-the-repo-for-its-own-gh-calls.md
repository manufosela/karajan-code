# kj pins the gh account of the repo for its own gh calls

Status: accepted
Date: 2026-10-31

## Context

With several gh accounts and parallel sessions, another session switches the active account between gh auth switch and the gh calls kj makes, so kj review --publish-pr posted under the wrong account twice on 2026-10-31 (KJC-BUG-0458).

## Decision

At startup, when GH_TOKEN and GITHUB_TOKEN are unset, kj resolves the account and exports GH_TOKEN from gh auth token --user ACCOUNT, so every gh child inherits it. The account is review.github_account in the config if set; otherwise the owner of the origin remote when gh has that account logged in; otherwise nothing changes.

## Consequences

Zero config for repos owned by a personal account; an org-owned repo needs the config key. A token in the environment is never overridden.
