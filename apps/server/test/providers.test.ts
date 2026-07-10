import assert from "node:assert/strict";
import test from "node:test";
import { getProvider, isCustomProvider } from "../src/providers/registry.js";

test("dynamic custom chat provider ids reuse the OpenAI-compatible adapter", () => {
  const provider = getProvider("custom:example");
  assert.equal(isCustomProvider("custom:example"), true);
  assert.equal(provider?.id, "custom:example");
  assert.equal(provider?.supportsTools, true);
  assert.deepEqual(provider?.defaultModels, ["custom-model"]);
  assert.equal(getProvider("unknown"), undefined);
});

test("Anthropic sends tool results as user blocks and disables unsigned thinking with tools", async () => {
  const provider = getProvider("anthropic");
  assert.ok(provider);
  const originalFetch = globalThis.fetch;
  let requestBody: any;

  globalThis.fetch = async (_input, init) => {
    requestBody = JSON.parse(String(init?.body ?? "{}"));
    return new Response("event: message_stop\ndata: {}\n\n", {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    });
  };

  try {
    for await (const _chunk of provider.chat({
      model: "claude-test",
      apiKey: "test-key",
      reasoningEffort: "high",
      tools: [{
        name: "lookup",
        description: "Lookup a value",
        parameters: { type: "object", properties: {} },
      }],
      toolChoice: "auto",
      messages: [
        { role: "user", content: "lookup" },
        {
          role: "assistant",
          content: "",
          parts: [{ type: "tool_use", id: "call-1", name: "lookup", input: {} }],
        },
        {
          role: "tool",
          content: "result",
          parts: [{ type: "tool_result", toolUseId: "call-1", content: "result" }],
        },
      ],
    })) {
      // Consume the stream so the adapter completes and releases its reader.
    }
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.deepEqual(requestBody.messages.map((message: any) => message.role), [
    "user",
    "assistant",
    "user",
  ]);
  assert.deepEqual(requestBody.messages[2].content, [{
    type: "tool_result",
    tool_use_id: "call-1",
    content: "result",
    is_error: false,
  }]);
  assert.equal("thinking" in requestBody, false);
});

test("OpenAI keeps reading tool streams long enough to capture trailing usage", async () => {
  const provider = getProvider("openai");
  assert.ok(provider);
  const originalFetch = globalThis.fetch;
  const frames = [
    {
      choices: [{
        delta: {
          tool_calls: [{
            index: 0,
            id: "call-1",
            function: { name: "lookup", arguments: "{}" },
          }],
        },
        finish_reason: null,
      }],
    },
    { choices: [{ delta: {}, finish_reason: "tool_calls" }] },
    { choices: [], usage: { prompt_tokens: 23, completion_tokens: 4 } },
  ];
  const body = `${frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join("")}data: [DONE]\n\n`;
  globalThis.fetch = async () => new Response(body, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });

  const chunks: any[] = [];
  try {
    for await (const chunk of provider.chat({
      model: "gpt-test",
      apiKey: "test-key",
      messages: [{ role: "user", content: "lookup" }],
      tools: [{
        name: "lookup",
        description: "Lookup a value",
        parameters: { type: "object", properties: {} },
      }],
    })) {
      chunks.push(chunk);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(chunks.filter((chunk) => chunk.toolCall).length, 1);
  assert.deepEqual(chunks.find((chunk) => chunk.usage)?.usage, {
    promptTokens: 23,
    completionTokens: 4,
  });
});
