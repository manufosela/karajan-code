import { render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { fetchActiveProfile, fetchConfiguration } from "@/lib/api";
import type { ActiveProfile } from "@/types/profile";

import { ThematicPanel } from "./ThematicPanel";

vi.mock("@/lib/api", () => ({
  fetchActiveProfile: vi.fn(),
  fetchConfiguration: vi.fn(),
  updateConfiguration: vi.fn(),
}));

// The panel reads nothing but the keyword groups, so the rest of the profile
// is left out rather than restated here.
const PROFILE = {
  taxonomy: {
    keyword_groups: [
      { name: "competitors", label: "Competitors", description: "Who else sells this." },
      { name: "ministry", label: "Ministry publications", description: "Official bulletins." },
    ],
  },
} as unknown as ActiveProfile;

const STORED_KEYWORDS = [
  {
    id: "cfg-1",
    category: "thematic",
    key: "keywords",
    value: { competitors: { positive: ["acme"], negative: ["acme jobs"] } },
    description: null,
    created_at: "",
    updated_at: "",
  },
];

describe("ThematicPanel", () => {
  beforeEach(() => {
    vi.mocked(fetchActiveProfile).mockResolvedValue(PROFILE);
    vi.mocked(fetchConfiguration).mockResolvedValue(STORED_KEYWORDS);
  });

  it("renders the groups the profile declares, in profile order", async () => {
    render(<ThematicPanel />);

    await screen.findByText("Competitors");

    const headings = screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent);
    expect(headings).toEqual(["Competitors", "Ministry publications"]);
    expect(screen.getByText("Official bulletins.")).toBeInTheDocument();
  });

  it("places the stored keywords under the group they belong to", async () => {
    render(<ThematicPanel />);

    await screen.findByText("acme");

    expect(screen.getByText("acme jobs")).toBeInTheDocument();
    expect(screen.getByText("2 keywords")).toBeInTheDocument();
    expect(screen.getByText("0 keywords")).toBeInTheDocument();
  });

  it("says so when the profile declares no groups", async () => {
    vi.mocked(fetchActiveProfile).mockResolvedValue({
      taxonomy: { keyword_groups: [] },
    } as unknown as ActiveProfile);

    render(<ThematicPanel />);

    expect(await screen.findByText(/declares no keyword groups/i)).toBeInTheDocument();
  });

  it("reports an error when the profile cannot be loaded", async () => {
    vi.mocked(fetchActiveProfile).mockRejectedValue(new Error("offline"));

    render(<ThematicPanel />);

    expect(await screen.findByText(/unable to load keyword configuration/i)).toBeInTheDocument();
  });

  it("carries no vocabulary of any particular domain", () => {
    // The first acceptance criterion of KRD-TSK-0023 is about the source
    // itself: group names, labels and descriptions come from the profile.
    // Vitest knows where this spec lives; import.meta.url is not a file URL under jsdom.
    const specPath = expect.getState().testPath as string;
    const source = readFileSync(path.join(path.dirname(specPath), "ThematicPanel.tsx"), "utf8");

    expect(source).not.toMatch(/orthodont|dental|aligner|digital_workflow|manufacturing/i);
  });
});
