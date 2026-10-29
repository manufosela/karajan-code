# The agent never holds admin power over the repo; exceptions are signed and audited

Status: proposed
Date: 2026-10-29

## Context

Merging the seal PR (#2754) that moved kj-policy.yml to pull_request_target needed enforce_admins switched off for one merge. The agent works with the maintainer's own gh token, which has admin rights: a capable enough agent could switch the protection off, merge as admin and switch it back, impersonating the maintainer. A phone signature inside kj does not stop that on its own, because GitHub decides and an agent with the token can call the API without passing through kj.

## Decision

Two layers. (1) Prevention: the agent works with its own GitHub identity and a fine-grained token without the Administration permission, so it cannot change branch protection, merge as admin or change settings; admin acts are done by the maintainer in the human session with passkey or 2FA. kj doctor/audit warn when the agent's token has admin power, and the security guide says how to set the identity up (KJC-TSK-1268, #2462). (2) Detection: an exception such as a transition admin merge is signed from an enrolled phone like the seal, and a job on every push to main checks that each merge passed its required checks or carries a signed exception, and that the protection is as declared (enforce_admins, required checks); anything else raises an alarm naming the PR and who merged it (KJC-TSK-1269).

## Consequences

The maintainer keeps two GitHub identities and does admin acts by hand in the browser. The agent can no longer do the transition admin merge itself, which it never should. Detection does not prevent abuse by someone holding the maintainer's own credentials, it makes it visible and attributable. Projects without a separate agent identity get a warning, not a block.
