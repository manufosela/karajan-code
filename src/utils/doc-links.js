/**
 * Documentation links for error messages.
 *
 * Maps error types to their relevant documentation page so that
 * every actionable error includes a "See: <url>" pointer.
 */

const BASE_URL = "https://karajancode.com/docs";

const ERROR_DOCS = {
  sonar_token: `${BASE_URL}/guides/configuration/#sonarqube`,
  sonar_docker: `${BASE_URL}/getting-started/installation/#docker`,
  agent_not_found: `${BASE_URL}/getting-started/installation/#agents`,
  bootstrap_failed: `${BASE_URL}/guides/troubleshooting/`,
  config_missing: `${BASE_URL}/getting-started/quick-start/`,
  branch_error: `${BASE_URL}/guides/pipeline/#git-workflow`,
  rtk_install: `${BASE_URL}/guides/configuration/#rtk`,
};

export function docLink(errorType) {
  return ERROR_DOCS[errorType] || `${BASE_URL}/guides/troubleshooting/`;
}

export function withDocLink(message, errorType) {
  const link = docLink(errorType);
  return `${message}\n  See: ${link}`;
}
