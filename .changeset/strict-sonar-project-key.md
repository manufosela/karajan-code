---
"karajan-code": patch
---

Enforce strict Sonar project key derivation from `git remote.origin.url` (when no explicit key is set), including canonicalized remote parsing across SSH/HTTPS formats and nested group paths to avoid cross-environment/project key fragmentation.
