import { GeminiAgent } from "./gemini-agent.js";

/**
 * Qwen Code (@qwen-code/qwen-code, binary `qwen`) — KJC-TSK-0665.
 *
 * A gemini-cli fork with the same headless interface (prompt on stdin,
 * `--output-format json`, `--model`, identical usageMetadata shape), so it
 * inherits everything from GeminiAgent including the KJC-BUG-0121 stdin
 * contract. Cloud-backed and free with a Qwen account: the sixth built-in
 * agent, and the natural third AI for solomon arbitration now that the
 * gemini individual tier is retired.
 */
export class QwenAgent extends GeminiAgent {
  get cliBin() { return "qwen"; }
  // qwen has no workspace-trust gate. execa merges this object over
  // process.env, so the explicit undefined REMOVES gemini's var from the
  // child even when the parent shell exported it (manual workarounds) —
  // returning no env at all would let it leak through inheritance.
  get spawnEnv() { return { GEMINI_CLI_TRUST_WORKSPACE: undefined }; }
}
