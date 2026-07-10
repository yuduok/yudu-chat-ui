import type {
  ChatProvider,
  ProviderChatInput,
  ProviderChatChunk,
  ProviderMessage,
} from "./types.js";

// OpenAI-compatible chat.completions streaming.
// Works against OpenAI, Azure-OpenAI, DeepSeek, Moonshot, Ollama (/v1), etc.
//
// Tool support: when `input.tools` is supplied we forward a `tools` array
// to the upstream `/chat/completions` endpoint and accumulate streamed
// `delta.tool_calls[]` deltas (index, id, function.name, function.arguments).
// We emit one `toolCall` chunk per completed call (i.e. when arguments have
// closed out — typically signalled by `finish_reason: "tool_calls"`).
export class OpenAICompatibleProvider implements ChatProvider {
  id: string;
  label: string;
  defaultModels: string[];
  defaultBaseUrl?: string;
  supportsTools = true;

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
      const converted = messageToOpenAI(m);
      if (Array.isArray(converted)) messages.push(...converted);
      else messages.push(converted);
    }

    const body: Record<string, unknown> = {
      model: input.model,
      messages,
      temperature: input.temperature ?? 0.7,
      stream: true,
      stream_options: { include_usage: true },
    };
    // Reasoning effort: forward as-is. Upstream either honors it
    // (o*-mini, gpt-5 family, deepseek-reasoner, etc.) or ignores the
    // unknown field. We don't auto-promote a missing value because some
    // providers reject unknown fields outright — let the caller decide.
    if (input.reasoningEffort) {
      body.reasoning_effort = input.reasoningEffort;
    }
    if (input.tools && input.tools.length) {
      body.tools = input.tools.map((t) => ({
        type: "function",
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        },
      }));
      if (input.toolChoice) body.tool_choice = input.toolChoice;
    }

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

    // Accumulator for streamed tool_calls deltas, keyed by index.
    const calls: Array<{
      id: string;
      name: string;
      args: string;
    }> = [];
    let toolCallsEmitted = false;

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
            if (payload === "[DONE]") {
              // Flush any remaining tool calls. Most upstreams only set
              // finish_reason=tool_calls; if we somehow accumulated a call
              // that didn't get emitted during the loop, emit it now.
              if (!toolCallsEmitted) {
                for (const c of parsedCalls(calls)) yield { delta: "", toolCall: c };
              }
              return;
            }
            if (!payload) continue;
            try {
              const json = JSON.parse(payload);
              const choice = json.choices?.[0];
              const delta = choice?.delta?.content;
              if (typeof delta === "string" && delta.length) {
                yield { delta };
              }
              // Reasoning deltas: the field name varies by upstream.
              //   - DeepSeek -> delta.reasoning_content
              //   - OpenAI o*-mini / gpt-5 -> delta.reasoning
              // Accept any of them and forward verbatim.
              const r =
                choice?.delta?.reasoning_content ??
                choice?.delta?.reasoning ??
                (Array.isArray(choice?.delta?.reasoning_details)
                  ? (choice.delta.reasoning_details as { text?: string }[])
                      .map((d) => d?.text ?? "")
                      .join("")
                  : "");
              if (typeof r === "string" && r.length) {
                yield { reasoningDelta: r };
              }
              const toolDeltas = choice?.delta?.tool_calls;
              if (Array.isArray(toolDeltas)) {
                for (const tc of toolDeltas) {
                  const i = tc.index ?? 0;
                  while (calls.length <= i) {
                    calls.push({ id: "", name: "", args: "" });
                  }
                  const slot = calls[i];
                  if (tc.id) slot.id = tc.id;
                  if (tc.function?.name) slot.name += tc.function.name;
                  if (typeof tc.function?.arguments === "string") {
                    slot.args += tc.function.arguments;
                  }
                }
              }
              const finish = choice?.finish_reason;
              if (finish === "tool_calls") {
                if (!toolCallsEmitted) {
                  for (const c of parsedCalls(calls)) yield { delta: "", toolCall: c };
                  toolCallsEmitted = true;
                }
                // OpenAI sends include_usage as a separate chunk after the
                // finish marker. Keep reading until usage/[DONE] instead of
                // returning with every tool round incorrectly recorded as 0.
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
      if (!toolCallsEmitted) {
        for (const c of parsedCalls(calls)) yield { delta: "", toolCall: c };
      }
    } finally {
      reader.releaseLock();
    }
  }
}

function parsedCalls(calls: Array<{ id: string; name: string; args: string }>): Array<{ id: string; name: string; arguments: Record<string, unknown> | string }> {
  const out: Array<{ id: string; name: string; arguments: Record<string, unknown> | string }> = [];
  for (const c of calls) {
    if (!c.id || !c.name) continue;
    let parsed: Record<string, unknown> | string = c.args;
    if (c.args) {
      try {
        parsed = JSON.parse(c.args);
      } catch {
        // Keep raw string if upstream sent non-JSON.
        parsed = c.args;
      }
    }
    out.push({ id: c.id, name: c.name, arguments: parsed });
  }
  return out;
}

function serializeTcArgs(tc: { arguments?: string | Record<string, unknown> } & { input?: Record<string, unknown> }): string {
  if ("arguments" in tc && tc.arguments !== undefined) {
    return typeof tc.arguments === "string" ? tc.arguments : JSON.stringify(tc.arguments);
  }
  if ("input" in tc && tc.input !== undefined) {
    return JSON.stringify(tc.input);
  }
  return "{}";
}
function messageToOpenAI(m: ProviderMessage): unknown {
  // OpenAI tool-calling wire shape: assistant messages with tool_calls
  // are paired with follow-up `role: "tool"` messages keyed by tool_call_id.
  // We translate ProviderContentPart tool_use/tool_result into that shape.
  const toolCalls = m.toolCalls;
  const parts = m.parts;
  const hasToolUse = parts?.some((p) => p.type === "tool_use");
  const hasToolResult = parts?.some((p) => p.type === "tool_result");

  if (hasToolUse || (toolCalls && toolCalls.length)) {
    const tcs = (toolCalls && toolCalls.length
      ? toolCalls
      : (parts ?? []).filter((p): p is Extract<typeof p, { type: "tool_use" }> => p.type === "tool_use")
    ).map((tc) => ({
      id: tc.id,
      type: "function",
      function: {
        name: tc.name,
        arguments: serializeTcArgs(tc),
      },
    }));
    return {
      role: m.role,
      content: m.content || null,
      tool_calls: tcs,
    };
  }

  if (hasToolResult) {
    // OpenAI accepts multiple tool messages, each carrying a single result.
    // If there are several tool_results in one ProviderMessage, we split
    // them into multiple tool messages and let the caller flatten.
    const results = (parts ?? []).filter(
      (p): p is Extract<typeof p, { type: "tool_result" }> => p.type === "tool_result",
    );
    if (results.length === 1) {
      return {
        role: "tool",
        tool_call_id: results[0].toolUseId,
        content: results[0].content,
      };
    }
    return results.map((r) => ({
      role: "tool",
      tool_call_id: r.toolUseId,
      content: r.content,
    }));
  }

  if (parts && parts.length) {
    return { role: m.role, content: parts };
  }
  return { role: m.role, content: m.content };
}
