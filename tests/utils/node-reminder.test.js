import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { printNodeReminder } from "../../src/utils/node-reminder.js";
import { NODE_UPGRADE_GUIDE } from "../../src/checks/node.js";

const HOUR = 60 * 60 * 1000;
const NOW = Date.UTC(2026, 10, 13, 12);

describe("printNodeReminder", () => {
  let home;
  let lines;
  const run = (opts = {}) =>
    printNodeReminder({ version: "v22.23.4", now: NOW, home, env: {}, write: (s) => lines.push(s), ...opts });
  const stampFile = () => path.join(home, "node-reminder.json");
  const writeStamp = (shownAt) => fs.writeFileSync(stampFile(), JSON.stringify({ shownAt }));

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), "kj-node-reminder-"));
    lines = [];
  });
  afterEach(() => fs.rmSync(home, { recursive: true, force: true }));

  it("shows one line naming the guide on Node 22 with no stamp, and writes the stamp", () => {
    run();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("v22.23.4");
    expect(lines[0]).toContain(NODE_UPGRADE_GUIDE);
    expect(JSON.parse(fs.readFileSync(stampFile(), "utf8")).shownAt).toBe(NOW);
  });

  it("stays quiet when shown 2 hours ago, shows again after 25 hours", () => {
    writeStamp(NOW - 2 * HOUR);
    run();
    expect(lines).toHaveLength(0);
    writeStamp(NOW - 25 * HOUR);
    run();
    expect(lines).toHaveLength(1);
  });

  it("shows the line when the stamp lies in the future (clock moved back), and rewrites it", () => {
    writeStamp(NOW + 2 * HOUR);
    run();
    expect(lines).toHaveLength(1);
    expect(JSON.parse(fs.readFileSync(stampFile(), "utf8")).shownAt).toBe(NOW);
  });

  it.each(["v24.0.0", "v25.1.0"])("prints nothing on %s", (version) => {
    run({ version });
    expect(lines).toHaveLength(0);
  });

  it("prints nothing with KJ_NO_UPDATE_CHECK=1", () => {
    run({ env: { KJ_NO_UPDATE_CHECK: "1" } });
    expect(lines).toHaveLength(0);
  });

  it("shows the line and does not throw when the stamp is unreadable", () => {
    fs.writeFileSync(stampFile(), "{not json");
    expect(() => run()).not.toThrow();
    expect(lines).toHaveLength(1);
  });
});
