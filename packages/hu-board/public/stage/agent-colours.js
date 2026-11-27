// KJC-TSK-1814 (the maintainer, 2026-11-27): each agent kj can run (src/agents/*-agent.js) is painted
// whole in a colour of its own, never a third-party logo. Claude, Codex and agy keep the colours the
// board already gave them. Pure: agent-figure.js paints with it.

export const AGENT_COLOURS = Object.freeze({
  claude: 0xd97757, codex: 0x9aa4ff, agy: 0x7ee0b5, gemini: 0x3b82f6, aider: 0xf2c94c,
  copilot: 0xb05ce6, kimi: 0xff6fae, opencode: 0x1fb5c9, qwen: 0x8bc34a,
});

/** One kj does not know yet wears a neutral grey. */
export const UNKNOWN_AGENT = 0xc0c8d0;

export const accentOf = (agent) => AGENT_COLOURS[agent] ?? UNKNOWN_AGENT;
