# kj stage is a factory seen from above where the robots are always busy and only real events travel the line

Status: proposed
Date: 2026-11-05

## Context

The first stage kept the film framing: a giant conductor on the podium and small pieces in a row. On 2026-11-05 the maintainer asked for a top-down factory instead, with kaRAGan and kaWATCHan on it, every character doing something, moving around, talking and carrying the work.

## Decision

Decided by the maintainer on 2026-11-05 (mixed option). The stage is a factory hall in real 3D (perspective, volume, shadows; never a flat top-down map), seen from a high camera at three quarters, every character at the same scale: Karajan, kaRAGan, kaWATCHan and the seven pieces as work stations joined by a line. The robots are always busy with ambient behaviour (walking, working at their station, speech bubbles to each other). The boxes that travel the line are only real events (Sentinel denials, review verdicts, Ledger seals), so ADR 0046 decision 4 holds for the work: nothing that happened is invented. kaRAGan and kaWATCHan use the copied createRobot with their film accents.

## Consequences

The film framing (podium, conductor scale) is not reused; the copied builders still are, so ADR 0046 decisions 1 to 3 and 5 stand. Ambient motion stops under prefers-reduced-motion. The rest scene (KJC-TSK-1398) and the live director (KJC-TSK-1399) are redrawn on the factory layout.
