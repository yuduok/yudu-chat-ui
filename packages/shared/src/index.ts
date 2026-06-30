// Shared types between web and server. Keep this file dependency-free.

export type Role = "system" | "user" | "assistant";

export type ContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export interface ChatMessage {
  id: string;
  conversationId: string;
  role: Role;
  content: string;
  parts?: ContentPart[] | null;
  promptTokens?: number | null;
  completionTokens?: number | null;
  createdAt: number;
}

export interface Conversation {
  id: string;
  title: string;
  provider: string;
  model: string;
  systemPrompt?: string | null;
  temperature?: number | null;
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
}

// Provider-facing normalized message shape (consumed by chat providers)
export interface ProviderMessage {
  role: Role;
  content: string;
  parts?: ContentPart[];
}

// ---------- Streaming protocol (SSE) ----------

export type StreamEvent =
  | { type: "delta"; text: string }
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
}
