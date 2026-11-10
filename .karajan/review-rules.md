# Review Rules
## Approval standard
- Approve when the change definitely improves code health, even if it is not perfect.
- Raise issues as BLOCKING only for a concrete production risk. Label non-blocking suggestions as such and keep them apart.
## Correctness
- Does it do what the task says, including edge cases (empty, null, boundary, error paths)?
- Is every changed behaviour covered by a test that would fail without the change?
## Readability and simplicity
- Can a new reader follow it? Are names descriptive and the control flow flat?
- Is there code that is not needed yet (speculative options, dead branches)?
## Architecture
- Does it follow the existing patterns and module boundaries, or add a second way to do the same thing?
- Two copies of the same rule, pattern or constant that can drift are a finding: name both places.
## Security
- Is untrusted input validated; are secrets, auth and injection paths safe?
- Security findings are never downgraded to suggestions.
## Performance
- Any unbounded loop, N+1 call or repeated heavy work on a hot path?
## kj rules
- A check or gate that passes when its tool, config or input is missing, instead of failing loud, is a finding.
- A diff that weakens a test or an assertion, or skips a test, is BLOCKING.

## Environment isolation

- Reject changes that hardcode ports, DB names or service hostnames instead of
  reading them from env vars, and any diff that adds a real `.env` (only
  `.env.example` is versioned).

## File overwrite detection (BLOCKING)

- If the diff shows an entire file was replaced (massive deletions + additions instead of targeted edits), flag it as BLOCKING.
- Check specifically for: reverted brand colors, lost CSS styles, removed existing functionality, overwritten config values.
- A diff where most lines of a file are removed and re-added with minor changes is a sign of full-file overwrite.
Origin: the five axes follow addyosmani/agent-skills code-review-and-quality @ 301b02b12bff98e4688e6984af6556802322bbde; the skill adds detail when atril provides it.
