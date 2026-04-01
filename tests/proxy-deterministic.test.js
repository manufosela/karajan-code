import { describe, it, expect } from "vitest";
import { stripAnsi, collapseWhitespace, truncateLines, countTokens } from "../src/proxy/compression/deterministic/utils.js";
import * as bashGit from "../src/proxy/compression/deterministic/bash-git.js";
import * as bashTest from "../src/proxy/compression/deterministic/bash-test.js";
import * as bashBuild from "../src/proxy/compression/deterministic/bash-build.js";
import * as bashInfra from "../src/proxy/compression/deterministic/bash-infra.js";
import * as bashPkg from "../src/proxy/compression/deterministic/bash-pkg.js";
import * as bashMisc from "../src/proxy/compression/deterministic/bash-misc.js";
import * as grepMod from "../src/proxy/compression/deterministic/grep.js";
import * as readMod from "../src/proxy/compression/deterministic/read.js";
import * as globMod from "../src/proxy/compression/deterministic/glob.js";
import { compressDeterministic } from "../src/proxy/compression/deterministic/index.js";

// ---------------------------------------------------------------------------
// utils.js
// ---------------------------------------------------------------------------
describe("utils", () => {
  describe("stripAnsi", () => {
    it("removes color codes from terminal output", () => {
      const colored = "\x1B[32m✓\x1B[39m test passed \x1B[1m(bold)\x1B[0m";
      expect(stripAnsi(colored)).toBe("✓ test passed (bold)");
    });

    it("returns plain text unchanged", () => {
      expect(stripAnsi("no colors here")).toBe("no colors here");
    });
  });

  describe("collapseWhitespace", () => {
    it("collapses multiple spaces and tabs into single space", () => {
      expect(collapseWhitespace("foo   bar\tbaz")).toBe("foo bar baz");
    });

    it("collapses 3+ consecutive blank lines into 2", () => {
      const input = "line1\n\n\n\n\nline2";
      expect(collapseWhitespace(input)).toBe("line1\n\nline2");
    });
  });

  describe("truncateLines", () => {
    it("returns text unchanged if under limit", () => {
      expect(truncateLines("a\nb\nc", 5)).toBe("a\nb\nc");
    });

    it("truncates and adds note when over limit", () => {
      const lines = Array.from({ length: 50 }, (_, i) => `line ${i}`).join("\n");
      const result = truncateLines(lines, 10);
      const resultLines = result.split("\n");
      expect(resultLines).toHaveLength(11); // 10 kept + 1 note
      expect(resultLines[10]).toContain("40 more lines truncated");
    });
  });

  describe("countTokens", () => {
    it("estimates tokens as chars/4 rounded up", () => {
      expect(countTokens("abcd")).toBe(1);
      expect(countTokens("abcde")).toBe(2);
      expect(countTokens("")).toBe(0);
    });

    it("returns 0 for null/undefined", () => {
      expect(countTokens(null)).toBe(0);
      expect(countTokens(undefined)).toBe(0);
    });
  });
});

