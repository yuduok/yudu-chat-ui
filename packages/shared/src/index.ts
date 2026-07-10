// Shared types between web and server. Keep this file dependency-free.

export type Role = "system" | "user" | "assistant" | "tool";

// ---------- Tools (Issue #2) ----------

// OpenAI-style JSON Schema. We constrain it to a permissive shape so the
// server can pass it through to both OpenAI and Anthropic without conversion.
export interface ToolJsonSchema {
  type: "object";
  properties?: Record<string, unknown>;
  required?: string[];
  [k: string]: unknown;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: ToolJsonSchema;
}

// A model-emitted tool call. `id` is supplied by the provider; the same id
// must be echoed back inside a `tool_result` part.
export interface ToolCallPart {
  type: "tool_call";
  id: string;
  name: string;
  // Already-parsed arguments (object), or the raw string if the provider
  // only gave us text. The web UI prefers the object form.
  arguments: Record<string, unknown> | string;
}

export interface ToolResultPart {
  type: "tool_result";
  toolCallId: string;
  // Stringified result so the part fits in a SQLite TEXT column.
  content: string;
  isError?: boolean;
  // Which agent produced this result, when running multi-agent orchestration.
  agentId?: string;
}

// A new content part that the model emits directly in its message — distinct
// from `ToolCallPart` which only lives in `ContentPart` form when the
// provider streams them as part of the assistant turn.
export type ContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string }; name?: string; mimeType?: string; size?: number }
  | { type: "document"; name: string; mimeType: string; size: number; text: string }
  | ToolCallPart
  | ToolResultPart
  // Reasoning / thinking trace emitted by the model before (or alongside)
  // the visible answer. We persist every part the provider emitted even
  // when the user has hidden the UI; clients filter on `showThinking`.
  | { type: "reasoning"; text: string };

// ---------- Reasoning depth ----------
// "low" -> minimal reasoning budget, "medium" -> balanced,
// "high" -> deep, "xhigh" -> maximum (only a handful of frontier models).
export type ReasoningEffort = "low" | "medium" | "high" | "xhigh";

export interface ChatMessage {
  id: string;
  conversationId: string;
  role: Role;
  content: string;
  parts?: ContentPart[] | null;
  // Convenience snapshot of the most recent tool call ids in this message.
  // Persisted alongside the message so the UI can render an inline timeline
  // without re-parsing the parts blob.
  toolCallIds?: string[] | null;
  promptTokens?: number | null;
  completionTokens?: number | null;
  // For `role: "tool"` messages: which assistant turn this result belongs to.
  // Optional; the assistant message id is enough for the UI to group.
  createdAt: number;
}

export interface Conversation {
  id: string;
  title: string;
  provider: string;
  model: string;
  systemPrompt?: string | null;
  temperature?: number | null;
  // When set, the server resolves this agent profile and applies its
  // systemPrompt + tool allowlist + temperature before dispatching to the
  // model. See `apps/server/src/agents/` for the seed profiles.
  agentId?: string | null;
  // Reasoning depth requested from the model. Persisted per conversation so
  // the user can flip it once and forget about it. `null` means "no
  // preference, fall back to the provider default".
  reasoningEffort?: ReasoningEffort | null;
  // Whether the web UI should render the persisted reasoning trace for
  // assistant messages. The server still collects reasoning deltas and
  // writes them to the DB regardless of this flag so reloads stay honest.
  showThinking?: boolean | null;
  createdAt: number;
  updatedAt: number;
}

export interface ConversationWithMessages extends Conversation {
  messages: ChatMessage[];
}

export interface ProviderConfig {
  id: string;
  label: string;
  baseUrl?: string;
  models: string[];
  // Surface which providers natively support tool calling. The mock
  // provider also advertises tools so the UI can be developed without a
  // real key.
  supportsTools?: boolean;
  imageGeneration?: ImageGenerationCapabilities;
}

export interface ImageGenerationCapabilities {
  models: string[];
  sizes: string[];
  qualities: string[];
  styles: string[];
  outputFormats: string[];
  backgrounds: string[];
  moderations: string[];
  supportsOutputCompression: boolean;
  maxImages: number;
  maxReferenceImages: number;
  supportsReferenceImages: boolean;
}

export interface ImageGenerationRequest {
  provider: string;
  model: string;
  prompt: string;
  size: string;
  quality: string;
  style?: string;
  count: number;
  outputFormat: string;
  background?: string;
  moderation?: string;
  outputCompression?: number;
  referenceImages?: Array<{ name: string; dataUrl: string }>;
}

