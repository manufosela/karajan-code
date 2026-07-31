import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fetchActiveProfile } from "./api";
import type { ActiveProfile } from "@/types/profile";

const PROFILE: ActiveProfile = {
  id: "orthodontics",
  name: "Ortho Karajan Radar",
  version: "1.0.0",
  locale: "en",
  branding: {
    app_name: "Ortho Karajan Radar",
    short_name: "Ortho Frontier",
    tagline: "Strategic research intelligence for orthodontics",
    organization_name: "the organization",
  },
  taxonomy: {
    themes: [{ id: "materials", label: "Materials", description: "Wires and resins." }],
    strategic_buckets: [
      { id: "core_aligner_tech", label: "Core aligner technology", description: "Aligners." },
    ],
    time_horizons: [{ id: "immediate", label: "Immediate", description: "0-6 months." }],
    keywords: ["orthodontics", "clear aligners"],
  },
  vocabulary: {
    impact_levels: [{ id: "minimal", label: "Minimal", description: "Little relevance." }],
    hype_risks: [{ id: "low", label: "Low", description: "Conservative claims." }],
    impact_recommended_actions: [
      { id: "archive", label: "Archive", description: "File for reference." },
    ],
    scoring_recommended_actions: [
      { id: "discard", label: "Discard", description: "Not relevant." },
    ],
  },
};

describe("fetchActiveProfile", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const respondWith = (body: unknown, status = 200) => {
    vi.mocked(globalThis.fetch).mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
      text: async () => JSON.stringify(body),
    } as Response);
  };

  it("requests the profile endpoint", async () => {
    respondWith(PROFILE);

    await fetchActiveProfile();

    const [url] = vi.mocked(globalThis.fetch).mock.calls[0];
    expect(String(url)).toContain("/configuration/profile");
  });

  it("returns the taxonomy from the response", async () => {
    respondWith(PROFILE);

    const profile = await fetchActiveProfile();

    expect(profile.taxonomy.themes[0].id).toBe("materials");
    expect(profile.taxonomy.strategic_buckets).toHaveLength(1);
  });

  it("returns branding, which drives what the interface is called", async () => {
    respondWith(PROFILE);

    const profile = await fetchActiveProfile();

    expect(profile.branding.app_name).toBe("Ortho Karajan Radar");
  });

  it("keeps the two action vocabularies distinct", async () => {
    respondWith(PROFILE);

    const profile = await fetchActiveProfile();

    expect(profile.vocabulary.impact_recommended_actions[0].id).toBe("archive");
    expect(profile.vocabulary.scoring_recommended_actions[0].id).toBe("discard");
  });

  it("propagates a failure instead of returning an empty profile", async () => {
    // Swallowing this would render an interface with no themes at all and no
    // indication that anything went wrong. A 401 is not used here: the client
    // redirects to login on that status, which jsdom cannot perform.
    respondWith({ detail: "Server error" }, 500);

    await expect(fetchActiveProfile()).rejects.toThrow();
  });
});
