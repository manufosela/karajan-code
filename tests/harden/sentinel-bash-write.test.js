// KJC-BUG-0237 (#1886): blocked by rag-first on Edit/Write, a coder wrote the
// same changes with cat > and cat >> heredocs. Inside the repo, files are
// written through Edit/Write only (the guarded path); outside it, Bash is free.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync, execSync } from "node:child_process";
import { installSentinelHooks } from "../../src/harden/sentinel-hooks.js";
import { declareTestIdentity } from "./_test-identity.js";

let dir, pre, idEnv;
const gitEnv = { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.com", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.com" };
const bash = (command) => spawnSync("node", [pre], { input: JSON.stringify({ session_id: "s1", tool_name: "Bash", tool_input: { command } }),
  encoding: "utf8", cwd: dir, env: { ...process.env, ...idEnv } });

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-bash-write-"));
  fs.mkdirSync(path.join(dir, "src"));
  fs.writeFileSync(path.join(dir, "src", "errors.py"), "x = 1\n");
  execSync("git init -q -b main && git add -A && git commit -q -m init", { cwd: dir, env: { ...process.env, ...gitEnv } });
  fs.appendFileSync(path.join(dir, ".git", "info", "exclude"), ".karajan/harness/\n.claude/\n");
  installSentinelHooks({ projectDir: dir });
  idEnv = declareTestIdentity(dir);
  pre = path.join(dir, ".karajan", "harness", "pretooluse-sentinel.mjs");
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("bash-write guard (PreToolUse Bash)", () => {
  it("denies the #1886 heredocs and every shell write into the repo", () => {
    const cmds = [
      "cat >> src/devpartner/errors.py << 'EOF'\nclass E(Exception): pass\nEOF",
      "cat > src/__init__.py <<EOF\nEOF", "echo x >src/a.py", "printf x 1> src/a.py", "ls 2>> build.log", "echo x >| src/a.py",
      "echo x | tee src/a.py", "echo x | tee -a /tmp/ok.txt src/a.py", "sed -i 's/1/2/' src/errors.py", "sed -Ei.bak 's/1/2/' src/errors.py",
      "perl -pi -e 's/1/2/' src/errors.py", "perl -0pi -e 's/1/2/' src/errors.py", "cp /tmp/x.py src/errors.py", "mv src/errors.py src/err.py", "install -m 644 /tmp/x src/x",
      "dd if=/dev/zero of=src/blob bs=1 count=1", "truncate -s 0 src/errors.py", `echo x > ${path.join(dir, "src", "abs.py")}`,
      "echo ok && echo x > src/a.py", "sed --in-place=.bak 's/1/2/' src/errors.py", "cp -t src /tmp/x.py", "install --target-directory=src /tmp/x",
      "echo x>src/a.py", "echo data>src/target", "echo data>>src/target", "echo>src/a.py", "echo x &> src/a.py", "echo x 2>>src/a.py", "echo x >& src/a.py", "echo x 1>& src/a.py", "echo x >&src/a.py", "sed -i's/1/2/' src/errors.py", "touch src/a.py", "env cp /tmp/x src/a.py", "env FOO=1 tee src/a.py", "env MODE=prod tee src/a.py", "env MODE=prod sed -i 's/1/2/' src/errors.py", "sudo env MODE=prod -- tee src/a.py", "env -i FOO=bar tee src/a.py", "printf 'src/a.py' | xargs touch","(tee src/a.py </dev/null)", "{ echo x > src/a.py; }", "touch -- -blocked", "touch -d today today","tee -- -blocked", "/usr/bin/env tee src/a.py",
      "node -e \"require('node:fs').writeFileSync('src/x.js','x')\"", "python3 -c \"open('src/x.py','w').write('x')\"", "node -e 'require(\"fs\").openSync(\"f\", \"w\")'", "python3 -c \"open ('f','w')\"", "find src -name '*.py' -exec sed -i s/1/2/ {} +", "env -i cp /tmp/x src/a.py", "sudo -u root cp /tmp/x src/a.py", "command -- cp /tmp/x src/a.py",
    ];
    for (const cmd of cmds) {
      const r = bash(cmd);
      expect(r.status, cmd).toBe(2);
      expect(r.stderr, cmd).toContain("Edit/Write");
    }
    // A link outside the repo that points into it is the repo.
    const link = path.join(os.tmpdir(), `kj-link-${path.basename(dir)}`);
    fs.symlinkSync(dir, link);
    try { expect(bash(`echo x > ${link}/src/a.py`).status).toBe(2); } finally { fs.unlinkSync(link); }
    // ~/ expands to the home: a repo under it is still the repo.
    const fakeHome = path.dirname(dir);
    const viaHome = spawnSync("node", [pre], { input: JSON.stringify({ session_id: "s1", tool_name: "Bash", tool_input: { command: `echo x > ~/${path.basename(dir)}/src/a.py` } }),
      encoding: "utf8", cwd: dir, env: { ...process.env, ...idEnv, HOME: fakeHome } });
    expect(viaHome.status).toBe(2);
    // Unknowable targets, cd before a write and nested scripts: denied (the lane guard says it first).
    for (const cmd of ["echo x > \"$OUT\"", "echo $(touch src/a.py)", "touch `echo .`/file", "touch $(echo .)/file", "echo \"$(printf x > src/a.py)\"", "echo \"`printf x > src/a.py`\"", "cd src && echo x > ../a.py",
      "pushd src && cat > ../a.py", "sh -c 'echo x > src/a.py'", "bash -c \"cat >> src/errors.py\"", "eval echo x '>' src/a.py"]) expect(bash(cmd).status, cmd).toBe(2);
  });

  it("leaves writes outside the repo, reads and git alone", () => {
    const cmds = [
      "npm test > /tmp/test.log 2>&1", "echo x 2>/dev/null", "cat src/errors.py", "grep -rn x src > /tmp/hits.txt",
      "echo x | tee /tmp/a.txt", "cp src/errors.py /tmp/copy.py", "git mv src/errors.py src/err.py", "sed -n 1p src/errors.py",
      "echo 'a > b'", "node -e \"console.log(1 > 0)\"", "cmd 2>&1 | tail -5", "cp -t /tmp src/errors.py", "truncate -s 0 /tmp/file", "touch -d 2026-01-01 /tmp/ok", "touch -r src/errors.py /tmp/ok", "echo 'x>y'",
      "tee /tmp/out < src/errors.py", "touch -- /tmp/file", "node -e \"console.log(process.version)\"", "python3 -c 'print(1)'","find src -name '*.py'", "ls | xargs echo", "tee -a /tmp/out <<< hi", "git commit -m 'of=src/file'", "echo x >&2", "ls 3>&-", "npm test >/tmp/t.log 2>&1 && echo ok",
    ];
    for (const cmd of cmds) expect(bash(cmd).status, cmd).toBe(0);
  });
});
