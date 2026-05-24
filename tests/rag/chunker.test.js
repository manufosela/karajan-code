// KJC-PCS-0049 Step 3 — chunker acceptance pins.
import { describe, expect, it } from "vitest";
import { chunkMarkdown, chunkPlan, chunkSource } from "../../src/rag/chunker.js";

describe("chunkMarkdown — KJC-PCS-0049 Step 3", () => {
  it("respects heading hierarchy in metadata.headingPath", () => {
    const md = "# Top\n\nIntro.\n\n## A\n\nBody A.\n\n## B\n\nBody B.\n\n### B1\n\nDeep.";
    const chunks = chunkMarkdown(md, { path: "/p.md" });
    const paths = chunks.map((c) => c.metadata.headingPath.join(" > "));
    expect(paths).toContain("Top");
    expect(paths).toContain("Top > A");
    expect(paths).toContain("Top > B");
    expect(paths).toContain("Top > B > B1");
  });

  it("propagates source + kind on every chunk", () => {
    const md = "# X\n\nBody.";
    const chunks = chunkMarkdown(md, { path: "/x.md", kind: "onboarding" });
    expect(chunks.every((c) => c.metadata.source === "/x.md" && c.metadata.kind === "onboarding")).toBe(true);
  });

  it("subdivides oversized sections via overlapping windows", () => {
    const long = "x".repeat(2500);
    const md = `# T\n\n${long}`;
    const chunks = chunkMarkdown(md, { path: "/t.md", limit: 800, overlap: 100 });
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((c) => c.text.length <= 800)).toBe(true);
  });
});

describe("chunkPlan — KJC-PCS-0049 Step 3", () => {
  it("emits one chunk per HU with hu_id + title metadata", () => {
    const plan = {
      summary: "A plan.",
      hus: [
        { id: "HU-A", title: "Login", description: "Build login.", scope: "auth" },
        { id: "HU-B", title: "Logout", description: "Build logout.", scope: "auth" },
      ],
    };
    const chunks = chunkPlan(plan, { path: "/plan.json" });
    const huChunks = chunks.filter((c) => c.metadata.hu_id);
    expect(huChunks.map((c) => c.metadata.hu_id)).toEqual(["HU-A", "HU-B"]);
    expect(huChunks[0].metadata.title).toBe("Login");
  });

  it("skips HUs with no narrative text", () => {
    const plan = { hus: [{ id: "HU-X" }, { id: "HU-Y", title: "Real", description: "Has body." }] };
    const chunks = chunkPlan(plan, { path: "/p.json" });
    const ids = chunks.map((c) => c.metadata.hu_id);
    expect(ids).toEqual(["HU-Y"]);
  });
});

describe("chunkSource — KJC-PCS-0049 Step 3", () => {
  it("splits by top-level export symbol with metadata.symbol", () => {
    const src = `
import x from "y";
export function alpha() { return 1; }
export const beta = 42;
export async function gamma() {}
`;
    const chunks = chunkSource(src, { path: "/s.js" });
    expect(chunks.map((c) => c.metadata.symbol)).toEqual(["alpha", "beta", "gamma"]);
  });

  it("falls back to windowed chunks when no exports exist", () => {
    const src = "const a = 1;\nconsole.log(a);";
    const chunks = chunkSource(src, { path: "/s.js" });
    expect(chunks.length).toBe(1);
    expect(chunks[0].metadata.symbol).toBeNull();
  });
});
