import { describe, it, expect } from "vitest";
import { formatHHMM, shortTask, formatSessionLabel } from "../src/format.js";

describe("formatHHMM", () => {
  it("formats an ISO timestamp as HH:MM (24h, server-local)", () => {
    // The board runs on the server side; the user reads the same
    // timezone the server is in. We don't need to assert a fixed
    // string — but we can assert the shape.
    expect(formatHHMM("2026-05-07T08:35:58.010Z")).toMatch(/^\d{2}:\d{2}$/);
  });

  it("returns a dash placeholder when the timestamp is missing", () => {
    expect(formatHHMM(null)).toBe("—");
    expect(formatHHMM(undefined)).toBe("—");
    expect(formatHHMM("")).toBe("—");
  });

  it("returns a dash placeholder when the timestamp is unparseable", () => {
    expect(formatHHMM("not a date")).toBe("—");
    expect(formatHHMM("2099-99-99T99:99:99Z")).toBe("—");
  });
});

describe("shortTask", () => {
  it("returns empty string for empty / null input", () => {
    expect(shortTask(null)).toBe("");
    expect(shortTask(undefined)).toBe("");
    expect(shortTask("")).toBe("");
  });

  it("collapses internal whitespace", () => {
    expect(shortTask("Add   a\nJSDoc\tcomment")).toBe("Add a JSDoc comment");
  });

  it("returns the full text when shorter than the limit", () => {
    expect(shortTask("Short task")).toBe("Short task");
  });

  it("truncates at max chars with an ellipsis suffix", () => {
    const long = "A".repeat(120);
    const out = shortTask(long, 30);
    expect(out.length).toBe(30);
    expect(out.endsWith("…")).toBe(true);
  });

  it("respects the configured max", () => {
    expect(shortTask("hello world", 5)).toBe("hell…");
  });
});

describe("formatSessionLabel", () => {
  it("falls back to '(no session)' when input is malformed", () => {
    expect(formatSessionLabel(null)).toEqual({
      title: "(no session)", subtitle: "", idChip: "",
    });
    expect(formatSessionLabel({})).toEqual({
      title: "(no session)", subtitle: "", idChip: "",
    });
  });

  it("uses project_name + HH:MM when both are available", () => {
    const r = formatSessionLabel({
      id: "s_2026-05-07T08-35-58-010Z",
      project_name: "tmp_kj-test-4",
      task: "Add a JSDoc comment to index.js",
      created_at: "2026-05-07T08:35:58.010Z",
    });
    expect(r.title).toMatch(/^tmp_kj-test-4 · \d{2}:\d{2}$/);
    expect(r.subtitle).toBe("Add a JSDoc comment to index.js");
    expect(r.idChip).toBe("s_2026-05-07T08-35-58-010Z");
  });

  it("falls back to session.id as title when no project is joined", () => {
    const r = formatSessionLabel({
      id: "s_orphan_xyz",
      project_name: null,
      task: "do stuff",
      created_at: "2026-05-07T08:35:58.010Z",
    });
    expect(r.title).toMatch(/^s_orphan_xyz · \d{2}:\d{2}$/);
    expect(r.subtitle).toBe("do stuff");
  });

  it("truncates an oversized project_name", () => {
    const longName = "a".repeat(80);
    const r = formatSessionLabel({
      id: "s1",
      project_name: longName,
      task: "x",
      created_at: "2026-05-07T08:35:58.010Z",
    });
    // Pre-time-suffix part length === MAX_PROJECT_CHARS (40 chars + "…")
    const beforeDot = r.title.split(" · ")[0];
    expect(beforeDot.length).toBeLessThanOrEqual(40);
    expect(beforeDot.endsWith("…")).toBe(true);
  });

  it("renders a title without time when created_at is missing", () => {
    const r = formatSessionLabel({
      id: "s1",
      project_name: "myproj",
      task: "thing",
      created_at: null,
    });
    expect(r.title).toBe("myproj");
  });

  it("subtitle is empty when no task is recorded", () => {
    const r = formatSessionLabel({
      id: "s1",
      project_name: "p",
      task: null,
      created_at: "2026-05-07T08:35:58.010Z",
    });
    expect(r.subtitle).toBe("");
  });

  it("idChip always preserves the raw session id (kj resume needs it)", () => {
    const id = "s_2026-05-07T08-35-58-010Z";
    expect(formatSessionLabel({ id, project_name: "p", task: "t", created_at: "2026-05-07T08:35:00Z" }).idChip).toBe(id);
  });
});
