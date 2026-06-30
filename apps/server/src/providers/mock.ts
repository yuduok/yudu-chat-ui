import type { ChatProvider, ProviderChatInput, ProviderChatChunk } from "./types.js";

// Deterministic mock provider used for local development without API keys.
// Two behaviours:
//   - default: echoes the user's last message in tokens so the SSE/UI flow
//     can be tested without burning API credits.
//   - useTools=true: if the latest user message contains "weather", it
//     emits a single fake tool_call for `get_weather` then exits. The server
//     picks the tool up, runs it, and feeds the result back in. We respond
//     with a short summary once we see a tool result for that call.
export class MockProvider implements ChatProvider {
  id = "mock";
  label = "Mock (offline)";
  defaultModels = ["mock-1"];
  defaultBaseUrl = "http://localhost";
  supportsTools = true;

  async *chat(input: ProviderChatInput): AsyncIterable<ProviderChatChunk> {
    const last = [...input.messages].reverse().find((m) => m.role === "user");
    const text = last?.content?.trim() || "Hello!";

    // If a previous tool_result exists in the conversation, generate a
    // short final answer based on its content rather than another tool call.
    const toolResult = [...input.messages]
      .reverse()
      .find((m) => m.role === "tool") as typeof input.messages[number] | undefined;
    const toolResultStr =
      toolResult?.parts?.find((p) => p.type === "tool_result")?.content ??
      "";

    if (toolResultStr) {
      const summary = `Mock summary: ${toolResultStr}`;
      for (const ch of summary) {
        if (input.signal?.aborted) return;
        yield { delta: ch };
        await new Promise((r) => setTimeout(r, 4));
      }
      yield {
        delta: "",
        usage: { promptTokens: text.length, completionTokens: summary.length },
      };
      return;
    }

    // If tools are enabled and the user mentioned "weather", emit a fake
    // tool_call and exit so the server runs it.
    if (input.tools && input.tools.length && /weather/i.test(text)) {
      const toolName = input.tools.find((t) => t.name === "get_weather")
        ? "get_weather"
        : input.tools[0].name;
      yield {
        delta: "",
        toolCall: {
          id: "mock-call-1",
          name: toolName,
          arguments: { city: "Shanghai" },
        },
      };
      return;
    }

    const reply = `You said: "${text}". I'm a mock provider — set an API key in Settings to use a real model.`;
    for (const ch of reply) {
      if (input.signal?.aborted) return;
      yield { delta: ch };
      // Tiny delay so the UI shows streaming.
      await new Promise((r) => setTimeout(r, 8));
    }
    yield {
      delta: "",
      usage: { promptTokens: text.length, completionTokens: reply.length },
    };
  }
}