// ---------------------------------------------------------------------------
// bash-git.js
// ---------------------------------------------------------------------------
describe("bash-git", () => {
  const GIT_STATUS = `On branch main
Your branch is up to date with 'origin/main'.

Changes not staged for commit:
  (use "git add <file>..." to update what will be committed)
  (use "git restore <file>..." to discard changes in working directory)
	modified:   src/index.js
	deleted:    old-file.js

Untracked files:
  (use "git add <file>..." to include in what will be committed)
	new-file.js

no changes added to commit (use "git add" and/or "git commit -a")`;

  const GIT_DIFF = `diff --git a/src/index.js b/src/index.js
index abc1234..def5678 100644
--- a/src/index.js
+++ b/src/index.js
@@ -1,5 +1,6 @@
 import { foo } from './foo.js';
+import { bar } from './bar.js';

 export function main() {
-  return foo();
+  return foo() + bar();
 }
diff --git a/README.md b/README.md
index 1111111..2222222 100644
--- a/README.md
+++ b/README.md
@@ -1,3 +1,3 @@
-# Old Title
+# New Title

 Some content`;

  const GIT_LOG = `commit abc1234def5678901234567890abcdef12345678
Author: Dev <dev@example.com>
Date:   Mon Jan 1 12:00:00 2024 +0000

    feat: add new feature

commit 9876543210fedcba0987654321fedcba09876543
Author: Dev <dev@example.com>
Date:   Sun Dec 31 10:00:00 2023 +0000

    fix: resolve bug in parser`;

  describe("looksLike", () => {
    it("returns true for git status output", () => {
      expect(bashGit.looksLike(GIT_STATUS)).toBe(true);
    });

    it("returns true for git diff output", () => {
      expect(bashGit.looksLike(GIT_DIFF)).toBe(true);
    });

    it("returns true for git log output", () => {
      expect(bashGit.looksLike(GIT_LOG)).toBe(true);
    });

    it("returns false for unrelated text", () => {
      expect(bashGit.looksLike("Hello World\nThis is plain text.")).toBe(false);
    });
  });

  describe("compact", () => {
    it("compacts git status keeping modified/deleted/untracked", () => {
      const result = bashGit.compact(GIT_STATUS);
      expect(result).toContain("On branch main");
      expect(result).toContain("modified:");
      expect(result).toContain("deleted:");
      expect(result.length).toBeLessThan(GIT_STATUS.length);
    });

    it("compacts git diff into summary with file stats", () => {
      const result = bashGit.compact(GIT_DIFF);
      expect(result).toContain("src/index.js");
      expect(result).toContain("README.md");
      expect(result).toContain("2 files");
      expect(result.length).toBeLessThan(GIT_DIFF.length);
    });

    it("compacts git log to short-hash + message", () => {
      const result = bashGit.compact(GIT_LOG);
      expect(result).toContain("abc1234");
      expect(result).toContain("feat: add new feature");
      expect(result).toContain("9876543");
      expect(result).toContain("fix: resolve bug in parser");
      expect(result).not.toContain("Author:");
    });
  });
});

// ---------------------------------------------------------------------------
// bash-test.js
// ---------------------------------------------------------------------------
describe("bash-test", () => {
  const VITEST_OUTPUT = `\x1B[32m✓\x1B[39m src/utils.test.js (5 tests) 120ms
\x1B[32m✓\x1B[39m src/index.test.js (3 tests) 45ms
\x1B[31m✗\x1B[39m src/parser.test.js (1 test) 200ms

FAIL src/parser.test.js > parse > handles empty input
AssertionError: expected undefined to be ''

 Test Files  1 failed | 2 passed | 3 total
 Tests  1 failed | 8 passed | 9 total
 Duration  500ms`;

  const JEST_OUTPUT = `PASS src/utils.test.js
PASS src/index.test.js
FAIL src/parser.test.js
  ● parse › handles empty input

    expect(received).toBe(expected)

    Expected: ""
    Received: undefined

Test Suites: 1 failed, 2 passed, 3 total
Tests:       1 failed, 8 passed, 9 total`;

  describe("looksLike", () => {
    it("returns true for vitest output", () => {
      expect(bashTest.looksLike(VITEST_OUTPUT)).toBe(true);
    });

    it("returns true for jest output", () => {
      expect(bashTest.looksLike(JEST_OUTPUT)).toBe(true);
    });

    it("returns false for plain text", () => {
      expect(bashTest.looksLike("just some regular output")).toBe(false);
    });
  });

  describe("compact", () => {
    it("extracts test summary from vitest output", () => {
      const result = bashTest.compact(VITEST_OUTPUT);
      expect(result).toContain("1 failed");
      expect(result.length).toBeLessThan(VITEST_OUTPUT.length);
    });

    it("extracts test summary from jest output", () => {
      const result = bashTest.compact(JEST_OUTPUT);
      expect(result).toContain("Test Suites:");
      expect(result).toContain("1 failed");
    });
  });
});

