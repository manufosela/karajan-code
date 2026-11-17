// HU-4524: which agent acts in each role of the panel, for the stage; a substitution lasts only
// while the panel's own agent cannot act.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { readSubstitutions, recordRoleActing } from "../../src/review/active-panel.js";

let home;
beforeEach(() => { home = mkdtempSync(join(tmpdir(), "kj-panel-")); });
afterEach(() => rmSync(home, { recursive: true, force: true }));

describe("the active panel", () => {
  it("records a substitution with who replaces whom, why and since when", () => {
    recordRoleActing({ role: "reviewer", declared: "codex", acting: "agy", now: new Date("2026-11-17T06:00:00Z"), home });
    expect(readSubstitutions({ home })).toEqual({ reviewer: { declared: "codex", acting: "agy", reason: "quota", since: "2026-11-17T06:00:00.000Z" } });
  });

  it("keeps the first moment of a substitution that goes on", () => {
    recordRoleActing({ role: "reviewer", declared: "codex", acting: "agy", now: new Date("2026-11-17T06:00:00Z"), home });
    recordRoleActing({ role: "reviewer", declared: "codex", acting: "agy", now: new Date("2026-11-17T07:00:00Z"), home });
    expect(readSubstitutions({ home }).reviewer.since).toBe("2026-11-17T06:00:00.000Z");
  });

  it("clears it as soon as the panel's own agent acts again", () => {
    recordRoleActing({ role: "reviewer", declared: "codex", acting: "agy", home });
    recordRoleActing({ role: "reviewer", declared: "codex", acting: "codex", home });
    expect(readSubstitutions({ home })).toEqual({});
  });

  it("has no substitution before anything was recorded", () => {
    expect(readSubstitutions({ home })).toEqual({});
  });
});
