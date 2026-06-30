import type {
  ProviderContentPart,
  Role,
  ToolDefinition,
} from "@yudu/shared";

export interface ProviderMessage {
  role: Role;
  // Plain text fallback used by providers that don't accept parts.
  content: string;
  // Normalized multimodal parts. Distinct from `ContentPart` so we can
  // carry tool_use / tool_result between turns without leaking the
  // chat-facing tool_call / tool_result parts into the provider wire shape.
  parts?: ProviderContentPart[];
  // Convenience snapshot of the tool calls in this message. Adapters that
  // can't reconstruct tool_calls from `parts` can fall back to this.
  toolCalls?: Array<{
    id: string;
    name: string;
    arguments: Record<string, unknown> | string;
  }>;
}

export type ToolChoice = "auto" | "none" | { name: string };

export interface ProviderChatInput {
  model: string;
  systemPrompt?: string;
  temperature?: number;
  messages: ProviderMessage[];
  signal?: AbortSignal;
  apiKey: string;
  baseUrl?: string;
  // Tool catalog passed to the upstream model. Empty / undefined means
  // no tool support requested.
  tools?: ToolDefinition[];
  toolChoice?: ToolChoice;
}

export interface ProviderChatChunk {
  // Incremental text delta. Empty string is allowed (e.g. role markers).
  delta: string;
  // Streamed tool call. Yielded once the adapter has the full call.
  // Adapters that don't accumulate `tool_calls` deltas don't yield this.
  toolCall?: {
    id: string;
    name: string;
    arguments: Record<string, unknown> | string;
    agentId?: string;
  };
  // Streamed tool result. Adapters don't actually run tools — the server
  // does — but this hook lets future adapters (e.g. ones that proxy to
  // an upstream sandbox) emit results inline.
  toolResult?: {
    toolCallId: string;
    content: string;
    isError?: boolean;
    agentId?: string;
  };
  // Agent lifecycle hook used by chain orchestration.
  agentEvent?: {
    kind: "started" | "finished";
    agentId: string;
    label: string;
  };
  // Optional final usage
  usage?: { promptTokens: number; completionTokens: number };
}

export interface ChatProvider {
  id: string;
  label: string;
  // Default model list surfaced to the UI
  defaultModels: string[];
  // Optional default base URL (e.g. OpenAI's https://api.openai.com/v1)
  defaultBaseUrl?: string;
  // When true, the provider accepts a `tools` array and can emit
  // tool_calls. The server gates the tool loop on this flag.
  supportsTools?: boolean;
  // Stream chunks. Throws on error. Honors AbortSignal.
  chat(input: ProviderChatInput): AsyncIterable<ProviderChatChunk>;
}
