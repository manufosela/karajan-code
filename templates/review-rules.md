# Review Rules

- Focus on security, correctness, and tests first.
- Only raise blocking issues for concrete production risks.
- Keep non-blocking suggestions separate.

## File overwrite detection (BLOCKING)

- If the diff shows an entire file was replaced (massive deletions + additions instead of targeted edits), flag it as BLOCKING.
- Check specifically for: reverted brand colors, lost CSS styles, removed existing functionality, overwritten config values.
- A diff where most lines of a file are removed and re-added with minor changes is a sign of full-file overwrite.
