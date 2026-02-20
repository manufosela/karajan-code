# Coder Rules

## File modification safety

- NEVER overwrite existing files entirely. Always make targeted, minimal edits.
- When adding new code to an existing file, insert only the new lines at the correct location.
- After each edit, verify with `git diff` that ONLY the intended lines changed.
- If unintended changes are detected, revert immediately with `git checkout -- <file>`.
- Pay special attention to CSS, HTML, and config files where full rewrites destroy prior work (brand colors, layouts, styles).

## General

- Keep changes minimal and focused on the task.
- Do not modify code unrelated to the task.
- Follow existing code conventions and patterns in the repository.
