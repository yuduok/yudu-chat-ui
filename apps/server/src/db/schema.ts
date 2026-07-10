import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";

export const conversations = sqliteTable("conversations", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  provider: text("provider").notNull(),
  model: text("model").notNull(),
  systemPrompt: text("system_prompt"),
  temperature: real("temperature"),
  // Optional: when set, the server resolves the agent profile on every turn
  // and applies its systemPrompt / tool allowlist / temperature overrides.
  agentId: text("agent_id"),
  // Optional: reasoning depth hint forwarded to the provider. Persisted
  // per conversation so the choice survives a page reload.
  reasoningEffort: text("reasoning_effort"),
  // Whether the UI should render the reasoning trace. The server still
  // collects & persists reasoning deltas when this is false so the data
  // is recoverable from the DB even if the toggle is off.
  showThinking: integer("show_thinking", { mode: "boolean" }),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const messages = sqliteTable("messages", {
  id: text("id").primaryKey(),
  conversationId: text("conversation_id")
    .notNull()
    .references(() => conversations.id, { onDelete: "cascade" }),
  // 'user' | 'assistant' | 'system' | 'tool'
  role: text("role").notNull(),
  content: text("content").notNull(),
  parts: text("parts"), // JSON
  // Convenience snapshot of the tool_call ids emitted in this assistant
  // message. JSON-encoded array of strings.
  toolCallIds: text("tool_call_ids"),
  promptTokens: integer("prompt_tokens"),
  completionTokens: integer("completion_tokens"),
  createdAt: integer("created_at").notNull(),
});

export const imageGenerations = sqliteTable("image_generations", {
  id: text("id").primaryKey(),
  provider: text("provider").notNull(),
  model: text("model").notNull(),
  prompt: text("prompt").notNull(),
  options: text("options").notNull(),
  referenceImages: text("reference_images").notNull(),
  status: text("status").notNull(),
  images: text("images").notNull(),
  error: text("error"),
  createdAt: integer("created_at").notNull(),
  completedAt: integer("completed_at").notNull(),
});
