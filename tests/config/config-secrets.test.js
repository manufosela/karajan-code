// KJC-TSK-1234 (ADR 0032): the project's kj.config.yml travels with the repo, so it is judged by
// its parsed YAML: a value in sonarqube.token, sonarqube.admin_password or sonarcloud.token is a
// secret, however the YAML spells it.
import { describe, expect, it } from "vitest";
import { configSecrets } from "../../src/config/secrets.js";

describe("configSecrets", () => {
  it("finds every schema secret with a value, in any YAML form", () => {
    for (const text of [
      "sonarqube:\n  token: sqp_abc\n",
      "sonarqube: { host: h, token: sqp_flow }\n",
      "sonarqube:\n  \"token\": sqp_quoted\n",
      "sonarqube:\n  \"to\\u006ben\": sqp_escaped\n",
      "sonarqube:\n  token: \" secret\"\n",
      "sonarqube:\n  token: |\n    sqp_multiline\n",
      "base: &b\n  token: sqp_anchor\nsonarqube:\n  <<: *b\n",
    ]) {
      expect(configSecrets(text), text).toEqual(["sonarqube.token"]);
    }
    expect(configSecrets("sonarqube: {'admin_password': 'pw'}\nsonarcloud:\n  token: sc\n")).toEqual(["sonarqube.admin_password", "sonarcloud.token"]);
  });

  it("lets empty secrets and keys that only contain the word through", () => {
    expect(configSecrets("sonarqube:\n  token:\n  admin_password: null\nsonarcloud:\n  token: \"\"\nguards:\n  non_secret_assignments: [a]\n  token: x\n")).toEqual([]);
    expect(configSecrets("")).toEqual([]);
  });

  it("fails on a duplicated key, which could hide a secret behind an empty value", () => {
    expect(() => configSecrets("sonarqube:\n  token: sqp_abc\n  token: \"\"\n")).toThrow(/duplicated mapping key/);
  });
});
