import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * branding.ts reads process.env at module scope, because Next.js inlines
 * NEXT_PUBLIC_* at build time. Each case therefore has to re-import the
 * module with a fresh environment.
 */
const loadBranding = async () => {
  vi.resetModules();
  return (await import("./branding")).branding;
};

describe("branding", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe("without configuration", () => {
    it("falls back to the generic product name", async () => {
      vi.stubEnv("NEXT_PUBLIC_APP_NAME", "");

      expect((await loadBranding()).appName).toBe("Frontier Radar");
    });

    it("hides the organisation credit by leaving it empty", async () => {
      vi.stubEnv("NEXT_PUBLIC_ORGANIZATION_NAME", "");

      expect((await loadBranding()).organizationName).toBe("");
    });

    it("names no particular customer in any default", async () => {
      vi.stubEnv("NEXT_PUBLIC_APP_NAME", "");
      vi.stubEnv("NEXT_PUBLIC_APP_SHORT_NAME", "");
      vi.stubEnv("NEXT_PUBLIC_APP_TAGLINE", "");
      vi.stubEnv("NEXT_PUBLIC_ORGANIZATION_NAME", "");

      const values = Object.values(await loadBranding()).join(" ").toLowerCase();

      expect(values).not.toContain("ortho");
      expect(values).not.toContain("geniova");
    });
  });

  describe("with configuration", () => {
    it("uses the configured product name", async () => {
      vi.stubEnv("NEXT_PUBLIC_APP_NAME", "Mobility Radar");

      expect((await loadBranding()).appName).toBe("Mobility Radar");
    });

    it("uses the configured organisation", async () => {
      vi.stubEnv("NEXT_PUBLIC_ORGANIZATION_NAME", "Acme Corp");

      expect((await loadBranding()).organizationName).toBe("Acme Corp");
    });

    it("trims surrounding whitespace", async () => {
      vi.stubEnv("NEXT_PUBLIC_APP_NAME", "  Padded Radar  ");

      expect((await loadBranding()).appName).toBe("Padded Radar");
    });

    it("treats a whitespace-only value as absent", async () => {
      // A build argument left as an empty string in CI arrives as "   ".
      vi.stubEnv("NEXT_PUBLIC_APP_NAME", "   ");

      expect((await loadBranding()).appName).toBe("Frontier Radar");
    });

    it("lets the short name differ from the full name", async () => {
      vi.stubEnv("NEXT_PUBLIC_APP_NAME", "Shared Mobility and Energy Radar");
      vi.stubEnv("NEXT_PUBLIC_APP_SHORT_NAME", "Mobility");

      const branding = await loadBranding();

      expect(branding.appName).not.toBe(branding.shortName);
      expect(branding.shortName).toBe("Mobility");
    });

    it("uses the configured tagline", async () => {
      vi.stubEnv("NEXT_PUBLIC_APP_TAGLINE", "Watching the energy frontier");

      expect((await loadBranding()).tagline).toBe("Watching the energy frontier");
    });
  });
});
