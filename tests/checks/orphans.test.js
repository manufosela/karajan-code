// KJC-TSK-0668 — kj doctor detects orphaned scanner processes (the
// semgrep-core survivors of the CPU storm) and offers to clean them up.

import { describe, it, expect, vi } from "vitest";
import { findOrphanToolProcesses, getOrphanChecks } from "../../src/checks/orphans.js";

const PS = (rows) => ({ stdout: rows.map((r) => `  ${r.join("  ")}`).join("\n"), stderr: "" });

describe("findOrphanToolProcesses", () => {
  it("flags governed tools reparented to init or systemd, ignores the rest", async () => {
    const runPs = vi.fn().mockResolvedValue(PS([
      [1, 0, "systemd"],
      [800, 2, "kthreadd-child"],
      [1200, 1, "semgrep-core"], // orphan: parent is init
      [1300, 2100, "systemd"], // user session manager
      [1400, 1300, "semgrep-core"], // orphan: reparented to systemd --user
      [1500, 900, "semgrep-core"], // NOT orphan: live non-systemd parent
      [1600, 1, "osv-scanner"], // orphan
      [1700, 1, "firefox"], // orphan but not ours
    ]));
    const { supported, orphans } = await findOrphanToolProcesses(runPs);
    expect(supported).toBe(true);
    expect(orphans.map((o) => o.pid)).toEqual([1200, 1400, 1600]);
  });

  it("reports unsupported instead of throwing when ps fails", async () => {
    const runPs = vi.fn().mockRejectedValue(new Error("no ps"));
    await expect(findOrphanToolProcesses(runPs)).resolves.toMatchObject({ supported: false, orphans: [] });
  });
});

describe("orphan check for kj doctor", () => {
  const check = getOrphanChecks()[0];

  it("passes when nothing is orphaned", async () => {
    const res = await check.detect({ runPs: vi.fn().mockResolvedValue(PS([[900, 500, "node"]])) });
    expect(res.ok).toBe(true);
  });

  it("warns with pids and a cleanup fix when orphans exist, and remediates by killing them", async () => {
    const res = await check.detect({ runPs: vi.fn().mockResolvedValue(PS([[1200, 1, "semgrep-core"]])) });
    expect(res).toMatchObject({ ok: false, severity: "warn" });
    expect(res.detail).toContain("semgrep-core");
    expect(res.fix).toContain("1200");

    const killer = vi.fn();
    const out = await check.remediate({ extra: res.extra, kill: killer });
    expect(killer).toHaveBeenCalledWith(1200, "SIGKILL");
    expect(out.fixed).toBe(true);
  });
});
