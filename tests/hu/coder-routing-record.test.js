// KJC-TSK-1071 (MR-D3): each HU keeps its coder's routing decision (tier,
// model, effort, whether it climbed, why) and kj report counts them, so MR-E
// can tell whether routing pays off and model_routing.enabled can turn it off.
import { describe, it, expect } from "vitest";
import { applyCoderRoute } from "../../src/hu/coder-routing.js";
import { modelTally, formatModelTally } from "../../src/report/model-tally.js";

const config = () => ({ coder: "claude", roles: { coder: { provider: null, model: null } } });
const logger = { info: () => {} };

describe("the HU records its routing", () => {
  it("keeps the last route, and whether it ever climbed", () => {
    const story = { id: "HU-1", complexity: { tier: "trivial" } };
    applyCoderRoute({ laneConfig: {}, story, attempt: 1, config: config(), logger });
    expect(story.coder_routing).toMatchObject({ tier: "trivial", model: "haiku", effort: "low", escalated: false });
    applyCoderRoute({ laneConfig: {}, story, attempt: 2, config: config(), logger });
    expect(story.coder_routing).toMatchObject({ model: "opus", escalated: true });
    const deep = { id: "HU-2", complexity: { tier: "deep" } };
    applyCoderRoute({ laneConfig: {}, story: deep, attempt: 1, config: config(), logger });
    expect(deep.coder_routing).toMatchObject({ tier: "deep", model: null, escalated: false });
  });
});

describe("kj report counts routed and escalated HUs", () => {
  it("adds a routing line", () => {
    const hu = (routing) => ({ outcome: { status: "done", coder: { model: "haiku" }, coder_routing: routing } });
    const tally = modelTally([hu({ model: "haiku", escalated: false }), hu({ model: "opus", escalated: true }), hu({ model: null, escalated: false })]);
    expect(tally.routing).toEqual({ routed: 2, escalated: 1 });
    expect(formatModelTally(tally)).toMatch(/Routing: 2 HU routed, 1 climbed to the top model/);
  });
});
