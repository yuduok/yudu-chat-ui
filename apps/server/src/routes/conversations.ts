import type { FastifyInstance } from "fastify";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "../db/index.js";
import { conversations, messages } from "../db/schema.js";
import type {
  ChatMessage,
  Conversation,
  ConversationWithMessages,
} from "@yudu/shared";

// Fields that can be bulk-applied across every conversation row.
// `title`, `systemPrompt` and `temperature` are intentionally
// excluded — they vary per chat (auto-named, per-conversation
// system prompt, per-conversation temperature). The rest are the
// global chat "environment": which provider/model powers the
// conversation, which agent orchestrates it, how hard it should
// think, and whether the reasoning trace should be visible.
type GlobalSettingsPatch = Partial<{
  provider: string;
  model: string;
  agentId: string | null;
  reasoningEffort: "low" | "medium" | "high" | "xhigh" | null;
  showThinking: boolean | null;
}>;

// Translate the wire body into a strict DB patch. We never trust
// fields the caller didn't send — `undefined` means "leave alone",
// `null` means "explicitly clear". This is the single source of
// truth for what a settings update may change; both the per-row
// PATCH and the bulk PATCH route through it.
function buildSettingsPatch(b: Record<string, unknown> | undefined): Record<string, unknown> {
  const patch: Record<string, unknown> = { updatedAt: Date.now() };
  if (!b) return patch;
  if (typeof b.provider === "string") patch.provider = b.provider;
  if (typeof b.model === "string") patch.model = b.model;
  if (b.agentId !== undefined) patch.agentId = b.agentId;
  if (b.reasoningEffort !== undefined) {
    patch.reasoningEffort =
      b.reasoningEffort === null ? null : String(b.reasoningEffort);
  }
  if (b.showThinking !== undefined) {
    patch.showThinking = b.showThinking === null ? null : Boolean(b.showThinking);
  }
  return patch;
}

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

function rowToolCallIds(row: typeof messages.$inferSelect): string[] {
  if (row.toolCallIds) {
    try {
      const parsed = JSON.parse(row.toolCallIds);
      if (Array.isArray(parsed)) return parsed.filter((id): id is string => typeof id === "string");
    } catch {}
  }
  if (!row.parts) return [];
  try {
    const parsed = JSON.parse(row.parts);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((part) => part?.type === "tool_call" && typeof part.id === "string")
      .map((part) => part.id);
  } catch {
    return [];
  }
}

