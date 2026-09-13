/**
 * Active Radar Profile types — aligned with backend schemas (profile.py).
 *
 * These describe the domain the instance watches. Anything the interface
 * labels — themes, strategic buckets, time horizons, scoring vocabulary —
 * comes from here rather than from literals in components, so the same build
 * serves any domain.
 */

export interface ProfileTerm {
  id: string;
  label: string;
  description: string;
}

/** A group the keyword panel organises its editable keywords in. No icon: the panel draws a generic one. */
export interface ProfileKeywordGroup {
  name: string;
  label: string;
  description: string;
}

export interface ProfileTaxonomy {
  themes: ProfileTerm[];
  strategic_buckets: ProfileTerm[];
  time_horizons: ProfileTerm[];
  keywords: string[];
  keyword_groups: ProfileKeywordGroup[];
}

export interface ProfileVocabulary {
  impact_levels: ProfileTerm[];
  hype_risks: ProfileTerm[];
  impact_recommended_actions: ProfileTerm[];
  scoring_recommended_actions: ProfileTerm[];
}

export interface ProfileBranding {
  app_name: string;
  short_name: string;
  tagline: string;
  organization_name: string;
}

export interface ActiveProfile {
  id: string;
  name: string;
  version: string;
  locale: string;
  branding: ProfileBranding;
  taxonomy: ProfileTaxonomy;
  vocabulary: ProfileVocabulary;
}
