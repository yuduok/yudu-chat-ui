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
