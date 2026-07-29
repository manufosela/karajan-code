/**
 * User-facing naming for this radar instance.
 *
 * Mirrors the `branding` and `organization` sections of the backend's active
 * Radar Profile. These are build-time values because Next.js inlines
 * NEXT_PUBLIC_* at build time, so a deployment sets them as build arguments
 * alongside NEXT_PUBLIC_API_URL.
 *
 * The defaults describe the generic product, never a particular customer.
 */

const DEFAULT_APP_NAME = "Frontier Radar";

export const branding = {
  /** Full product name, e.g. "Ortho Frontier Radar". */
  appName: process.env.NEXT_PUBLIC_APP_NAME?.trim() || DEFAULT_APP_NAME,

  /** Short name for the sidebar lockup, e.g. "Ortho Frontier". */
  shortName: process.env.NEXT_PUBLIC_APP_SHORT_NAME?.trim() || DEFAULT_APP_NAME,

  /** Organisation the radar reports for. Empty hides the credit line. */
  organizationName: process.env.NEXT_PUBLIC_ORGANIZATION_NAME?.trim() || "",

  /** One-line description used as page metadata. */
  tagline:
    process.env.NEXT_PUBLIC_APP_TAGLINE?.trim() ||
    "Strategic research intelligence",
} as const;
