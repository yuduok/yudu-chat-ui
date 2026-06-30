import type { ChatProvider, ProviderChatInput, ProviderChatChunk } from "./types.js";

// Anthropic Messages API with SSE streaming.
// Docs: https://docs.anthropic.com/en/api/messages-streaming
export class AnthropicProvider implements ChatProvider {
  id = "anthropic";
  label = "Anthropic";
  defaultModels = ["claude-3-5-sonnet-latest", "claude-3-5-haiku-latest"];
  defaultBaseUrl = "https://api.anthropic.com";

  async *chat(input: ProviderChatInput): AsyncIterable<ProviderChatChunk> {
    const baseUrl = (input.baseUrl ?? this.defaultBaseUrl!).replace(/\/$/, "");
    const url = `${baseUrl}/v1/messages`;

    // Anthropic requires system as a top-level field, and messages only
    // carry user/assistant turns.
    const messages: any[] = [];
    for (const m of input.messages) {
      if (m.role === "system") continue;
      if (m.parts && m.parts.length) {
        const blocks: any[] = [];
        for (const p of m.parts) {
          if (p.type === "text") blocks.push({ type: "text", text: p.text });
          else if (p.type === "image_url") {
            // data: URL or remote URL -> pass through
            const url = p.image_url.url;
            if (url.startsWith("data:")) {
              const m = url.match(/^data:([^;]+);base64,(.*)$/);
              if (m) {
                blocks.push({
                  type: "image",
                  source: { type: "base64", media_type: m[1], data: m[2] },
                });
              }
            } else {
              blocks.push({
                type: "image",
                source: { type: "url", url },
              });
            }
          }
        }
        messages.push({ role: m.role, content: blocks });
      } else {
        messages.push({ role: m.role, content: m.content });
      }
    }

    const body = {
      model: input.model,
      max_tokens: 4096,
      system: input.systemPrompt,
      temperature: input.temperature ?? 0.7,
      messages,
      stream: true,
    };

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": input.apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
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
        let idx: number;
        while ((idx = buffer.indexOf("\n\n")) !== -1) {
          const raw = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          let event = "";
          let data = "";
          for (const line of raw.split("\n")) {
            const t = line.trim();
            if (t.startsWith("event:")) event = t.slice(6).trim();
            else if (t.startsWith("data:")) data = t.slice(5).trim();
          }
          if (!data) continue;
          try {
            const json = JSON.parse(data);
            if (event === "content_block_delta") {
              const text = json.delta?.text;
              if (typeof text === "string" && text.length) yield { delta: text };
            } else if (json.type === "message_delta" && json.usage) {
              yield {
                delta: "",
                usage: {
                  promptTokens: json.usage.input_tokens ?? 0,
                  completionTokens: json.usage.output_tokens ?? 0,
                },
              };
            }
          } catch {
            // ignore
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }
}
