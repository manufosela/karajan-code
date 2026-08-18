"""Radar Profile: the configurable domain definition of a radar instance.

Everything subject-matter specific -- taxonomy, vocabularies, prompts,
sources and branding -- lives in a Radar Profile rather than in code, so a
single codebase can watch orthodontic research, energy policy or any other
frontier without being forked.
"""

from app.profiles.schema import RadarProfile

__all__ = ["RadarProfile"]
