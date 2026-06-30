import type { ContentPart, Role } from "@yudu/shared";

export interface ProviderMessage {
  role: Role;
  // Plain text fallback used by providers that don't accept parts
  content: string;
  // Multimodal parts. Omit when text-only.
  parts?: ContentPart[];
}

export interface ProviderChatInput {
  model: string;
  systemPrompt?: string;
  temperature?: number;
  messages: ProviderMessage[];
  signal?: AbortSignal;
  apiKey: string;
  baseUrl?: string;
}

export interface ProviderChatChunk {
  // Incremental text delta. Empty string is allowed (e.g. role markers).
  delta: string;
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
  // Stream chunks. Throws on error. Honors AbortSignal.
  chat(input: ProviderChatInput): AsyncIterable<ProviderChatChunk>;
}
