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
  | { type: "image_url"; image_url: { url: string } }
  | ToolCallPart
  | ToolResultPart;

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
  // When true, the orchestrator hands the next turn to the next agent in
  // `chain` after this one finishes. Used to wire planner → worker.
  chain?: string[];
  // When true, the agent's output is fed into the next agent in the chain
  // verbatim rather than being shown in the chat.
  handoff?: "context" | "none";
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
}
