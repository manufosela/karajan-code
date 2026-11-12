// HU-3995 (issue #3847, slice 1): the read-only check regenerates each agent's hooks with the
// pinned rulesync outside the repository and compares the hooks subtree with the repository's.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkRulesyncHooks, RULESYNC_PIN } from "../../src/utils/rulesync-hooks-check.js";

const GENERATED = {
  ".claude/settings.json": JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: "command", command: "echo stop" }] }] } }),
  ".codex/hooks.json": JSON.stringify({ hooks: { Stop: [] } }),
  ".agents/hooks.json": JSON.stringify({ rulesync: { stop: [] } }),
  ".opencode/plugins/rulesync-hooks.js": "export default {};\n",
};

let dir;
const put = (root, file, text) => { mkdirSync(dirname(join(root, file)), { recursive: true }); writeFileSync(join(root, file), text); };
const fakeRun = ({ stderr = "", version = RULESYNC_PIN.version } = {}) => vi.fn(async (_cmd, args, opts) => {
  if (args.includes("--version")) return { exitCode: 0, stdout: `${version}\n`, stderr: "" };
  for (const [file, text] of Object.entries(GENERATED)) put(opts.cwd, file, text);
  return { exitCode: 0, stdout: "", stderr };
});
// Keys that are not ours never count: only each agent's hooks subtree is compared.
const UNRELATED = { ".claude/settings.json": { permissions: { allow: ["x"] } }, ".codex/hooks.json": { version: 1 }, ".agents/hooks.json": { mine: { stop: [] } } };
const putRepo = (file, subtree) => put(dir, file, JSON.stringify({ ...UNRELATED[file], ...subtree }));

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "kj-rs-hooks-"));
  put(dir, ".rulesync/hooks.jsonc", "{}");
  put(dir, "package-lock.json", JSON.stringify({ packages: { "node_modules/rulesync": { version: RULESYNC_PIN.version, integrity: RULESYNC_PIN.integrity } } }));
  for (const [file, text] of Object.entries(GENERATED)) put(dir, file, text);
  for (const file of Object.keys(UNRELATED)) putRepo(file, JSON.parse(GENERATED[file]));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("checkRulesyncHooks", () => {
  it("is green when every agent's hooks subtree matches, other keys aside, and generates outside the repo with a clean env", async () => {
    const run = fakeRun();
    const before = readFileSync(join(dir, ".claude/settings.json"), "utf8");
    expect(await checkRulesyncHooks({ projectDir: dir, run })).toEqual({ ok: true, problems: [] });
    const [, args, opts] = run.mock.calls.find(([, a]) => a.includes("generate"));
    expect(args).toEqual(expect.arrayContaining(["--features", "hooks", "--targets", "claudecode,codexcli,antigravity-cli,opencode"]));
    expect(opts.cwd.startsWith(dir)).toBe(false);
    expect(opts.extendEnv).toBe(false);
    expect(Object.keys(opts.env).sort()).toEqual(["HOME", "PATH"]);
    expect(readFileSync(join(dir, ".claude/settings.json"), "utf8")).toBe(before);
  });

  it("fails on a hook changed inside an agent's subtree, or missing from the repository, naming the agent", async () => {
    putRepo(".codex/hooks.json", { hooks: { Stop: [{ command: "edited" }] } });
    putRepo(".agents/hooks.json", { rulesync: { stop: [{ command: "edited" }] } });
    rmSync(join(dir, ".opencode"), { recursive: true });
    const res = await checkRulesyncHooks({ projectDir: dir, run: fakeRun() });
    expect(res.ok).toBe(false);
    expect(res.problems).toEqual([expect.stringMatching(/codexcli.*\.codex\/hooks\.json.*differ/),
      expect.stringMatching(/antigravity-cli.*\.agents\/hooks\.json.*differ/), expect.stringMatching(/opencode.*missing/)]);
  });

  it("fails on an event rulesync skipped, even though it exited 0", async () => {
    const run = fakeRun({ stderr: "Skipped hook event(s) for antigravity-cli (not supported): notification" });
    const res = await checkRulesyncHooks({ projectDir: dir, run });
    expect(res.problems).toEqual([expect.stringMatching(/skipped.*antigravity-cli.*notification/i)]);
  });

  it("fails on a changed rulesync hash or version", async () => {
    put(dir, "package-lock.json", JSON.stringify({ packages: { "node_modules/rulesync": { integrity: "sha512-other" } } }));
    const res = await checkRulesyncHooks({ projectDir: dir, run: fakeRun({ version: "43.2.0" }) });
    expect(res.problems).toEqual([expect.stringMatching(/integrity/), expect.stringMatching(/43\.2\.0.*43\.1\.2/)]);
  });

  it("fails loud when generate fails or there is no .rulesync/ source", async () => {
    const failing = vi.fn(async (_c, args) => (args.includes("--version")
      ? { exitCode: 0, stdout: RULESYNC_PIN.version } : { exitCode: 1, stdout: "", stderr: "boom" }));
    expect((await checkRulesyncHooks({ projectDir: dir, run: failing })).problems).toEqual([expect.stringMatching(/generate failed.*boom/)]);
    rmSync(join(dir, ".rulesync"), { recursive: true });
    await expect(checkRulesyncHooks({ projectDir: dir, run: fakeRun() })).rejects.toThrow(/\.rulesync/);
    await expect(checkRulesyncHooks({ projectDir: dir, targets: ["cursor"] })).rejects.toThrow(/unknown target.*cursor/);
  });
});
