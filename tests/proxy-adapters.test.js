import { describe, it, expect } from "vitest";
import * as anthropicAdapter from "../src/proxy/adapters/anthropic.js";
import * as openaiAdapter from "../src/proxy/adapters/openai.js";
import * as geminiAdapter from "../src/proxy/adapters/gemini.js";
import { getAdapter, detectProvider } from "../src/proxy/adapters/index.js";

// ═══════════════════════════════════════════════════════════════════
// Anthropic adapter
// ═══════════════════════════════════════════════════════════════════

describe("anthropic adapter", () => {
  const sampleMessages = [
    {
      role: "assistant",
      content: [
        {
          type: "tool_use",
          id: "toolu_01A",
          name: "Read",
          input: { file_path: "/src/index.js" },
        },
      ],
    },
    {
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: "toolu_01A",
          content: "const app = express();\napp.listen(3000);\n// ... 200 lines ...",
        },
      ],
    },
    {
      role: "assistant",
      content: [
        {
          type: "tool_use",
          id: "toolu_01B",
          name: "Bash",
          input: { command: "npm test" },
        },
      ],
    },
    {
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: "toolu_01B",
          content: [
            { type: "text", text: "PASS src/index.test.js\n  10 tests passed" },
          ],
        },
      ],
    },
  ];

  describe("extractToolResults", () => {
    it("extracts tool results with correct ids and tool names", () => {
      const results = anthropicAdapter.extractToolResults(sampleMessages);
      expect(results).toHaveLength(2);

      expect(results[0]).toEqual({
        id: "toolu_01A",
        toolName: "Read",
        text: "const app = express();\napp.listen(3000);\n// ... 200 lines ...",
        turnIndex: 1,
      });

      expect(results[1]).toEqual({
        id: "toolu_01B",
        toolName: "Bash",
        text: "PASS src/index.test.js\n  10 tests passed",
        turnIndex: 3,
      });
    });

    it("handles empty messages array", () => {
      expect(anthropicAdapter.extractToolResults([])).toEqual([]);
    });

    it("skips messages without content array", () => {
      const msgs = [{ role: "user", content: "hello" }];
      expect(anthropicAdapter.extractToolResults(msgs)).toEqual([]);
    });

    it("handles tool_result with no content", () => {
      const msgs = [
        {
          role: "assistant",
          content: [{ type: "tool_use", id: "t1", name: "Bash" }],
        },
        {
          role: "user",
          content: [{ type: "tool_result", tool_use_id: "t1" }],
        },
      ];
      const results = anthropicAdapter.extractToolResults(msgs);
      expect(results).toHaveLength(1);
      expect(results[0].text).toBe("");
    });

    it("handles multiple tool results in a single message", () => {
      const msgs = [
        {
          role: "assistant",
          content: [
            { type: "tool_use", id: "t1", name: "Read" },
            { type: "tool_use", id: "t2", name: "Grep" },
          ],
        },
        {
          role: "user",
          content: [
            { type: "tool_result", tool_use_id: "t1", content: "file A contents" },
            { type: "tool_result", tool_use_id: "t2", content: "grep results" },
          ],
        },
      ];
      const results = anthropicAdapter.extractToolResults(msgs);
      expect(results).toHaveLength(2);
      expect(results[0].toolName).toBe("Read");
      expect(results[1].toolName).toBe("Grep");
    });

    it("extracts text from array content with multiple text blocks", () => {
      const msgs = [
        {
          role: "assistant",
          content: [{ type: "tool_use", id: "t1", name: "Bash" }],
        },
        {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "t1",
              content: [
                { type: "text", text: "line 1" },
                { type: "text", text: "line 2" },
              ],
            },
          ],
        },
      ];
      const results = anthropicAdapter.extractToolResults(msgs);
      expect(results[0].text).toBe("line 1\nline 2");
    });

    it("uses 'id' field when tool_use_id is absent", () => {
      const msgs = [
        {
          role: "user",
          content: [{ type: "tool_result", id: "fallback_id", content: "data" }],
        },
      ];
      const results = anthropicAdapter.extractToolResults(msgs);
      expect(results[0].id).toBe("fallback_id");
    });
  });

  describe("rebuildMessages", () => {
    it("replaces tool result text with compressed version (string content)", () => {
      const compressed = { toolu_01A: "[compressed] Express app, 200 lines" };
      const rebuilt = anthropicAdapter.rebuildMessages(sampleMessages, compressed);

      expect(rebuilt[1].content[0].content).toBe("[compressed] Express app, 200 lines");
      // Unmodified message (structurally equal, new object from map)
      expect(rebuilt[0]).toStrictEqual(sampleMessages[0]);
    });

    it("replaces tool result text with compressed version (array content)", () => {
      const compressed = { toolu_01B: "[compressed] 10 tests passed" };
      const rebuilt = anthropicAdapter.rebuildMessages(sampleMessages, compressed);

      expect(rebuilt[3].content[0].content[0].text).toBe("[compressed] 10 tests passed");
    });

    it("accepts Map as compressedMap", () => {
      const map = new Map([["toolu_01A", "compressed"]]);
      const rebuilt = anthropicAdapter.rebuildMessages(sampleMessages, map);
      expect(rebuilt[1].content[0].content).toBe("compressed");
    });

    it("leaves messages unchanged when id not in map", () => {
      const rebuilt = anthropicAdapter.rebuildMessages(sampleMessages, {});
      expect(rebuilt[1].content[0].content).toBe(sampleMessages[1].content[0].content);
    });

    it("roundtrip: extract then rebuild produces valid replacement", () => {
      const results = anthropicAdapter.extractToolResults(sampleMessages);
      const compressedMap = {};
      for (const r of results) {
        compressedMap[r.id] = `[compressed] ${r.text.slice(0, 20)}`;
      }
      const rebuilt = anthropicAdapter.rebuildMessages(sampleMessages, compressedMap);
      const reExtracted = anthropicAdapter.extractToolResults(rebuilt);

      expect(reExtracted).toHaveLength(results.length);
      for (let i = 0; i < results.length; i++) {
        expect(reExtracted[i].id).toBe(results[i].id);
        expect(reExtracted[i].text).toContain("[compressed]");
      }
    });
  });
});

