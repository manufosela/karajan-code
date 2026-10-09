// KJC-TSK-0966 (HUM-C, ADR 0018): the catalog of human acts is closed and the
// mechanism is one. A module of the catalog that skips it, or a writer of
// governance files that is not in it, turns this red and is named.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { HUMAN_ACTS } from "../../src/harden/human-act.js";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (rel) => fs.readFileSync(path.join(REPO_ROOT, rel), "utf8");
const listJs = (dir, out = []) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) listJs(p, out);
    else if (entry.isFile() && /\.(m?js)$/.test(entry.name)) out.push(p);
  }
  return out;
};

// What only a human act may write. Readers and verifiers are not writers.
const GOVERNANCE_FILES = ["supervisor-provenance.json", "supervisor-signers.json", "supervisor-phone.json", "rules.yml", "rules.local.yml", "security-level.json"];
const WRITES = /\b(writeFileSync|writeFile|appendFileSync|appendFile|renameSync|rename)\s*\(/;
// Libraries that write on behalf of a catalog act (the act calls them).
const LIBRARIES_OF = { "src/harden/phone-sign.js": ["phone-enroll", "supervisor-seal"] };
// Modules that NAME a governance file and write something else: each one with
// the file it really writes. A new one is added here only with that reason.
const KNOWN_READERS = {
  "src/commands/rules-compile.js": "writes the rules PROPOSAL, which only kj rules approve installs",
  "src/harden/phone-invite.js": "writes the once-per-version invitation marker, reads whether the phone is enrolled",
  "src/harden/sentinel-hooks.js": "writes the Sentinel's own state; names the supervisor files to protect them",
  "src/review/gate-gitignore.js": "writes .gitignore; names the governance files to keep them versioned",
};

describe("architecture/human-act-catalog (ADR 0018)", () => {
  const live = Object.entries(HUMAN_ACTS).filter(([, act]) => act.module);

  it("every act with a module runs through humanActOf/humanAct with its own id", () => {
    for (const [id, act] of live) {
      const text = read(act.module);
      expect(text, `${act.module} must import human-act.js`).toMatch(/from ["'][^"']*human-act\.js["']/);
      expect(text, `${act.module} must call humanActOf("${id}") or humanAct("${id}", …)`).toMatch(new RegExp(`humanAct(Of)?\\(\\s*["']${id}["']`));
    }
  });

  it("an act the ADR declares and kj does not have yet names its card", () => {
    for (const [id, act] of Object.entries(HUMAN_ACTS)) {
      if (!act.module) expect(act.pending, `${id} has no module and no pending card`).toMatch(/^KJC-TSK-\d{4}$/);
    }
  });

  it("no module outside the catalog writes a governance file", () => {
    const allowed = new Set([...live.map(([, act]) => act.module), ...Object.keys(LIBRARIES_OF), ...Object.keys(KNOWN_READERS)]);
    const offenders = [];
    for (const file of listJs(path.join(REPO_ROOT, "src"))) {
      const rel = path.relative(REPO_ROOT, file);
      if (allowed.has(rel) || rel === "src/harden/human-act.js") continue;
      const text = fs.readFileSync(file, "utf8");
      const named = GOVERNANCE_FILES.filter((name) => text.includes(name));
      if (named.length > 0 && WRITES.test(text)) offenders.push(`${rel} (names ${named.join(", ")} and writes files)`);
    }
    expect(offenders, "add the act to HUMAN_ACTS and run it through humanActOf, or list the module as a library of an act").toEqual([]);
  });
});
