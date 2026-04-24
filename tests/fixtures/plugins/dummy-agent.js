/**
 * Fixture plugin used by tests/plugins-wired.test.js to validate that
 * Karajan's plugin system is actually wired into bootstrap.
 *
 * Shape: a plugin exports `register(api)`. The api bundles the hooks the
 * plugin may use — currently `registerAgent(name, AgentClass, meta)`.
 * The plugin returns metadata with at least a `name` field so Karajan can
 * surface it in logs.
 *
 * This fixture registers an agent named "dummy" that returns a canned
 * response without spawning a subprocess. Tests check that after
 * bootstrap runs, `createAgent("dummy")` returns an instance whose
 * `runTask()` produces the fixture response.
 */

class DummyAgent {
  constructor(name, _config, _logger, _environment) {
    this.name = name;
  }
  async runTask() {
    return { ok: true, output: "dummy response", exitCode: 0 };
  }
  async reviewTask() {
    return { ok: true, output: '{"approved":true}', exitCode: 0 };
  }
}

export function register(api) {
  api.registerAgent("dummy", DummyAgent, { bin: null, installUrl: null, fixture: true });
  return { name: "dummy-agent" };
}