// ═══════════════════════════════════════════════════════════════════
// OpenAI adapter
// ═══════════════════════════════════════════════════════════════════

describe("openai adapter", () => {
  const sampleMessages = [
    { role: "system", content: "You are a helpful assistant." },
    { role: "user", content: "Read the file src/index.js" },
    {
      role: "assistant",
      content: null,
      tool_calls: [
        {
          id: "call_abc123",
          type: "function",
          function: { name: "read_file", arguments: '{"path":"src/index.js"}' },
        },
      ],
    },
    {
      role: "tool",
      tool_call_id: "call_abc123",
      content: "const app = express();\napp.listen(3000);",
    },
    {
      role: "assistant",
      content: null,
      tool_calls: [
        {
          id: "call_def456",
          type: "function",
          function: { name: "run_command", arguments: '{"cmd":"npm test"}' },
        },
      ],
    },
    {
      role: "tool",
      tool_call_id: "call_def456",
      content: "PASS: 10 tests passed, 0 failed",
    },
  ];

  describe("extractToolResults", () => {
    it("extracts tool messages with correct ids and function names", () => {
      const results = openaiAdapter.extractToolResults(sampleMessages);
      expect(results).toHaveLength(2);

      expect(results[0]).toEqual({
        id: "call_abc123",
        toolName: "read_file",
        text: "const app = express();\napp.listen(3000);",
        turnIndex: 3,
      });

      expect(results[1]).toEqual({
        id: "call_def456",
        toolName: "run_command",
        text: "PASS: 10 tests passed, 0 failed",
        turnIndex: 5,
      });
    });

    it("handles empty messages array", () => {
      expect(openaiAdapter.extractToolResults([])).toEqual([]);
    });

    it("skips non-tool messages", () => {
      const msgs = [
        { role: "user", content: "hi" },
        { role: "assistant", content: "hello" },
      ];
      expect(openaiAdapter.extractToolResults(msgs)).toEqual([]);
    });

    it("handles tool message with missing tool_call_id", () => {
      const msgs = [{ role: "tool", content: "some output" }];
      const results = openaiAdapter.extractToolResults(msgs);
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe("");
      expect(results[0].toolName).toBe("unknown");
    });
  });

  describe("rebuildMessages", () => {
    it("replaces tool message content with compressed version", () => {
      const compressed = { call_abc123: "[compressed] Express app startup" };
      const rebuilt = openaiAdapter.rebuildMessages(sampleMessages, compressed);

      expect(rebuilt[3].content).toBe("[compressed] Express app startup");
      expect(rebuilt[3].role).toBe("tool");
      expect(rebuilt[3].tool_call_id).toBe("call_abc123");
      // Unmodified
      expect(rebuilt[5].content).toBe("PASS: 10 tests passed, 0 failed");
    });

    it("accepts Map as compressedMap", () => {
      const map = new Map([["call_def456", "compressed test output"]]);
      const rebuilt = openaiAdapter.rebuildMessages(sampleMessages, map);
      expect(rebuilt[5].content).toBe("compressed test output");
    });

    it("leaves messages unchanged when id not in map", () => {
      const rebuilt = openaiAdapter.rebuildMessages(sampleMessages, {});
      expect(rebuilt[3].content).toBe(sampleMessages[3].content);
    });

    it("roundtrip: extract then rebuild produces valid replacement", () => {
      const results = openaiAdapter.extractToolResults(sampleMessages);
      const compressedMap = {};
      for (const r of results) {
        compressedMap[r.id] = `[compressed] ${r.text.slice(0, 15)}`;
      }
      const rebuilt = openaiAdapter.rebuildMessages(sampleMessages, compressedMap);
      const reExtracted = openaiAdapter.extractToolResults(rebuilt);

      expect(reExtracted).toHaveLength(results.length);
      for (let i = 0; i < results.length; i++) {
        expect(reExtracted[i].id).toBe(results[i].id);
        expect(reExtracted[i].text).toContain("[compressed]");
      }
    });
  });
});

