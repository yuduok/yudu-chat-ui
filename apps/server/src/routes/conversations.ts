import type { FastifyInstance } from "fastify";
import { eq, desc } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "../db/index.js";
import { conversations, messages } from "../db/schema.js";
import type {
  ChatMessage,
  Conversation,
  ConversationWithMessages,
} from "@yudu/shared";

function rowToConversation(row: typeof conversations.$inferSelect): Conversation {
  return {
    id: row.id,
    title: row.title,
    provider: row.provider,
    model: row.model,
    systemPrompt: row.systemPrompt,
    temperature: row.temperature,
    agentId: row.agentId ?? null,
    reasoningEffort: (row.reasoningEffort as Conversation["reasoningEffort"]) ?? null,
    showThinking: row.showThinking ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function rowToMessage(row: typeof messages.$inferSelect): ChatMessage {
  let parts: ChatMessage["parts"] = null;
  if (row.parts) {
    try {
      parts = JSON.parse(row.parts);
    } catch {
      parts = null;
    }
  }
  let toolCallIds: ChatMessage["toolCallIds"] = null;
  if (row.toolCallIds) {
    try { toolCallIds = JSON.parse(row.toolCallIds); } catch { toolCallIds = null; }
  }
  return {
    id: row.id,
    conversationId: row.conversationId,
    role: row.role as ChatMessage["role"],
    content: row.content,
    parts,
    toolCallIds,
    promptTokens: row.promptTokens,
    completionTokens: row.completionTokens,
    createdAt: row.createdAt,
  };
}

export async function conversationRoutes(app: FastifyInstance) {
  // List conversations (newest first)
  app.get("/api/conversations", async () => {
    const rows = await db
      .select()
      .from(conversations)
      .orderBy(desc(conversations.updatedAt));
    return rows.map(rowToConversation);
  });

  // Create conversation
  app.post<{
    Body: {
      title?: string;
      provider?: string;
      model?: string;
      systemPrompt?: string;
      temperature?: number;
      agentId?: string | null;
      reasoningEffort?: "low" | "medium" | "high" | "xhigh" | null;
      showThinking?: boolean | null;
    };
  }>("/api/conversations", async (req) => {
    const id = nanoid();
    const now = Date.now();
    const body = req.body ?? {};
    const row = {
      id,
      title: body.title?.trim() || "New Chat",
      provider: body.provider ?? "openai",
      model: body.model ?? "gpt-4o-mini",
      systemPrompt: body.systemPrompt ?? null,
      temperature: body.temperature ?? 0.7,
      agentId: body.agentId ?? null,
      reasoningEffort: body.reasoningEffort ?? null,
      showThinking: body.showThinking ?? null,
      createdAt: now,
      updatedAt: now,
    };
    await db.insert(conversations).values(row);
    return rowToConversation(row);
  });

  // Get one with messages
  app.get<{ Params: { id: string } }>(
    "/api/conversations/:id",
    async (req, reply) => {
      const id = req.params.id;
      const [conv] = await db
        .select()
        .from(conversations)
        .where(eq(conversations.id, id));
      if (!conv) return reply.code(404).send({ error: "Not found" });
      const msgRows = await db
        .select()
        .from(messages)
        .where(eq(messages.conversationId, id))
        .orderBy(messages.createdAt);
      const result: ConversationWithMessages = {
        ...rowToConversation(conv),
        messages: msgRows.map(rowToMessage),
      };
      return result;
    },
  );

  // Update (title / provider / model / systemPrompt / temperature)
  app.patch<{
    Params: { id: string };
    Body: Partial<{
      title: string;
      provider: string;
      model: string;
      systemPrompt: string | null;
      temperature: number | null;
      agentId: string | null;
      reasoningEffort: "low" | "medium" | "high" | "xhigh" | null;
      showThinking: boolean | null;
    }>;
  }>("/api/conversations/:id", async (req, reply) => {
    const id = req.params.id;
    const patch: Record<string, unknown> = { updatedAt: Date.now() };
    const b = req.body ?? {};
    if (typeof b.title === "string") patch.title = b.title;
    if (typeof b.provider === "string") patch.provider = b.provider;
    if (typeof b.model === "string") patch.model = b.model;
    if (b.systemPrompt !== undefined) patch.systemPrompt = b.systemPrompt;
    if (b.temperature !== undefined) patch.temperature = b.temperature;
    if (b.agentId !== undefined) patch.agentId = b.agentId;
    if (b.reasoningEffort !== undefined) {
      patch.reasoningEffort =
        b.reasoningEffort === null ? null : String(b.reasoningEffort);
    }
    if (b.showThinking !== undefined) {
      patch.showThinking = b.showThinking === null ? null : Boolean(b.showThinking);
    }
    await db.update(conversations).set(patch).where(eq(conversations.id, id));
    const [conv] = await db.select().from(conversations).where(eq(conversations.id, id));
    if (!conv) return reply.code(404).send({ error: "Not found" });
    return rowToConversation(conv);
  });

  // Delete
  app.delete<{ Params: { id: string } }>(
    "/api/conversations/:id",
    async (req, reply) => {
      const id = req.params.id;
      await db.delete(conversations).where(eq(conversations.id, id));
      return reply.send({ ok: true });
    },
  );

  // Delete a single message
  app.delete<{ Params: { id: string; messageId: string } }>(
    "/api/conversations/:id/messages/:messageId",
    async (req) => {
      const { id, messageId } = req.params;
      await db
        .delete(messages)
        .where(eq(messages.id, messageId));
      await db
        .update(conversations)
        .set({ updatedAt: Date.now() })
        .where(eq(conversations.id, id));
      return { ok: true };
    },
  );
}
