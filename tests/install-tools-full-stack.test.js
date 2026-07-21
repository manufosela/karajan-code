// KJC-TSK-0657: `kj install-tools` covers the FULL stack — a fresh machine
// must end 100% operational in one pass. rtk, squeezr and qmd (previously
// init-only) join the tool list, reusing the init installers.
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../src/utils/rtk-install.js", () => ({ installRtk: vi.fn() }));
vi.mock("../src/utils/squeezr-install.js", () => ({ installSqueezr: vi.fn() }));
vi.mock("../src/utils/qmd-install.js", () => ({ installQmd: vi.fn() }));
vi.mock("../src/utils/agent-detect.js", async (importOriginal) => ({
  ...(await importOriginal()),
  checkBinary: vi.fn(async () => ({ ok: false })),
}));

import { installToolsCommand, __test } from "../src/commands/install-tools.js";
import { installRtk } from "../src/utils/rtk-install.js";
import { installSqueezr } from "../src/utils/squeezr-install.js";
import { installQmd } from "../src/utils/qmd-install.js";

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

describe("full-stack tool list", () => {
  it("ALL_TOOLS includes rtk, squeezr and qmd", () => {
    expect(__test.ALL_TOOLS).toEqual(expect.arrayContaining(["rtk", "squeezr", "qmd"]));
  });

  it("--only accepts the three new names", () => {
    expect(__test.parseOnlyList("rtk,squeezr,qmd")).toEqual(["rtk", "squeezr", "qmd"]);
  });
});

describe("optimizer installs via the init installers", () => {
  beforeEach(() => vi.clearAllMocks());

  it("installs rtk/squeezr/qmd with --only and --yes", async () => {
    installRtk.mockResolvedValue({ ok: true, version: "1.0", error: null });
    installSqueezr.mockResolvedValue({ ok: true, version: "1.0", error: null });
    installQmd.mockResolvedValue({ ok: true, version: "1.0", error: null });
    const { results } = await installToolsCommand({ only: "rtk,squeezr,qmd", yes: true, logger });
    expect(installRtk).toHaveBeenCalledOnce();
    expect(installSqueezr).toHaveBeenCalledOnce();
    expect(installQmd).toHaveBeenCalledOnce();
    expect(results.map((r) => r.action)).toEqual(["installed", "installed", "installed"]);
  });

  it("a failing installer reports failed with the error, not a crash", async () => {
    installRtk.mockResolvedValue({ ok: false, version: null, error: "cargo missing" });
    const { results } = await installToolsCommand({ only: "rtk", yes: true, logger });
    expect(results[0]).toMatchObject({ tool: "rtk", action: "failed", error: "cargo missing" });
  });

  it("dry-run plans without invoking installers", async () => {
    const { results } = await installToolsCommand({ only: "rtk,squeezr", dryRun: true, logger });
    expect(installRtk).not.toHaveBeenCalled();
    expect(installSqueezr).not.toHaveBeenCalled();
    expect(results.every((r) => r.action === "planned")).toBe(true);
  });
});