// ═══════════════════════════════════════════════════════════════════
// Gemini adapter
// ═══════════════════════════════════════════════════════════════════

describe("gemini adapter", () => {
  const sampleMessages = [
    {
      role: "user",
      parts: [{ text: "Read the config file" }],
    },
    {
      role: "model",
      parts: [
        {
          functionCall: {
            name: "readFile",
            args: { path: "config.yaml" },
          },
        },
      ],
    },
    {
      role: "function",
      parts: [
        {
          functionResponse: {
            name: "readFile",
            response: { content: "port: 3000\nhost: localhost\ndebug: true" },
          },
        },
      ],
    },
    {
      role: "model",
      parts: [{ text: "The config has port 3000." }],
    },
    {
      role: "model",
      parts: [
        {
          functionCall: {
            name: "runCommand",
            args: { cmd: "npm test" },
          },
        },
      ],
    },
    {
      role: "function",
      parts: [
        {
          functionResponse: {
            name: "runCommand",
            response: { result: "All 15 tests passed" },
          },
        },
      ],
    },
  ];

  describe("extractToolResults", () => {
    it("extracts function responses with synthetic ids", () => {
      const results = geminiAdapter.extractToolResults(sampleMessages);
      expect(results).toHaveLength(2);

      expect(results[0]).toEqual({
        id: "gemini-2-0",
        toolName: "readFile",
        text: "port: 3000\nhost: localhost\ndebug: true",
        turnIndex: 2,
      });

      expect(results[1]).toEqual({
        id: "gemini-5-0",
        toolName: "runCommand",
        text: "All 15 tests passed",
        turnIndex: 5,
      });
    });

    it("handles empty messages array", () => {
      expect(geminiAdapter.extractToolResults([])).toEqual([]);
    });

    it("skips messages without parts", () => {
      const msgs = [{ role: "user" }];
      expect(geminiAdapter.extractToolResults(msgs)).toEqual([]);
    });

    it("handles multiple function responses in a single turn", () => {
      const msgs = [
        {
          role: "function",
          parts: [
            {
              functionResponse: {
                name: "readFile",
                response: { content: "file A" },
              },
            },
            {
              functionResponse: {
                name: "readFile",
                response: { content: "file B" },
              },
            },
          ],
        },
      ];
      const results = geminiAdapter.extractToolResults(msgs);
      expect(results).toHaveLength(2);
      expect(results[0].id).toBe("gemini-0-0");
      expect(results[1].id).toBe("gemini-0-1");
      expect(results[0].text).toBe("file A");
      expect(results[1].text).toBe("file B");
    });

    it("serializes structured response objects to JSON", () => {
      const msgs = [
        {
          role: "function",
          parts: [
            {
              functionResponse: {
                name: "getWeather",
                response: { temperature: 22, unit: "C" },
              },
            },
          ],
        },
      ];
      const results = geminiAdapter.extractToolResults(msgs);
      expect(results[0].text).toBe('{"temperature":22,"unit":"C"}');
    });

    it("handles response as plain string", () => {
      const msgs = [
        {
          role: "function",
          parts: [
            {
              functionResponse: {
                name: "echo",
                response: "hello world",
              },
            },
          ],
        },
      ];
      const results = geminiAdapter.extractToolResults(msgs);
      expect(results[0].text).toBe("hello world");
    });

    it("handles null/missing response", () => {
      const msgs = [
        {
          role: "function",
          parts: [{ functionResponse: { name: "noop" } }],
        },
      ];
      const results = geminiAdapter.extractToolResults(msgs);
      expect(results[0].text).toBe("");
    });
  });

  describe("rebuildMessages", () => {
    it("replaces function response content with compressed version", () => {
      const compressed = { "gemini-2-0": "[compressed] config yaml" };
      const rebuilt = geminiAdapter.rebuildMessages(sampleMessages, compressed);

      expect(rebuilt[2].parts[0].functionResponse.response.content).toBe(
        "[compressed] config yaml",
      );
      // Unmodified
      expect(rebuilt[5].parts[0].functionResponse.response.result).toBe(
        "All 15 tests passed",
      );
    });

    it("replaces response with result field", () => {
      const compressed = { "gemini-5-0": "[compressed] tests ok" };
      const rebuilt = geminiAdapter.rebuildMessages(sampleMessages, compressed);
      expect(rebuilt[5].parts[0].functionResponse.response.result).toBe(
        "[compressed] tests ok",
      );
    });

    it("accepts Map as compressedMap", () => {
      const map = new Map([["gemini-2-0", "compressed"]]);
      const rebuilt = geminiAdapter.rebuildMessages(sampleMessages, map);
      expect(rebuilt[2].parts[0].functionResponse.response.content).toBe("compressed");
    });

    it("leaves messages unchanged when id not in map", () => {
      const rebuilt = geminiAdapter.rebuildMessages(sampleMessages, {});
      expect(rebuilt[2].parts[0].functionResponse.response.content).toBe(
        "port: 3000\nhost: localhost\ndebug: true",
      );
    });

    it("roundtrip: extract then rebuild produces valid replacement", () => {
      const results = geminiAdapter.extractToolResults(sampleMessages);
      const compressedMap = {};
      for (const r of results) {
        compressedMap[r.id] = `[compressed] ${r.text.slice(0, 15)}`;
      }
      const rebuilt = geminiAdapter.rebuildMessages(sampleMessages, compressedMap);
      const reExtracted = geminiAdapter.extractToolResults(rebuilt);

      expect(reExtracted).toHaveLength(results.length);
      for (let i = 0; i < results.length; i++) {
        expect(reExtracted[i].id).toBe(results[i].id);
        expect(reExtracted[i].text).toContain("[compressed]");
      }
    });
  });
});

