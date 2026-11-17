/**
 * KJC-TSK-1654 (ADR 0060): at the critical level a seal is signed on the phone only when it
 * changes who governs, or when the CI that will judge it cannot read an unsigned seal yet.
 */
/**
 * The first kj whose seal verifier reads an unsigned seal at critical (src/policy/supervisor-verify.js).
 * HU-4527: 5.27.0 could not back the machine-local host settings, so a base CI on it still gets a signed seal.
 */
export const CRITICAL_SINCE = [5, 27, 1];
const PIN = /(?:karajan-code|@karajan-family\/code)@(\d+)\.(\d+)\.(\d+)/;
const below = (a, b) => {
  const i = a.findIndex((n, k) => n !== b[k]);
  return i >= 0 && a[i] < b[i];
};

/** Whether a kj version (as [major, minor, patch]) is older than the first that reads an unsigned seal. */
export const predatesCritical = (pin) => Array.isArray(pin) && below(pin, CRITICAL_SINCE);

const PINS = /(?:karajan-code|@karajan-family\/code)@(\d+)\.(\d+)\.(\d+)/g;
const versionsOf = (text) => [...text.matchAll(PINS)].map((m) => m.slice(1).map(Number));

/**
 * ADR 0060 (step 2c): a workflow whose only change is the kj it pins, moved to a newer version,
 * is what every release re-seal brings. Anything else in it, or an older kj, is not.
 */
export function pinOnlyUpgrade(before, after) {
  if (typeof before !== "string" || typeof after !== "string" || before === after) return false;
  // Only the version is masked: the package each pin names must stay the same.
  const masked = (text) => text.replace(PINS, (pin) => pin.replace(/@\d+\.\d+\.\d+$/, "@kj"));
  if (masked(before) !== masked(after)) return false;
  const [was, now] = [versionsOf(before), versionsOf(after)];
  return now.length > 0 && now.length === was.length && now.every((v, i) => !below(v, was[i])) && now.some((v, i) => below(was[i], v));
}

/**
 * The commit a change is judged against: the merge base of a three-dot range, the left side of a
 * two-dot one, HEAD when staged; null when git cannot tell. `run(args)` gives git's stdout.
 */
export async function sealBase(run, range) {
  if (!range) return "HEAD";
  const [left, right] = range.split(/\.{2,3}/);
  if (!range.includes("...")) return left || "HEAD";
  try { return String(await run(["merge-base", left || "HEAD", right || "HEAD"])).trim() || null; } catch { return null; }
}

const show = (run, spec) => {
  try { return run(["show", spec]); } catch { return null; }
};

/**
 * The kj the base branch's verdicts workflow judges with, or null when it has none. Like the
 * workflow: the base's own bin/kj.js when it has one (kj's source), else the npm pin it installs.
 */
export function basePinOf(run, baseBranch = "main") {
  if (show(run, `${baseBranch}:bin/kj.js`) !== null) {
    let version;
    try { version = JSON.parse(show(run, `${baseBranch}:package.json`) ?? "{}").version; } catch { version = null; }
    const m = /^(\d+)\.(\d+)\.(\d+)/.exec(String(version ?? ""));
    return m ? m.slice(1).map(Number) : null;
  }
  const m = PIN.exec(show(run, `${baseBranch}:.github/workflows/kj-verdicts.yml`) ?? "");
  return m ? m.slice(1).map(Number) : null;
}

/**
 * Why this seal still needs the phone at critical, or null when it does not.
 * `isGovernance(file)`: the sealed config test of supervisor-commit.js (passed in, no import cycle).
 * @param {{hashed: object[], previous: object|null, isGovernance: (file: string) => boolean, run: Function, baseBranch?: string}} opts
 */
export function sealGoverns({ hashed, previous, isGovernance, run, baseBranch = "main", readNow = () => null }) {
  if (hashed.some((e) => e.deleted === true)) return "the seal records a deletion";
  const before = new Map((previous?.files ?? []).map((e) => [e?.file, e?.sha256]));
  // Step 2c: a workflow whose only change from the base is the kj it pins, moved up, governs nothing new.
  const pinBump = (file) => file.startsWith(".github/workflows/") && pinOnlyUpgrade(show(run, `${baseBranch}:${file}`), readNow(file));
  const changed = hashed.filter((e) => isGovernance(e.file) && before.get(e.file) !== e.sha256 && !pinBump(e.file)).map((e) => e.file);
  if (changed.length > 0) return `the seal changes the governance config (${changed.join(", ")})`;
  const pin = basePinOf(run, baseBranch);
  if (predatesCritical(pin)) return `the base branch's CI runs kj ${pin.join(".")}, which reads no unsigned seal`;
  return null;
}