export interface GeneratedImageAsset {
  id: string;
  url: string;
  mimeType: string;
  filename: string;
  revisedPrompt?: string;
}

export interface ImageGeneration {
  id: string;
  provider: string;
  model: string;
  prompt: string;
  options: Omit<ImageGenerationRequest, "provider" | "model" | "prompt" | "referenceImages">;
  referenceImages: Array<{ name: string; dataUrl: string }>;
  status: "completed" | "failed";
  images: GeneratedImageAsset[];
  error?: string;
  createdAt: number;
  completedAt: number;
}

export interface AgentProfile {
  id: string;
  label: string;
  description: string;
  systemPrompt: string;
  // Optional override. Falls back to the conversation's provider if unset.
  provider?: string;
  model?: string;
  temperature?: number;
  // Names of tools this agent is allowed to call. Empty/missing means no
  // tools. `*` would mean "all registered tools" but we keep it explicit
  // for now to make profiles auditable.
  tools?: string[];
  // Optional reasoning depth override applied to every turn this agent
  // runs. Falls back to the conversation's setting when omitted.
  reasoningEffort?: ReasoningEffort;
  // Optional override for the thinking-trace visibility. When unset, the
  // conversation's `showThinking` flag wins.
  showThinking?: boolean;
  // When true, the orchestrator hands the next turn to the next agent in
  // `chain` after this one finishes. Used to wire planner → worker.
  chain?: string[];
  // When true, the agent's output is fed into the next agent in the chain
  // verbatim rather than being shown in the chat.
  handoff?: "context" | "none";
}

export interface SkillDefinition {
  id: string;
  name: string;
  description?: string;
  content: string;
  enabled: boolean;
  createdAt: number;
}

// Provider-facing normalized message shape (consumed by chat providers).
// `toolCalls` mirrors what we send upstream; tools go back via the
// ProviderMessageContentPart union.
export type ProviderContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; toolUseId: string; content: string; isError?: boolean };

export interface ProviderMessage {
  role: Role;
  content: string;
  parts?: ProviderContentPart[];
  // Convenience for adapters that take a `tools` array of names.
  toolCalls?: Array<{ id: string; name: string; arguments: Record<string, unknown> | string }>;
}

// ---------- Streaming protocol (SSE) ----------

export type StreamEvent =
  | { type: "delta"; text: string }
  | { type: "reasoning_delta"; text: string }
  | { type: "tool_call"; call: { id: string; name: string; arguments: Record<string, unknown> | string } }
  | { type: "tool_result"; toolCallId: string; agentId?: string; content: string; isError?: boolean }
  | { type: "agent_started"; agentId: string; label: string }
  | { type: "agent_finished"; agentId: string; label: string }
  | { type: "message"; message: ChatMessage }
  | { type: "usage"; promptTokens: number; completionTokens: number }
  | { type: "done" }
  | { type: "error"; message: string };

// ---------- API request shapes ----------

export interface ChatRequest {
  conversationId: string;
  content?: string;
  parts?: ContentPart[];
  regenerate?: boolean;
  editLastUser?: boolean;
  // When true, the server pulls in any tools registered for the current
  // agent / provider before dispatching. The mock provider always honors
  // this so the UI can develop tool UX without a real key.
  useTools?: boolean;
  // Override the conversation's reasoning effort for this turn only.
  // The server falls back to `conversation.reasoningEffort` when omitted.
  reasoningEffort?: ReasoningEffort;
  // When false, the server still collects reasoning deltas (so they can
  // be persisted) but does not stream them to the client. Defaults to
  // `true` so first-run users see something.
  showThinking?: boolean;
}

// ---------- Usage / import-export ----------

export interface UsageBucket {
  provider: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  messageCount: number;
  /**
   * Set when this row aggregates multiple provider/model pairs. Only
   * populated on the `byModel` report — e.g. `["openai", "azure"]` for
   * a `gpt-4o` bucket that came in via two routes. Sorted + de-duped.
   * Absent on rows that come from a single provider.
   */
  providers?: string[];
}

export interface UsageReport {
  total: { promptTokens: number; completionTokens: number; totalTokens: number; messageCount: number };
  byProvider: UsageBucket[];
  byModel: UsageBucket[];
  // ISO date string the report was generated at.
  generatedAt: string;
}

export interface ExportedConversation extends ConversationWithMessages {
  // Schema version for forward-compatible imports.
  schema: 1;
  // ISO date string the export was created at.
  exportedAt: string;
}
