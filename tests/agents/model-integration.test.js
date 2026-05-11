import { describe, expect, it } from "vitest";
import { getRegisteredModels } from "../src/agents/model-registry.js";
import { getDefaultModelTiers } from "../src/utils/model-selector.js";

describe("Model Registry & Selector Integration", () => {
  it("ensures all models in default selector tiers are registered in the registry", () => {
    const registeredModels = new Set(getRegisteredModels().map(m => m.name));
    const tiers = getDefaultModelTiers();

    const missingModels = [];

    for (const [provider, levels] of Object.entries(tiers)) {
      for (const [level, modelName] of Object.entries(levels)) {
        if (modelName && !registeredModels.has(modelName)) {
          missingModels.push(`${provider}/${level}: ${modelName}`);
        }
      }
    }

    expect(missingModels, `The following models are used in selector tiers but not registered: ${missingModels.join(", ")}`)
      .toHaveLength(0);
  });
});
