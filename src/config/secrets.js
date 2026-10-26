/**
 * KJC-TSK-1234 (ADR 0032): the project's kj.config.yml travels with the repo, so it must never
 * hold a secret. It is judged by its parsed YAML (escaped keys, flow mappings, anchors and merge
 * keys all resolved), never by its raw text. The parse is strict: a duplicated key fails, since a
 * second empty value could hide a secret written before it.
 */
import fs from "node:fs";
import yaml from "js-yaml";

export const SECRET_PATHS = [["sonarqube", "token"], ["sonarqube", "admin_password"], ["sonarcloud", "token"]];

/** @returns {string[]} the secret paths that hold a value (empty, null and absent are fine) */
export function configSecrets(text) {
  const doc = yaml.load(text) ?? {};
  return SECRET_PATHS
    .filter(([section, key]) => {
      const value = doc?.[section]?.[key];
      return value !== undefined && value !== null && value !== "";
    })
    .map((path) => path.join("."));
}

/** `kj config --check-secrets <file|->`: exit 1 naming each secret, or when the file cannot be read. */
export function checkSecretsCommand(file, { logger = console } = {}) {
  let found;
  try {
    found = configSecrets(fs.readFileSync(file === "-" ? 0 : file, "utf8"));
  } catch (err) {
    logger.error(`kj: cannot check ${file} for secrets (${err.message})`);
    process.exitCode = 1;
    return;
  }
  if (found.length === 0) return;
  logger.error(`kj: ${file} holds a secret (${found.join(", ")}): move it to .karajan/kj.config.local.yml or ~/.karajan`);
  process.exitCode = 1;
}
