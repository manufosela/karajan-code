// A fake `kj` on the PATH of a generated-hook run, so the test does not depend on kj being
// installed on the machine (a CI runner has none). Returns the PATH to run the hook with.
import fs from "node:fs";
import path from "node:path";

export const SYSTEM_PATH = "/usr/bin:/bin";

export const fakeKjPath = (parentDir, { exitCode = 0, basePath = SYSTEM_PATH } = {}) => {
  const bin = fs.mkdtempSync(path.join(parentDir, "bin-kj-"));
  fs.writeFileSync(path.join(bin, "kj"), `#!/bin/sh\nexit ${exitCode}\n`, { mode: 0o755 });
  return `${bin}:${basePath}`;
};
