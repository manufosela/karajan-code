// KJC-TSK-0919 (SNT-B2, ADR 0014): the bash-write guard as a real module, tested
// by unit: which files a simple command writes, and whether each is the repo's.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { shellWrites, writesRepo } from "../../src/harden/sentinel/sentinel-bash-write.mjs";
import { shellSegments } from "../../src/harden/sentinel/sentinel-shell.mjs";

const writes = (cmd) => shellSegments(cmd).flatMap((w) => shellWrites(w));

describe("shellWrites", () => {
  it("names the targets of redirections and of the writing commands", () => {
    expect(writes("cat >> src/a.py << 'EOF'")).toEqual(["src/a.py"]);
    expect(writes("echo x>f 2>&1 >&2 3>&-")).toEqual(["f"]);
    expect(writes("echo x | tee -a /tmp/o src/a")).toEqual(["/tmp/o", "src/a"]);
    expect(writes("sed -i 's/a/b/' src/a.py")).toEqual(["src/a.py"]);
    expect(writes("cp -t src /tmp/x")).toEqual(["src"]);
    expect(writes("touch -d today today")).toEqual(["today"]);
    expect(writes("dd if=/dev/zero of=src/blob")).toEqual(["src/blob"]);
  });

  it("reads through wrappers, nested shells and eval, and marks the unknowable", () => {
    expect(writes("sudo -u root cp /tmp/x src/a")).toEqual(["src/a"]);
    expect(writes("sh -c 'echo x > src/a'")).toEqual(["src/a"]);
    expect(writes("printf src/a | xargs touch")).toEqual(["$(xargs)"]);
    expect(writes("node -e \"require('fs').writeFileSync('x','y')\"")).toEqual(["$(node)"]);
  });

  it("finds nothing in reads", () => {
    for (const cmd of ["cat src/a.py", "grep -rn x src", "tee /tmp/o < src/a", "git mv a b", "echo 'a > b'"]) expect(writes(cmd).filter((t) => !t.startsWith("/tmp")), cmd).toEqual([]);
  });
});

describe("writesRepo", () => {
  let root;
  beforeEach(() => { root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "kj-bw-mod-"))); });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it("is true inside the repo (even through a link) and for the unknowable, false outside", () => {
    expect(writesRepo("src/a.py", root)).toBe(true);
    expect(writesRepo("$OUT", root)).toBe(true);
    expect(writesRepo("~someone/x", root)).toBe(true);
    for (const t of ["/tmp/x", "/dev/null", "&1"]) expect(writesRepo(t, root), t).toBe(false);
    const link = path.join(os.tmpdir(), `kj-bw-link-${path.basename(root)}`);
    fs.symlinkSync(root, link);
    try { expect(writesRepo(`${link}/src/a.py`, root)).toBe(true); } finally { fs.unlinkSync(link); }
  });
});
