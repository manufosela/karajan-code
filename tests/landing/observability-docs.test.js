import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// HU-4859: the observability guide says what kj records and that OpenTelemetry does not send spans yet.
const root = new URL("../../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
const docs = "apps/landing/docs/src/content/docs/";

describe.each(["guides/observability.md", "es/guides/observability.md"])("the guide %s", (page) => {
  const text = read(`${docs}${page}`);

  it("lists the whole span allow-list and the opt-in variables", () => {
    for (const term of [
      "kj.card", "kj.role", "kj.outcome", "kj.provider", "kj.model",
      "kj.duration_ms", "kj.tokens_in", "kj.tokens_out", "kj.cost_usd",
      "OTEL_EXPORTER_OTLP_ENDPOINT", "OTEL_SDK_DISABLED", "kj telemetry preview",
    ]) {
      expect(text, term).toContain(term);
    }
  });

  it("names the records, the pages, the report block and ADR 0068", () => {
    for (const term of ["~/.karajan/usage", ".karajan/traces", "/usage.html", "/accounts.html", "Cross-AI review truth", "Not verified", "ADR 0068"]) {
      expect(text, term).toContain(term);
    }
  });

  it("has no em dashes", () => {
    expect(text).not.toContain("—");
  });
});

describe("the links to the guide", () => {
  it("is in the sidebar next to the Sentinel, in both languages", () => {
    expect(read("apps/landing/docs/astro.config.mjs")).toMatch(
      /slug: 'guides\/sentinel'[^\n]*\n\s*\{ label: 'Observability and review truth', slug: 'guides\/observability', translations: \{ es: 'Observabilidad y veracidad de las reviews' \}/,
    );
  });

  it.each([
    ["guides/hu-board.md", "/docs/guides/observability/"],
    ["es/guides/hu-board.md", "/docs/es/guides/observability/"],
  ])("%s links it from the Usage and Accounts subsection", (page, link) => {
    expect(read(`${docs}${page}`)).toContain(link);
  });

  it.each(["handbook/commands/doctor.mdx", "es/handbook/commands/doctor.mdx"])("%s documents the two hook checks", (page) => {
    const text = read(`${docs}${page}`);
    expect(text).toContain("dangling-hooks");
    expect(text).toContain("hook-guards");
  });
});
