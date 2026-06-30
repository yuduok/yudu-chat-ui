import type { ChatProvider, ProviderChatInput, ProviderChatChunk } from "./types.js";

// Deterministic mock provider used for local development without API keys.
// It echoes the user's last message in tokens so the SSE/UI flow can be tested.
export class MockProvider implements ChatProvider {
  id = "mock";
  label = "Mock (offline)";
  defaultModels = ["mock-1"];
  defaultBaseUrl = "http://localhost";

  async *chat(input: ProviderChatInput): AsyncIterable<ProviderChatChunk> {
    const last = [...input.messages].reverse().find((m) => m.role === "user");
    const text = last?.content?.trim() || "Hello!";
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
