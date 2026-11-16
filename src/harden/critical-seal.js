/**
 * KJC-TSK-1654 (ADR 0060): at the critical level a seal is signed on the phone only when it
 * changes who governs, or when the CI that will judge it cannot read an unsigned seal yet.
 */
/** The first kj whose seal verifier reads an unsigned seal at critical (src/policy/supervisor-verify.js). */
export const CRITICAL_SINCE = [5, 27, 0];
const PIN = /(?:karajan-code|@karajan-family\/code)@(\d+)\.(\d+)\.(\d+)/;
const below = (a, b) => {
  const i = a.findIndex((n, k) => n !== b[k]);
  return i >= 0 && a[i] < b[i];
};

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
export function sealGoverns({ hashed, previous, isGovernance, run, baseBranch }) {
  if (hashed.some((e) => e.deleted === true)) return "the seal records a deletion";
  const before = new Map((previous?.files ?? []).map((e) => [e?.file, e?.sha256]));
  const changed = hashed.filter((e) => isGovernance(e.file) && before.get(e.file) !== e.sha256).map((e) => e.file);
  if (changed.length > 0) return `the seal changes the governance config (${changed.join(", ")})`;
  const pin = basePinOf(run, baseBranch);
  if (pin && below(pin, CRITICAL_SINCE)) return `the base branch's CI runs kj ${pin.join(".")}, which reads no unsigned seal`;
  return null;
}
