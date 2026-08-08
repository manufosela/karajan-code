"""Sample cards shared by the card tests.

Kept in one place so every test file works from the same valid card and each
test only has to say what it breaks about it.
"""

from __future__ import annotations

from typing import Any

SECTION_FIELDS = (
    "problem_signature",
    "reach_for_it_when",
    "do_not_reach_for_it_when",
    "trade_offs",
    "canonical_source",
)


def body_dict() -> dict[str, Any]:
    """A valid card body, as the base for mutation tests."""
    return {
        "title": "Logical clocks & happened-before (Lamport, 1978)",
        "problem_signature": "Events across processes need a consistent order, and wall clocks disagree.",
        "reach_for_it_when": "- Two or more writers produce events whose CAUSAL order matters.",
        "do_not_reach_for_it_when": "- A single writer already totally orders the events.",
        "trade_offs": "- Vector clocks cost O(nodes) metadata per event.",
        "canonical_source": 'Leslie Lamport, "Time, Clocks, and the Ordering of Events", CACM, 1978.',
    }
