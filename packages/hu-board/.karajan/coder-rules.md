# Coder Rules

## File modification safety

- NEVER overwrite existing files entirely. Always make targeted, minimal edits.
- When adding new code to an existing file, insert only the new lines at the correct location.
- After each edit, verify with `git diff` that ONLY the intended lines changed.
- If unintended changes are detected, revert immediately with `git checkout -- <file>`.
- Pay special attention to CSS, HTML, and config files where full rewrites destroy prior work (brand colors, layouts, styles).

## Multi-agent / multi-developer environment

- Multiple developers and AI agents may be committing and modifying code simultaneously.
- ALWAYS run `git fetch origin main` and check recent commits before starting work.
- Before pushing or merging, rebase on the latest main: `git rebase origin/main`.
- If a commit or push fails, check whether someone else pushed in the meantime.
- Never assume main is unchanged since the last check — always verify.
- Create a dedicated branch per task (`feat/` or `fix/`) and merge via PR, never push directly to main.

## General

- Keep changes minimal and focused on the task.
- Do not modify code unrelated to the task.
- Follow existing code conventions and patterns in the repository.
