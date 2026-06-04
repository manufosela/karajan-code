// KJC-TSK-0375 PR2 — Extract structured tool calls from an agent transcript.
//
// The ToolCorrectnessJudgeRole (PR1) consumes a list of `{tool, args}`
// objects. The coder writes a raw transcript (provider-dependent format) to
// disk per iteration. This module bridges the two: parse the transcript,
// return the ordered list of tool invocations.
//
// Provider-agnostic interface; Claude stream-json is the only format
// implemented today. New providers add a branch below — keep parsers
// pure (no I/O), so the role tests can mock transcripts trivially.

const PROVIDER_PARSERS = {
  claude: parseClaudeStreamJson,
};

/**
 * Extract tool calls from a transcript string.
 *
 * @param {object} args
 * @param {string} args.transcript - raw agent output (stdout/stderr buffer).
 * @param {string} [args.provider] - "claude" (default). Unknown returns [].
 * @returns {Array<{tool:string, args:object}>}
 */
export function extractToolCalls({ transcript, provider = "claude" } = {}) {
  if (typeof transcript !== "string" || transcript.length === 0) return [];
  const parser = PROVIDER_PARSERS[provider];
  if (!parser) return [];
  return parser(transcript);
}

// Claude emits one JSON event per line. We care about `assistant` events
// whose `message.content` is an array containing `tool_use` blocks with
// `{type:"tool_use", name, input}`. Lines that fail to parse, that are
// not `assistant`, or whose content is not an array are silently skipped:
// the transcript also carries `system`, `result`, `rate_limit_event`, etc.
function parseClaudeStreamJson(transcript) {
  const out = [];
  for (const raw of transcript.split("\n")) {
    const line = raw.trim();
    if (!line || line[0] !== "{") continue;
    let obj;
    try { obj = JSON.parse(line); } catch { continue; }
    if (obj?.type !== "assistant") continue;
    const content = obj?.message?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (block?.type === "tool_use" && typeof block.name === "string") {
        out.push({
          tool: block.name,
          args: block.input && typeof block.input === "object" ? block.input : {},
        });
      }
    }
  }
  return out;
}