// ---------------------------------------------------------------------------
// bash-build.js
// ---------------------------------------------------------------------------
describe("bash-build", () => {
  const TSC_OUTPUT = `src/index.ts(5,10): error TS2345: Argument of type 'string' is not assignable to parameter of type 'number'.
src/utils.ts(12,3): error TS2304: Cannot find name 'foobar'.
src/index.ts(20,1): error TS1005: ';' expected.

Found 3 errors in 2 files.`;

  const ESLINT_OUTPUT = `/home/user/project/src/index.js
  5:10  warning  Unexpected console statement  no-console
  12:1  error    'foo' is not defined          no-undef

/home/user/project/src/utils.js
  3:5   error    Missing semicolon             semi

✖ 3 problems (2 errors, 1 warning)`;

  describe("looksLike", () => {
    it("returns true for tsc error output", () => {
      expect(bashBuild.looksLike(TSC_OUTPUT)).toBe(true);
    });

    it("returns true for eslint output", () => {
      expect(bashBuild.looksLike(ESLINT_OUTPUT)).toBe(true);
    });

    it("returns false for unrelated output", () => {
      expect(bashBuild.looksLike("hello world")).toBe(false);
    });
  });

  describe("compact", () => {
    it("extracts errors from tsc output", () => {
      const result = bashBuild.compact(TSC_OUTPUT);
      expect(result).toContain("Errors (3)");
      expect(result).toContain("error TS2345");
      expect(result).toContain("Found 3 errors");
    });

    it("separates errors and warnings from eslint output", () => {
      const result = bashBuild.compact(ESLINT_OUTPUT);
      // Should contain error-related content
      expect(result.length).toBeLessThan(ESLINT_OUTPUT.length);
    });
  });
});

// ---------------------------------------------------------------------------
// bash-infra.js
// ---------------------------------------------------------------------------
describe("bash-infra", () => {
  const DOCKER_PS = `CONTAINER ID   IMAGE          COMMAND       CREATED       STATUS       PORTS                    NAMES
a1b2c3d4e5f6   nginx:latest   "nginx -g…"  2 hours ago   Up 2 hours   0.0.0.0:80->80/tcp       web
f6e5d4c3b2a1   redis:7        "redis-se…"  3 hours ago   Up 3 hours   0.0.0.0:6379->6379/tcp   cache`;

  const TERRAFORM_PLAN = `Refreshing state...
Refreshing state...
Refreshing state...

Terraform will perform the following actions:

  # aws_instance.web will be created
  + resource "aws_instance" "web" {
      + ami           = "ami-12345678"
      + instance_type = "t3.micro"
    }

  # aws_s3_bucket.data will be destroyed
  - resource "aws_s3_bucket" "data" {
      - bucket = "my-data-bucket"
    }

Plan: 1 to add, 0 to change, 1 to destroy.`;

  describe("looksLike", () => {
    it("returns true for docker ps output", () => {
      expect(bashInfra.looksLike(DOCKER_PS)).toBe(true);
    });

    it("returns true for terraform plan output", () => {
      expect(bashInfra.looksLike(TERRAFORM_PLAN)).toBe(true);
    });

    it("returns false for non-infra text", () => {
      expect(bashInfra.looksLike("just a regular log")).toBe(false);
    });
  });

  describe("compact", () => {
    it("compacts docker ps as table", () => {
      const result = bashInfra.compact(DOCKER_PS);
      expect(result).toContain("CONTAINER ID");
      expect(result).toContain("nginx");
    });

    it("compacts terraform plan keeping changes, removing refresh lines", () => {
      const result = bashInfra.compact(TERRAFORM_PLAN);
      expect(result).toContain("Plan: 1 to add");
      expect(result).not.toContain("Refreshing state");
      expect(result.length).toBeLessThan(TERRAFORM_PLAN.length);
    });
  });
});

// ---------------------------------------------------------------------------
// bash-pkg.js
// ---------------------------------------------------------------------------
describe("bash-pkg", () => {
  const NPM_INSTALL = `npm warn deprecated inflight@1.0.6: This module is not supported.
npm warn deprecated glob@7.2.3: Glob versions prior to v9 are no longer supported.

added 245 packages, and audited 246 packages in 12s

38 packages are looking for funding
  run \`npm fund\` for details

2 moderate severity vulnerabilities

To address all issues, run:
  npm audit fix`;

  const NPM_LIST = `my-project@1.0.0 /home/user/project
├── eslint@8.56.0
├── prettier@3.2.4
├── vitest@1.2.0
├── typescript@5.3.3
└── @types/node@20.11.0`;

  describe("looksLike", () => {
    it("returns true for npm install output", () => {
      expect(bashPkg.looksLike(NPM_INSTALL)).toBe(true);
    });

    it("returns true for npm list output", () => {
      expect(bashPkg.looksLike(NPM_LIST)).toBe(true);
    });

    it("returns false for non-package output", () => {
      expect(bashPkg.looksLike("Hello world")).toBe(false);
    });
  });

  describe("compact", () => {
    it("extracts summary from npm install", () => {
      const result = bashPkg.compact(NPM_INSTALL);
      expect(result).toContain("added 245 packages");
      expect(result).toContain("2 moderate severity vulnerabilities");
      expect(result).not.toContain("npm warn");
    });

    it("keeps npm list output when short", () => {
      const result = bashPkg.compact(NPM_LIST);
      expect(result).toContain("eslint");
    });
  });
});

