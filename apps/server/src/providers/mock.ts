import type { ChatProvider, ProviderChatInput, ProviderChatChunk } from "./types.js";

// Deterministic mock provider used for local development without API keys.
//   - default: echoes the user's last message in tokens so the SSE/UI flow
//     can be tested without burning API credits.
//   - useTools=true: if the latest user message contains "weather", it
//     emits a single fake tool_call for `get_weather` then exits. The
//     server picks the tool up, runs it, and feeds the result back in.
//     We respond with a short summary once we see a tool result for
//     that call.
//
// We always emit a synthetic reasoning trace first so the UI's
// thinking-toggle path is exercised without a real API key. The trace
// length scales with `input.reasoningEffort` so the four depth settings
// are visibly distinguishable.
export class MockProvider implements ChatProvider {
  id = "mock";
  label = "Mock (offline)";
  defaultModels = ["mock-1"];
  defaultBaseUrl = "http://localhost";
  supportsTools = true;

  async *chat(input: ProviderChatInput): AsyncIterable<ProviderChatChunk> {
    const last = [...input.messages].reverse().find((m) => m.role === "user");
    const text = last?.content?.trim() || "Hello!";

    // Always emit the reasoning trace first so it lands on every branch.
    const effort = input.reasoningEffort ?? "low";
    const trace =
      effort === "xhigh"
        ? `[xhigh] Mock reasoning: weighing the user's intent, recalling relevant context, drafting multiple candidate replies, sanity-checking tone, picking the most useful one.\n\n`
        : effort === "high"
        ? `[high] Mock reasoning: parsed the request, listed constraints, considered trade-offs.\n\n`
        : effort === "medium"
        ? `[medium] Mock reasoning: noted the request and a couple of angles.\n\n`
        : `[low] Mock reasoning: thinking about it.\n\n`;
    for (const ch of trace) {
      if (input.signal?.aborted) return;
      yield { reasoningDelta: ch };
      await new Promise((r) => setTimeout(r, 4));
    }

    // If a previous tool_result exists, answer with a short summary.
    const toolResult = [...input.messages]
      .reverse()
      .find((m) => m.role === "tool") as typeof input.messages[number] | undefined;
    const toolResultStr =
      toolResult?.parts?.find((p) => p.type === "tool_result")?.content ?? "";

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

    // Tool branch: emit a fake tool_call for the weather demo and exit.
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

    // Plain text fallback.
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
