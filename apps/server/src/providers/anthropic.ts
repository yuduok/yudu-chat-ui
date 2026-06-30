import type {
  ChatProvider,
  ProviderChatInput,
  ProviderChatChunk,
  ProviderMessage,
} from "./types.js";

// Map our 4-step reasoning depth to Anthropic's `thinking` block budget.
// We deliberately under-budget at the high end so a single user message
// can't blow past the model's max_tokens cap. xhigh is reserved for
// Sonnet 4.5 / Opus 4 family where the provider supports 32k+ budgets.
function thinkingBudgetFor(depth: string | undefined): number | null {
  switch (depth) {
    case "low":
      return 1024;
    case "medium":
      return 4096;
    case "high":
      return 16384;
    case "xhigh":
      return 32768;
    default:
      return null;
  }
}


// Anthropic Messages API with SSE streaming.
// Docs: https://docs.anthropic.com/en/api/messages-streaming
//
// Tool support: forwards `tools` to upstream when supplied. We translate
// ProviderContentPart tool_use -> {type:"tool_use",id,name,input} and
// tool_result -> {type:"tool_result",tool_use_id,content,is_error}. Streamed
// tool_use blocks are accumulated from content_block_start/delta/stop.
export class AnthropicProvider implements ChatProvider {
  id = "anthropic";
  label = "Anthropic";
  defaultModels = ["claude-3-5-sonnet-latest", "claude-3-5-haiku-latest"];
  defaultBaseUrl = "https://api.anthropic.com";
  supportsTools = true;

  async *chat(input: ProviderChatInput): AsyncIterable<ProviderChatChunk> {
    const baseUrl = (input.baseUrl ?? this.defaultBaseUrl!).replace(/\/$/, "");
    const url = `${baseUrl}/v1/messages`;

    // Anthropic requires system as a top-level field, and messages only
    // carry user/assistant turns.
    const messages: any[] = [];
    for (const m of input.messages) {
      if (m.role === "system") continue;
      messages.push(messageToAnthropic(m));
    }

    const thinkingBudget = thinkingBudgetFor(input.reasoningEffort);
    const body: Record<string, unknown> = {
      model: input.model,
      max_tokens: 4096,
      system: input.systemPrompt,
      temperature: input.temperature ?? 0.7,
      messages,
      stream: true,
    };
    if (thinkingBudget) {
      // Anthropic requires temperature=1 when thinking is enabled; we
      // drop the field entirely rather than guess.
      delete body.temperature;
      body.thinking = { type: "enabled", budget_tokens: thinkingBudget };
    }
    if (input.tools && input.tools.length) {
      body.tools = input.tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.parameters,
      }));
      if (input.toolChoice === "auto") {
        // Anthropic's default is auto; only force-disable when explicitly asked.
        body.tool_choice = { type: "auto" };
      } else if (input.toolChoice && typeof input.toolChoice === "object") {
        body.tool_choice = { type: "tool", name: input.toolChoice.name };
      } else if (input.toolChoice === "none") {
        // "none" isn't supported by Anthropic — omit tools instead.
        delete body.tools;
      }
    }

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

    // tool_use block accumulator keyed by index.
    const blocks: Array<{ id: string; name: string; inputJson: string }> = [];
    let stopSeen = false;

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
            if (event === "content_block_start") {
              const block = json.content_block;
              if (block?.type === "tool_use") {
                while (blocks.length <= (json.index ?? 0)) {
                  blocks.push({ id: "", name: "", inputJson: "" });
                }
                const slot = blocks[json.index ?? 0];
                slot.id = block.id ?? "";
                slot.name = block.name ?? "";
                slot.inputJson = "";
              }
            } else if (event === "content_block_delta") {
              const delta = json.delta;
              if (delta?.type === "input_json_delta" && typeof delta.partial_json === "string") {
                const slot = blocks[json.index ?? blocks.length - 1];
                if (slot) slot.inputJson += delta.partial_json;
              } else if (typeof delta?.text === "string" && delta.text.length) {
                yield { delta: delta.text };
              } else if (delta?.type === "thinking_delta" && typeof delta.thinking === "string" && delta.thinking.length) {
                yield { reasoningDelta: delta.thinking };
              }
            } else if (event === "content_block_stop") {
              const slot = blocks[json.index ?? blocks.length - 1];
              if (slot && slot.id && slot.name) {
                let parsed: Record<string, unknown> | string = slot.inputJson;
                if (slot.inputJson) {
                  try {
                    parsed = JSON.parse(slot.inputJson);
                  } catch {
                    parsed = slot.inputJson;
                  }
                }
                yield {
                  delta: "",
                  toolCall: {
                    id: slot.id,
                    name: slot.name,
                    arguments: parsed,
                  },
                };
              }
            } else if (event === "message_delta" && json.usage) {
              yield {
                delta: "",
                usage: {
                  promptTokens: json.usage.input_tokens ?? 0,
                  completionTokens: json.usage.output_tokens ?? 0,
                },
              };
            } else if (event === "message_stop") {
              stopSeen = true;
              return;
            }
          } catch {
            // ignore malformed
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
    if (!stopSeen) {
      // No-op: stream just ended without a message_stop. Nothing else to do.
    }
  }
}

function messageToAnthropic(m: ProviderMessage): { role: string; content: unknown } {
  const parts = m.parts;

  // Mixed tool_use / tool_result / text parts -> one user or assistant turn.
  if (parts && parts.length) {
    const blocks: any[] = [];
    for (const p of parts) {
      if (p.type === "text") {
        if (p.text) blocks.push({ type: "text", text: p.text });
      } else if (p.type === "image_url") {
        const url = p.image_url.url;
        if (url.startsWith("data:")) {
          const mm = url.match(/^data:([^;]+);base64,(.*)$/);
          if (mm) {
            blocks.push({
              type: "image",
              source: { type: "base64", media_type: mm[1], data: mm[2] },
            });
          }
        } else {
          blocks.push({ type: "image", source: { type: "url", url } });
        }
      } else if (p.type === "tool_use") {
        blocks.push({
          type: "tool_use",
          id: p.id,
          name: p.name,
          input: p.input,
        });
      } else if (p.type === "tool_result") {
        blocks.push({
          type: "tool_result",
          tool_use_id: p.toolUseId,
          content: p.content,
          is_error: !!p.isError,
        });
      }
    }
    if (blocks.length) return { role: m.role, content: blocks };
  }

  // toolCalls-only fallback (assistant message with tool_use but no parts).
  if (m.toolCalls && m.toolCalls.length) {
    const blocks = m.toolCalls.map((tc) => ({
      type: "tool_use",
      id: tc.id,
      name: tc.name,
      input: typeof tc.arguments === "string" ? safeParse(tc.arguments) : tc.arguments,
    }));
    return { role: m.role, content: blocks };
  }

  return { role: m.role, content: m.content };
}

function safeParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}