// ---------------------------------------------------------------------------
// bash-misc.js
// ---------------------------------------------------------------------------
describe("bash-misc", () => {
  const CURL_OUTPUT = `HTTP/1.1 200 OK
content-type: application/json
x-request-id: abc-123
date: Mon, 01 Jan 2024 12:00:00 GMT
server: nginx
cache-control: no-cache

{"status":"ok","data":{"id":1,"name":"test"}}`;

  const GH_PR_LIST = `gh pr list
Showing 3 of 3 open pull requests in org/repo

#42  feat: add new feature    feature-branch    OPEN
#41  fix: resolve parser bug  fix/parser        OPEN
#40  chore: update deps       chore/deps        OPEN`;

  describe("looksLike", () => {
    it("returns true for curl output with HTTP status", () => {
      expect(bashMisc.looksLike(CURL_OUTPUT)).toBe(true);
    });

    it("returns true for gh CLI output", () => {
      expect(bashMisc.looksLike(GH_PR_LIST)).toBe(true);
    });

    it("returns false for plain text", () => {
      expect(bashMisc.looksLike("no http here")).toBe(false);
    });
  });

  describe("compact", () => {
    it("keeps HTTP status and relevant headers from curl", () => {
      const result = bashMisc.compact(CURL_OUTPUT);
      expect(result).toContain("HTTP/1.1 200 OK");
      expect(result).toContain("content-type:");
      expect(result).toContain("x-request-id:");
      // Should not keep generic server/date headers
      expect(result).not.toContain("server: nginx");
    });

    it("compacts gh CLI output", () => {
      const result = bashMisc.compact(GH_PR_LIST);
      expect(result).toContain("#42");
    });
  });
});

// ---------------------------------------------------------------------------
// grep.js
// ---------------------------------------------------------------------------
describe("grep", () => {
  const GREP_OUTPUT = `src/index.js:1:import { foo } from './foo.js';
src/index.js:5:  return foo();
src/index.js:10:export { foo };
src/index.js:15:// foo helper
src/index.js:20:const foobar = foo();
src/utils.js:3:import { foo } from './foo.js';
src/utils.js:7:foo();`;

  describe("looksLike", () => {
    it("returns true for grep-style file:line:content output", () => {
      expect(grepMod.looksLike(GREP_OUTPUT)).toBe(true);
    });

    it("returns false for plain text", () => {
      expect(grepMod.looksLike("no file references here\njust plain text")).toBe(false);
    });
  });

  describe("compact", () => {
    it("limits matches per file and shows total count", () => {
      const result = grepMod.compact(GREP_OUTPUT);
      expect(result).toContain("Total: 7 matches in 2 files");
      // First file should be truncated to 3 matches
      expect(result).toContain("2 more matches in src/index.js");
    });

    it("keeps all matches when under limit", () => {
      const small = "a.js:1:line1\nb.js:2:line2";
      const result = grepMod.compact(small);
      expect(result).toContain("a.js:1:line1");
      expect(result).toContain("b.js:2:line2");
    });
  });
});