function rowToolResultIds(row: typeof messages.$inferSelect): string[] {
  if (!row.parts) return [];
  try {
    const parsed = JSON.parse(row.parts);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((part) => part?.type === "tool_result" && typeof part.toolCallId === "string")
      .map((part) => part.toolCallId);
  } catch {
    return [];
  }
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
    if (b.systemPrompt !== undefined) patch.systemPrompt = b.systemPrompt;
    if (b.temperature !== undefined) patch.temperature = b.temperature;
    // provider / model / agent / reasoningEffort / showThinking
    // share the same wire contract as the bulk endpoint, so they
    // route through the same validation helper.
    const settings = buildSettingsPatch(b);
    for (const k of Object.keys(settings)) patch[k] = settings[k];
    await db.update(conversations).set(patch).where(eq(conversations.id, id));
    const [conv] = await db.select().from(conversations).where(eq(conversations.id, id));
    if (!conv) return reply.code(404).send({ error: "Not found" });
    return rowToConversation(conv);
  });

  // Bulk-apply a settings patch to every conversation row. The
  // chat UI uses this so a single provider / model / agent /
  // reasoning-depth / show-thinking change is reflected in every
  // existing chat (and every future chat created from those
  // defaults). Title / systemPrompt / temperature stay
  // per-conversation and are rejected by the helper.
  app.patch<{ Body: GlobalSettingsPatch }>(
    "/api/conversations/all",
    async (req) => {
      const patch = buildSettingsPatch(req.body ?? {});
      // If the caller sent nothing applicable (empty body or
      // only per-row fields), this becomes `{ updatedAt }` —
      // harmless, no rows actually change aside from a stamp.
      await db.update(conversations).set(patch);
      const rows = await db
        .select()
        .from(conversations)
        .orderBy(desc(conversations.updatedAt));
      return { ok: true, count: rows.length, conversations: rows.map(rowToConversation) };
    },
  );

  // Delete
  app.delete<{ Params: { id: string } }>(
    "/api/conversations/:id",
    async (req, reply) => {
      const id = req.params.id;
      await db.delete(conversations).where(eq(conversations.id, id));
      return reply.send({ ok: true });
    },
  );

  // Delete a message. Tool calls and their results form one provider-protocol
  // group, so deleting any member removes the whole group atomically.
  app.delete<{ Params: { id: string; messageId: string } }>(
    "/api/conversations/:id/messages/:messageId",
    async (req, reply) => {
      const { id, messageId } = req.params;
      const rows = await db
        .select()
        .from(messages)
        .where(eq(messages.conversationId, id))
        .orderBy(asc(messages.createdAt));
      const targetIndex = rows.findIndex((row) => row.id === messageId);
      if (targetIndex < 0) {
        return reply.code(404).send({ error: "Message not found in conversation" });
      }
      const target = rows[targetIndex];

      let toolCallRow: typeof messages.$inferSelect | undefined;
      if (target.role === "assistant" && rowToolCallIds(target).length > 0) {
        toolCallRow = target;
      } else if (target.role === "tool") {
        const targetResultIds = new Set(rowToolResultIds(target));
        let assistantIndex = targetIndex - 1;
        while (assistantIndex >= 0 && rows[assistantIndex].role === "tool") assistantIndex -= 1;
        const candidate = rows[assistantIndex];
        if (
          candidate?.role === "assistant" &&
          rowToolCallIds(candidate).some((callId) => targetResultIds.has(callId))
        ) {
          toolCallRow = candidate;
        }
      }

      const deletedIds = new Set<string>([messageId]);
      if (toolCallRow) {
        const groupCallIds = new Set(rowToolCallIds(toolCallRow));
        deletedIds.add(toolCallRow.id);
        const assistantIndex = rows.indexOf(toolCallRow);
        for (let index = assistantIndex + 1; index < rows.length; index += 1) {
          const row = rows[index];
          if (row.role !== "tool") break;
          if (
            rowToolResultIds(row).some((resultId) => groupCallIds.has(resultId))
          ) {
            deletedIds.add(row.id);
          }
        }
      }

      db.transaction((tx) => {
        tx.delete(messages)
          .where(and(inArray(messages.id, [...deletedIds]), eq(messages.conversationId, id)))
          .run();
        tx.update(conversations)
          .set({ updatedAt: Date.now() })
          .where(eq(conversations.id, id))
          .run();
      });
      return { ok: true, deletedIds: [...deletedIds] };
    },
  );

  // Export one conversation as a self-contained JSON document. The format
  // matches the `ExportedConversation` shared type — schema=1, plus the
  // full conversation row and ordered messages. The client renders this
  // as `.json` directly, and converts it to `.md` / `.png` for the other
  // export formats.
  app.get<{ Params: { id: string } }>(
    "/api/conversations/:id/export",
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
      const payload = {
        schema: 1,
        exportedAt: new Date().toISOString(),
        ...rowToConversation(conv),
        messages: msgRows.map(rowToMessage),
      };
      const filename = (conv.title || "conversation").replace(/[^a-zA-Z0-9-_]+/g, "_").slice(0, 60) || "conversation";
      reply.header("Content-Type", "application/json; charset=utf-8");
      reply.header(
        "Content-Disposition",
        `attachment; filename="${filename}.json"`,
      );
      return reply.send(JSON.stringify(payload, null, 2));
    },
  );

  // Import a previously-exported conversation. We mint a brand new id
  // for the conversation and re-key the message rows so the import never
  // collides with existing data. Schema 1 only for now.
  app.post<{ Body: unknown }>("/api/conversations/import", async (req, reply) => {
    const body = (req.body ?? {}) as any;
    const src = (body.conversation ?? body) as any;
    const schema = Number(src?.schema ?? 1);
    if (schema !== 1) {
      return reply.code(400).send({ error: `Unsupported export schema: ${schema}` });
    }
    const required = ["title", "provider", "model"];
    for (const k of required) {
      if (typeof src?.[k] !== "string") {
        return reply.code(400).send({ error: `Missing field: ${k}` });
      }
    }
    const now = Date.now();
    const newId = nanoid();
    const messageRows: Array<typeof messages.$inferInsert> = [];
    const messagesSrc: unknown[] = Array.isArray(src.messages) ? src.messages : [];
    const ALLOWED_ROLES = new Set(["system", "user", "assistant", "tool"]);
    for (const m of messagesSrc) {
      const mm = m as Record<string, unknown>;
      if (typeof mm.id !== "string" || typeof mm.role !== "string") continue;
      // Reject anything that isn't a known role so an attacker can't
      // smuggle a row past the schema and into the provider layer.
      if (!ALLOWED_ROLES.has(String(mm.role))) continue;
      const parts = mm.parts ?? null;
      const toolCallIds = mm.toolCallIds ?? null;
      messageRows.push({
        // Mint a fresh id so re-importing the same file (or a hand-
        // edited export that collides with an existing row) can't
        // blow up the messages primary key.
        id: nanoid(),
        conversationId: newId,
        role: String(mm.role),
        content: typeof mm.content === "string" ? mm.content : "",
        parts: parts ? JSON.stringify(parts) : null,
        toolCallIds: toolCallIds ? JSON.stringify(toolCallIds) : null,
        promptTokens: typeof mm.promptTokens === "number" ? mm.promptTokens : null,
        completionTokens: typeof mm.completionTokens === "number" ? mm.completionTokens : null,
        createdAt: typeof mm.createdAt === "number" ? mm.createdAt : now,
      });
    }
    const ALLOWED_EFFORT = new Set(["low", "medium", "high", "xhigh"]);
    const safeEffort =
      typeof src.reasoningEffort === "string" && ALLOWED_EFFORT.has(src.reasoningEffort)
        ? src.reasoningEffort
        : null;
    const row = {
      id: newId,
      title: String(src.title),
      provider: String(src.provider),
      model: String(src.model),
      systemPrompt: typeof src.systemPrompt === "string" ? src.systemPrompt : null,
      temperature: typeof src.temperature === "number" ? src.temperature : 0.7,
      agentId: typeof src.agentId === "string" ? src.agentId : null,
      reasoningEffort: safeEffort,
      showThinking: typeof src.showThinking === "boolean" ? src.showThinking : null,
      createdAt: typeof src.createdAt === "number" ? src.createdAt : now,
      updatedAt: now,
    };
    await db.insert(conversations).values(row);
    if (messageRows.length) await db.insert(messages).values(messageRows);
    const [conv] = await db.select().from(conversations).where(eq(conversations.id, newId));
    return rowToConversation(conv);
  });
}
