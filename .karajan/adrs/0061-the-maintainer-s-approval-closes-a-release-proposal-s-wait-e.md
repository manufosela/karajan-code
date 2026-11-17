# The maintainer's approval closes a release proposal's wait early

Status: accepted
Date: 2026-11-17

## Context

ADR 0057 made a release wait for every participant or for 4 hours. On 2026-11-17 the 5.27.0 proposal sat waiting at night for a contributor who was asleep, and the maintainer asked that the wait stop being in the way.

## Decision

Accepted by the maintainer on 2026-11-17, amending ADR 0057. kj release approve no longer needs the deadline to pass: when nobody holds the release, approving it closes the wait, and the approval comment names who had not answered. kj release verify accepts a tag whose release has silence before the deadline when a valid approval is on the issue. A hold still blocks at any time, before or after the approval is posted.

## Consequences

Every participant is still mentioned and can still hold, but a participant who answers after the approval learns it late; the approval names them on the issue so it is visible who did not answer. The approval stays a human act of someone in the roster (max) or with write access (critical).