// ---------------------------------------------------------------------------
// read.js
// ---------------------------------------------------------------------------
describe("read", () => {
  const SHORT_FILE = "import { foo } from './foo.js';\nexport default foo;";

  const LONG_FILE = Array.from(
    { length: 300 },
    (_, i) => `     ${i + 1}\timport something_${i};`
  ).join("\n");

  describe("looksLike", () => {
    it("returns false for short file content (below token threshold)", () => {
      expect(readMod.looksLike(SHORT_FILE)).toBe(false);
    });

    it("returns true for long numbered file content", () => {
      expect(readMod.looksLike(LONG_FILE)).toBe(true);
    });
  });

  describe("compact", () => {
    it("truncates long file content to max lines", () => {
      const result = readMod.compact(LONG_FILE);
      const resultLines = result.split("\n");
      // 200 lines + 1 truncation note
      expect(resultLines.length).toBeLessThanOrEqual(201);
      expect(result).toContain("more lines truncated");
    });

    it("returns short content unchanged", () => {
      expect(readMod.compact(SHORT_FILE)).toBe(SHORT_FILE);
    });
  });
});

// ---------------------------------------------------------------------------
// glob.js
// ---------------------------------------------------------------------------
describe("glob", () => {
  const SHORT_LIST = `src/index.js
src/utils.js
src/parser.js`;

  const LONG_LIST = Array.from({ length: 100 }, (_, i) => `src/module-${i}.js`).join("\n");

  describe("looksLike", () => {
    it("returns false for too-short file listing", () => {
      // Need at least 5 lines
      expect(globMod.looksLike(SHORT_LIST)).toBe(false);
    });

    it("returns true for long file listing", () => {
      expect(globMod.looksLike(LONG_LIST)).toBe(true);
    });

    it("returns false for non-path content", () => {
      const text = Array.from({ length: 10 }, (_, i) => `This is sentence ${i}`).join("\n");
      expect(globMod.looksLike(text)).toBe(false);
    });
  });

  describe("compact", () => {
    it("truncates long file listing with count", () => {
      const result = globMod.compact(LONG_LIST);
      expect(result).toContain("100 total files");
      expect(result).toContain("showing first 40");
      expect(result.split("\n").length).toBeLessThan(100);
    });

    it("returns short listing unchanged", () => {
      const fiveFiles = Array.from({ length: 5 }, (_, i) => `src/f${i}.js`).join("\n");
      expect(globMod.compact(fiveFiles)).toBe(fiveFiles);
    });
  });
});

// ---------------------------------------------------------------------------
// index.js — compressDeterministic dispatcher
// ---------------------------------------------------------------------------
describe("compressDeterministic", () => {
  it("dispatches git status to bash-git compressor", () => {
    const gitStatus = "On branch main\nChanges not staged for commit:\n\tmodified: src/index.js";
    const result = compressDeterministic(gitStatus, "Bash");
    expect(result.compressed).toBe(true);
    expect(result.text).toContain("On branch main");
  });

  it("dispatches grep output when toolName is Grep", () => {
    const grepOutput = Array.from(
      { length: 10 },
      (_, i) => `src/file.js:${i + 1}:const x = ${i};`
    ).join("\n");
    const result = compressDeterministic(grepOutput, "Grep");
    expect(result.compressed).toBe(true);
    expect(result.text).toContain("Total:");
  });

  it("dispatches glob output when toolName is Glob", () => {
    const globOutput = Array.from({ length: 60 }, (_, i) => `src/mod-${i}.js`).join("\n");
    const result = compressDeterministic(globOutput, "Glob");
    expect(result.compressed).toBe(true);
    expect(result.text).toContain("total files");
  });

  it("returns uncompressed when no pattern matches", () => {
    const plain = "Hello world, nothing special here.";
    const result = compressDeterministic(plain, "Bash");
    expect(result.compressed).toBe(false);
    expect(result.text).toBe(plain);
  });

  it("handles null/undefined input gracefully", () => {
    expect(compressDeterministic(null).text).toBe("");
    expect(compressDeterministic(undefined).compressed).toBe(false);
  });

  it("auto-detects test output without toolName hint", () => {
    const testOut = "Test Suites: 3 passed, 3 total\nTests: 15 passed, 15 total";
    const result = compressDeterministic(testOut);
    expect(result.compressed).toBe(true);
  });

  it("auto-detects npm install output as Bash", () => {
    const npmOut = "added 245 packages, and audited 246 packages in 12s\n2 moderate severity vulnerabilities";
    const result = compressDeterministic(npmOut, "Bash");
    expect(result.compressed).toBe(true);
    expect(result.text).toContain("added 245 packages");
  });
});
