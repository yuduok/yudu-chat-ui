import type { ChatProvider, ProviderChatInput, ProviderChatChunk } from "./types.js";

// OpenAI-compatible chat.completions streaming.
// Works against OpenAI, Azure-OpenAI, DeepSeek, Moonshot, Ollama (/v1), etc.
export class OpenAICompatibleProvider implements ChatProvider {
  id: string;
  label: string;
  defaultModels: string[];
  defaultBaseUrl?: string;

  constructor(opts: {
    id: string;
    label: string;
    defaultModels: string[];
    defaultBaseUrl?: string;
  }) {
    this.id = opts.id;
    this.label = opts.label;
    this.defaultModels = opts.defaultModels;
    this.defaultBaseUrl = opts.defaultBaseUrl;
  }

  async *chat(input: ProviderChatInput): AsyncIterable<ProviderChatChunk> {
    const baseUrl = (input.baseUrl ?? this.defaultBaseUrl ?? "https://api.openai.com/v1").replace(/\/$/, "");
    const url = `${baseUrl}/chat/completions`;

    const messages: any[] = [];
    if (input.systemPrompt) messages.push({ role: "system", content: input.systemPrompt });
    for (const m of input.messages) {
      if (m.parts && m.parts.length) {
        messages.push({ role: m.role, content: m.parts });
      } else {
        messages.push({ role: m.role, content: m.content });
      }
    }

    const body = {
      model: input.model,
      messages,
      temperature: input.temperature ?? 0.7,
      stream: true,
      stream_options: { include_usage: true },
    };

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${input.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: input.signal,
    });

    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => "");
      throw new Error(`Upstream ${res.status}: ${text || res.statusText}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // SSE: data: {...}\n\n
        let idx: number;
        while ((idx = buffer.indexOf("\n\n")) !== -1) {
          const raw = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          for (const line of raw.split("\n")) {
            const trimmed = line.trim();
            if (!trimmed.startsWith("data:")) continue;
            const payload = trimmed.slice(5).trim();
            if (payload === "[DONE]") return;
            if (!payload) continue;
            try {
              const json = JSON.parse(payload);
              const choice = json.choices?.[0];
              const delta = choice?.delta?.content;
              if (typeof delta === "string" && delta.length) {
                yield { delta };
              }
              if (json.usage) {
                yield {
                  delta: "",
                  usage: {
                    promptTokens: json.usage.prompt_tokens ?? 0,
                    completionTokens: json.usage.completion_tokens ?? 0,
                  },
                };
              }
            } catch {
              // ignore malformed chunk
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }
}
