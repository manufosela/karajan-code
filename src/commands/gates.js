// KJC-TSK-1384 (ADR 0045): `kj gates` lists every rule, fixed and adjustable, with its
// value and who set it. Changing one comes with KJC-TSK-1385.
import { resolveRules, formatRules } from "../gates/registry.js";

export function gatesCommand({ config, flags = {}, print = console.log }) {
  const resolved = resolveRules(config);
  print(flags.json ? JSON.stringify(resolved, null, 2) : formatRules(resolved));
  return resolved;
}
