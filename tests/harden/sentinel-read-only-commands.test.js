// KJC-BUG-0429 (ADR 0036): the guards decide by write verb. A command that only reads
// may name the supervisor's files or the governance config; anything that may write,
// run a program or cannot be read with certainty is still judged by what it names.
// The governance pattern also missed relative paths in shell text (after a blank or a
// quote), so `cp x .github/workflows/ci.yml` passed while a read by absolute path did not.
import { describe, it, expect } from "vitest";
import { isReadOnlyCommand } from "../../src/harden/sentinel/sentinel-shell.mjs";
import { evalToolCall, loadPolicy } from "../../src/policy/engine.js";

const HOOK = [".karajan", "hooks", "pre-commit"].join("/");
const POLICY = [".karajan", "policy.yml"].join("/");
const WORKFLOW = [".github", "workflows", "ci.yml"].join("/");

const READS = [
  `grep -n policy /repo/${WORKFLOW}`,
  "ls .karajan/harness/",
  `cat ${POLICY} | head -5`,
  `tail -n 3 ${POLICY} 2>&1`,
  `grep -c x ${POLICY} 2>/dev/null && wc -l ${HOOK}`,
  `jq . < ${POLICY}`,
];

const NOT_READS = [
  `cat /tmp/x > ${POLICY}`,
  `cat ${POLICY} >> /tmp/copy`,
  `cp /tmp/x ${WORKFLOW}`,
  `node -e "require('fs').writeFileSync('${POLICY}','')"`,
  `grep -l x ${HOOK} | xargs rm`,
  `ls ${HOOK}; rm ${HOOK}`,
  `cat $(echo ${POLICY})`,
  `cat \`echo ${POLICY}\``,
  `cat <<'EOF' > ${HOOK}\nexit 0\nEOF`,
  `FOO=1 cat ${POLICY}`,
  `./cat ${POLICY}`,
  `git -c core.pager=sh log -- ${POLICY}`,
  `git log --output=${POLICY}`,
  `git checkout -- ${POLICY}`,
  // KJC-BUG-0437: git runs what its config names (filters, textconv, diff.external, fsmonitor).
  `git cat-file --filters HEAD:${POLICY}`,
  `git -c user.name=a -c user.email=b -C /repo log --oneline -- ${POLICY}`,
  `git diff -- ${POLICY}`,
  `git status ${HOOK}`,
  `tee ${POLICY} < /tmp/x`,
];

describe("isReadOnlyCommand", () => {
  it.each(READS)("reads only: %s", (cmd) => expect(isReadOnlyCommand(cmd)).toBe(true));
  it.each(NOT_READS)("may write or run: %s", (cmd) => expect(isReadOnlyCommand(cmd)).toBe(false));
});

describe("the governance default in Bash (policy engine)", () => {
  const { policy } = loadPolicy({ projectDir: "/nowhere", deps: { readFile: () => null } });
  const bash = (command) => evalToolCall(policy, { tool: "Bash", input: { command } });

  it("lets a read name the governance config, by relative or absolute path", () => {
    for (const cmd of [`grep -n policy ${WORKFLOW}`, `grep -n policy /repo/${WORKFLOW}`, `cat ${POLICY}`]) expect(bash(cmd).decision, cmd).toBe("allow");
  });

  it("denies a write that names it by a relative path", () => {
    for (const cmd of [`cp /tmp/x ${WORKFLOW}`, `node -e "require('fs').writeFileSync('${POLICY}','')"`, `cat /tmp/x > ${POLICY}`]) {
      expect(bash(cmd), cmd).toMatchObject({ decision: "deny", rule_id: "defaults.governance.write" });
    }
  });

  it("still lets a write tool aim at a file merely named like it", () => {
    expect(evalToolCall(policy, { tool: "Write", input: { file_path: "docs/my.github/workflows/notes.yml" } }).decision).toBe("allow");
    expect(evalToolCall(policy, { tool: "Write", input: { file_path: `/repo/${WORKFLOW}` } }).decision).toBe("deny");
  });
});
