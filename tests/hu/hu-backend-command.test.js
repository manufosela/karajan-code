// KJC-TSK-1163 (TEAM-GH-B, ADR 0025): kj hu backend github turns the shared board on for the
// repo once; it says which files to commit so the whole team inherits it.
import { describe, it, expect, vi, afterEach } from "vitest";
import { huCommand } from "../../src/commands/hu.js";

afterEach(() => vi.restoreAllMocks());

describe("kj hu backend", () => {
  it("turns the shared board on and names the files the team must get in a PR", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const setBackend = async ({ backend }) => ({ backend, repo: "acme/app", file: ".karajan/board.yml", gitignoreChanged: true });
    const r = await huCommand({ config: { projectDir: "/r" }, action: "backend", args: ["github"], deps: { setBackend, boardConfig: async () => ({ backend: "local" }) } });
    expect(r).toMatchObject({ backend: "github", repo: "acme/app" });
    expect(log.mock.calls[0][0]).toMatch(/GitHub Issues of acme\/app.*\.karajan\/board\.yml and \.gitignore in a PR/);
  });

  it("shows what the chosen manager can and cannot do, with the HU Board for what is missing", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const setBackend = async ({ backend }) => ({ backend, repo: "acme/app", file: ".karajan/board.yml", gitignoreChanged: false });
    await huCommand({ config: { projectDir: "/r" }, action: "backend", args: ["github"], deps: { setBackend, boardConfig: async () => ({ backend: "local" }) } });
    const out = log.mock.calls.map((c) => c[0]).join("\n");
    expect(out).toMatch(/can: .*acceptance criteria in the story body.*review verdicts on the PR/);
    expect(out).toMatch(/cannot: the full dependency graph — see it in the HU Board \(kj board start\)/);
  });

  it("needs the backend name", async () => {
    await expect(huCommand({ config: { projectDir: "/r" }, action: "backend", args: [], deps: { boardConfig: async () => ({ backend: "local" }) } })).rejects.toThrow(/github \| local/);
  });
});
