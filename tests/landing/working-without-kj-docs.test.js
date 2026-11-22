import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// HU-4791: the guide on working without kj says what the codex-state reader accepts, in both languages.
const root = new URL("../../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
const docs = "apps/landing/docs/src/content/docs/";

describe.each(["guides/working-without-kj.md", "es/guides/working-without-kj.md"])("the guide %s", (page) => {
  const text = read(`${docs}${page}`);

  it("states the codex-state format kj reads", () => {
    for (const term of [
      "<!-- codex-review-lifecycle:v1 -->",
      "**Recommendation: APPROVE**",
      "**Recommendation: REQUEST_CHANGES**",
      "<!-- codex-state:",
      "observedHead",
      "reviewed.head",
      "dismissal.by",
      "review: { automatic: codex-state }",
      "--wait-automatic 20",
      "github-actions[bot]",
    ]) {
      expect(text, term).toContain(term);
    }
  });

  it("has the prompt in a fenced block and no em dashes", () => {
    expect(text).toMatch(/```text\n[\s\S]*codex-state[\s\S]*```/);
    expect(text).not.toContain("—");
  });
});

describe("the links to the guide", () => {
  it("is in the sidebar next to Node 24, in both languages", () => {
    expect(read("apps/landing/docs/astro.config.mjs")).toMatch(
      /slug: 'guides\/node-24'[^\n]*\n\s*\{ label: 'Working without kj', slug: 'guides\/working-without-kj', translations: \{ es: 'Trabajar sin kj' \}/,
    );
  });

  it.each([
    ["reference/cli.md", "/docs/guides/working-without-kj/"],
    ["es/reference/cli.md", "/docs/es/guides/working-without-kj/"],
  ])("%s explains the flags and links it", (page, link) => {
    const text = read(`${docs}${page}`);
    expect(text).toContain("--automatic-review codex-state");
    expect(text).toContain("--wait-automatic");
    expect(text).toContain(link);
  });
});
