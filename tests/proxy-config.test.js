import { describe, expect, it } from "vitest";
import { applyRunOverrides } from "../src/config.js";

function baseConfig() {
  return {
    review_mode: "standard",
    base_branch: "main",
    sonarqube: { enabled: true },
    session: {},
    reviewer_options: {},
    development: { methodology: "tdd", require_test_changes: true },
    git: { auto_commit: false, auto_push: false, auto_pr: false, auto_rebase: true, branch_prefix: "feat/" },
    proxy: {
      enabled: true,
      port: "auto",
      compression: {
        enabled: true,
        ai_compression: false,
        ai_model: "haiku",
        ai_provider: "anthropic",
        layers: {
          git: true,
          tests: true,
          build: true,
          infra: true,
          packages: true,
          read_dedup: true,
          glob_truncate: true,
          grep_collapse: true,
        },
        pressure_thresholds: { low: 0.5, medium: 0.8, high: 0.9 },
      },
      cache: { persist_to_disk: true, flush_interval_ms: 5000 },
      inject_prompts: true,
      monitor: true,
    },
  };
}

describe("proxy config", () => {
  it("has correct defaults", () => {
    const out = applyRunOverrides(baseConfig(), {});
    expect(out.proxy.enabled).toBe(true);
    expect(out.proxy.port).toBe("auto");
    expect(out.proxy.compression.enabled).toBe(true);
    expect(out.proxy.compression.ai_compression).toBe(false);
    expect(out.proxy.compression.ai_model).toBe("haiku");
    expect(out.proxy.compression.ai_provider).toBe("anthropic");
    expect(out.proxy.compression.layers.git).toBe(true);
    expect(out.proxy.compression.layers.tests).toBe(true);
    expect(out.proxy.compression.layers.build).toBe(true);
    expect(out.proxy.compression.layers.infra).toBe(true);
    expect(out.proxy.compression.layers.packages).toBe(true);
    expect(out.proxy.compression.layers.read_dedup).toBe(true);
    expect(out.proxy.compression.layers.glob_truncate).toBe(true);
    expect(out.proxy.compression.layers.grep_collapse).toBe(true);
    expect(out.proxy.compression.pressure_thresholds).toEqual({ low: 0.5, medium: 0.8, high: 0.9 });
    expect(out.proxy.cache.persist_to_disk).toBe(true);
    expect(out.proxy.cache.flush_interval_ms).toBe(5000);
    expect(out.proxy.inject_prompts).toBe(true);
    expect(out.proxy.monitor).toBe(true);
  });

  it("noProxy flag disables proxy", () => {
    const out = applyRunOverrides(baseConfig(), { noProxy: true });
    expect(out.proxy.enabled).toBe(false);
  });

  it("proxyPort override sets proxy port", () => {
    const out = applyRunOverrides(baseConfig(), { proxyPort: "8080" });
    expect(out.proxy.port).toBe("8080");
  });
});