// ═══════════════════════════════════════════════════════════════════
// Adapter registry (index.js)
// ═══════════════════════════════════════════════════════════════════

describe("adapter registry", () => {
  describe("getAdapter", () => {
    it("returns anthropic adapter", () => {
      const adapter = getAdapter("anthropic");
      expect(adapter).not.toBeNull();
      expect(typeof adapter.extractToolResults).toBe("function");
      expect(typeof adapter.rebuildMessages).toBe("function");
    });

    it("returns openai adapter", () => {
      const adapter = getAdapter("openai");
      expect(adapter).not.toBeNull();
      expect(typeof adapter.extractToolResults).toBe("function");
      expect(typeof adapter.rebuildMessages).toBe("function");
    });

    it("returns gemini adapter", () => {
      const adapter = getAdapter("gemini");
      expect(adapter).not.toBeNull();
      expect(typeof adapter.extractToolResults).toBe("function");
      expect(typeof adapter.rebuildMessages).toBe("function");
    });

    it("returns null for unknown provider", () => {
      expect(getAdapter("cohere")).toBeNull();
      expect(getAdapter("")).toBeNull();
    });
  });

  describe("detectProvider", () => {
    it("detects Anthropic from hostname", () => {
      expect(detectProvider("api.anthropic.com")).toBe("anthropic");
    });

    it("detects OpenAI from hostname", () => {
      expect(detectProvider("api.openai.com")).toBe("openai");
    });

    it("detects Gemini from hostname", () => {
      expect(detectProvider("generativelanguage.googleapis.com")).toBe("gemini");
    });

    it("strips port before matching", () => {
      expect(detectProvider("api.anthropic.com:443")).toBe("anthropic");
      expect(detectProvider("api.openai.com:8080")).toBe("openai");
    });

    it("returns unknown for unrecognized hostname", () => {
      expect(detectProvider("api.cohere.ai")).toBe("unknown");
      expect(detectProvider("")).toBe("unknown");
      expect(detectProvider(null)).toBe("unknown");
      expect(detectProvider(undefined)).toBe("unknown");
    });
  });
});

