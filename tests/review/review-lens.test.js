// KJC-TSK-1117: kj review --third-party --lens qa. A QA engineer (feedback from the
// QA team) found kj reviews like a developer; the qa lens hands the reviewer a QA rubric.
import { describe, it, expect } from "vitest";
import { lensTask, LENSES } from "../../src/review/review-lens.js";

describe("lensTask", () => {
  it("leaves the task as it is with no lens", async () => {
    expect(await lensTask(null, "check the login flow")).toBe("check the login flow");
    expect(await lensTask(undefined, null)).toBeNull();
  });

  it("puts the QA rubric before the user's task with the qa lens", async () => {
    const task = await lensTask("qa", "PR adds checkout tests");
    expect(task).toMatch(/QA/);
    expect(task).toMatch(/flak/i);
    expect(task).toMatch(/reserved/i);
    expect(task.endsWith("PR adds checkout tests")).toBe(true);
  });

  it("gives the rubric alone when there is no task", async () => {
    const task = await lensTask("qa", null);
    expect(task).toMatch(/assert/i);
  });

  it("fails naming the valid lenses on an unknown one", async () => {
    await expect(lensTask("ux", "t")).rejects.toThrow(new RegExp(`unknown review lens "ux".*${LENSES.join("|")}`));
  });
});
