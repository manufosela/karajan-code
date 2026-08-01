/**
 * privacy onboarding (KJC-TSK-0707, PV-D) — the user never fills YAML by
 * hand: `kj env install` asks and kj writes `~/.karajan/privacy.yml`.
 * Every question skips on Enter; answers are NEVER echoed back.
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { stringify as stringifyYaml } from "yaml";
import { privacyConfigPath } from "./scan.js";

export async function ensurePrivacyList({ wizard = null, logger = console, isTTY = process.stdout.isTTY } = {}) {
  const target = privacyConfigPath();
  if (existsSync(target)) return { created: false, reason: "present" };
  if (!isTTY || !wizard) {
    logger.info?.(`⚠ privacy: no personal denylist yet — re-run interactively or create ${target} (personal:/allow:) so YOUR data blocks at every outbound boundary`);
    return { created: false, reason: "non-interactive" };
  }
  logger.info?.("privacy: let's protect your personal data at every outbound boundary (Enter skips any question).");
  const csv = (s) => String(s || "").split(",").map((x) => x.trim()).filter(Boolean);
  const personal = [
    ...csv(await wizard.input("Personal emails that must NEVER be published (comma-separated):")),
    ...csv(await wizard.input("Personal phone / ID numbers to block (comma-separated, optional):")),
    ...csv(await wizard.input("Full name to block (optional):")),
  ];
  const allow = csv(await wizard.input("Public identities that are FINE to publish (handles, comma-separated):"));
  if (personal.length === 0 && allow.length === 0) {
    logger.info?.("privacy: skipped — generic PII detection still warns; create the denylist later to make YOUR data block");
    return { created: false, reason: "skipped" };
  }
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, `# kj privacy denylist — GLOBAL, never commit this file to any repo.\n${stringifyYaml({ personal, allow })}`);
  logger.info?.(`✓ privacy: denylist written to ${target} (${personal.length} entrada(s), values not echoed)`);
  return { created: true, entries: personal.length };
}
