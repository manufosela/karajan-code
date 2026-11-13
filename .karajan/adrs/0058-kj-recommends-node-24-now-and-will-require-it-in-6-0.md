# kj recommends Node 24 now and will require it in 6.0

kj keeps working on Node 22 today, nudges everyone toward Node 24, and will make 24 the minimum in kj 6.0 on a date announced well before Node 22 support ends.

Status: accepted
Date: 2026-11-13

## Context

kj supports Node >= 22.12.0 (`engines`, `MIN_NODE_MAJOR` = 22). Node 22 leaves support in April 2027, and CI already tests 22 and 24. Raising the minimum right now would break adopters who have not moved yet, but staying silent would leave them to find out when 22 is already unsupported.

## Decision

Accepted by the maintainer on 2026-11-13. kj recommends Node 24 now and requires it in a future 6.0:

- `engines` stays `>=22.12.0` and `MIN_NODE_MAJOR` stays 22: nothing breaks on Node 22.
- `kj doctor` shows a warning (exit code unchanged) on Node 22 and 23, with a link to the update guide.
- Any kj command warns once a day on Node below 24, and the docs carry an update guide for moving to Node 24.
- kj 6.0 requires Node 24, released on a date announced before April 2027.

Alternatives: (1) release 6.0 right now requiring Node 24: breaks every Node 22 user with no notice, and 22 is still supported; (2) warn with no date: the warning gives nobody a reason to act, so users keep drifting until the break. The dated, non-breaking warning wins: it gives a runway, costs nothing to current users and keeps the 6.0 break predictable.

## Consequences

Node 22 users see a warning in doctor and once a day, never an error. The guide at https://karajancode.com/docs/guides/node-24/ must exist before the warning ships to users. The 6.0 date must be announced before April 2027.