// ═══════════════════════════════════════════════════════════════════
// Cross-adapter consistency
// ═══════════════════════════════════════════════════════════════════

describe("cross-adapter consistency", () => {
  it("all adapters return the same normalized shape from extractToolResults", () => {
    const anthropicMsgs = [
      {
        role: "assistant",
        content: [{ type: "tool_use", id: "t1", name: "Bash" }],
      },
      {
        role: "user",
        content: [
          { type: "tool_result", tool_use_id: "t1", content: "output" },
        ],
      },
    ];
    const openaiMsgs = [
      {
        role: "assistant",
        tool_calls: [
          { id: "c1", type: "function", function: { name: "bash", arguments: "{}" } },
        ],
      },
      { role: "tool", tool_call_id: "c1", content: "output" },
    ];
    const geminiMsgs = [
      {
        role: "function",
        parts: [
          { functionResponse: { name: "bash", response: { content: "output" } } },
        ],
      },
    ];

    const adapters = [
      { name: "anthropic", results: anthropicAdapter.extractToolResults(anthropicMsgs) },
      { name: "openai", results: openaiAdapter.extractToolResults(openaiMsgs) },
      { name: "gemini", results: geminiAdapter.extractToolResults(geminiMsgs) },
    ];

    for (const { name, results } of adapters) {
      expect(results.length).toBeGreaterThan(0);
      for (const r of results) {
        expect(r).toHaveProperty("id");
        expect(r).toHaveProperty("toolName");
        expect(r).toHaveProperty("text");
        expect(r).toHaveProperty("turnIndex");
        expect(typeof r.id).toBe("string");
        expect(typeof r.toolName).toBe("string");
        expect(typeof r.text).toBe("string");
        expect(typeof r.turnIndex).toBe("number");
      }
    }
  });
});
