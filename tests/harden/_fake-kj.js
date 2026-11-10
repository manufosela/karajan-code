// A fake `kj` on the PATH of a generated-hook run, so the test does not depend on kj being
// installed on the machine (a CI runner has none). Returns the PATH to run the hook with.
import fs from "node:fs";
import path from "node:path";

export const SYSTEM_PATH = "/usr/bin:/bin";

// A PATH holding only the basics a generated hook needs. A CI runner has go, gofmt and the like
// in /usr/bin, so a test of "tool not installed" cannot lean on the system PATH.
export const bareToolsPath = (parentDir, tools = ["sh", "git", "grep", "sed", "head", "dirname"]) => {
  const bin = fs.mkdtempSync(path.join(parentDir, "bin-bare-"));
  for (const tool of tools) {
    const real = SYSTEM_PATH.split(":").map((dir) => path.join(dir, tool)).find((file) => fs.existsSync(file));
    if (!real) throw new Error(`${tool} not found on ${SYSTEM_PATH}`);
    fs.symlinkSync(real, path.join(bin, tool));
  }
  return bin;
};

export const fakeKjPath =(parentDir, { exitCode = 0, basePath = SYSTEM_PATH } = {}) => {
  const bin = fs.mkdtempSync(path.join(parentDir, "bin-kj-"));
  fs.writeFileSync(path.join(bin, "kj"), `#!/bin/sh\nexit ${exitCode}\n`, { mode: 0o755 });
  return `${bin}:${basePath}`;
};
