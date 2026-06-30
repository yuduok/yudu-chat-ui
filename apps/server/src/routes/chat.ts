import type { FastifyInstance } from "fastify";
import { eq, asc } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "../db/index.js";
import { conversations, messages } from "../db/schema.js";
import { getProvider } from "../providers/registry.js";
import { getProviderSetting } from "./settings.js";
import type {
  ChatMessage,
  ChatRequest,
  ProviderMessage,
  StreamEvent,
} from "@yudu/shared";

function sseReply(reply: any) {
  reply.raw.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  reply.raw.setHeader("Cache-Control", "no-cache, no-transform");
  reply.raw.setHeader("Connection", "keep-alive");
  reply.raw.setHeader("X-Accel-Buffering", "no");
  reply.hijack();
  return reply.raw;
}

function sendSse(stream: NodeJS.WritableStream, ev: StreamEvent) {
  const data = `data: ${JSON.stringify(ev)}\n\n`;
  stream.write(data);
}

function messageToProvider(m: ChatMessage): ProviderMessage {
  if (m.parts && Array.isArray(m.parts) && m.parts.length) {
    return { role: m.role, content: m.content, parts: m.parts };
  }
  return { role: m.role, content: m.content };
}

export async function chatRoutes(app: FastifyInstance) {
  // POST /api/chat -> SSE stream
  app.post<{ Body: ChatRequest }>("/api/chat", async (req, reply) => {
    const body = req.body;
    if (!body?.conversationId) {
      return reply.code(400).send({ error: "conversationId required" });
    }

    const [conv] = await db
      .select()
      .from(conversations)
      .where(eq(conversations.id, body.conversationId));
    if (!conv) return reply.code(404).send({ error: "Conversation not found" });

    const provider = getProvider(conv.provider);
    if (!provider) {
      return reply.code(400).send({ error: `Unknown provider: ${conv.provider}` });
    }
    const setting = getProviderSetting(conv.provider);
    if (!setting.apiKey && conv.provider !== "mock") {
      return reply.code(400).send({
        error: `No API key configured for provider "${conv.provider}". Set it in Settings.`,
      });
    }

    // Load existing messages
    const existing = await db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, conv.id))
      .orderBy(asc(messages.createdAt));

    // Handle edit-last-user: update the last user message in place.
    let working: ChatMessage[] = existing.map((r) => ({
      id: r.id,
      conversationId: r.conversationId,
      role: r.role as ChatMessage["role"],
      content: r.content,
      parts: r.parts ? JSON.parse(r.parts) : null,
      promptTokens: r.promptTokens,
      completionTokens: r.completionTokens,
      createdAt: r.createdAt,
    }));

    // Drop trailing assistant messages on regenerate/edit
    while (
      working.length &&
      working[working.length - 1].role === "assistant"
    ) {
      const dropped = working.pop()!;
      await db.delete(messages).where(eq(messages.id, dropped.id));
    }

    if (body.editLastUser && working.length && working[working.length - 1].role === "user") {
      const last = working[working.length - 1];
      const newContent = body.content ?? "";
      const newParts = body.parts ?? null;
      await db
        .update(messages)
        .set({
          content: newContent,
          parts: newParts ? JSON.stringify(newParts) : null,
        })
        .where(eq(messages.id, last.id));
      last.content = newContent;
      last.parts = newParts;
    } else if (body.regenerate) {
      // nothing else to do; the model will reply using the current history
    } else {
      // Append new user message
      const userMsg: ChatMessage = {
        id: nanoid(),
        conversationId: conv.id,
        role: "user",
        content: body.content ?? "",
        parts: body.parts ?? null,
        createdAt: Date.now(),
      };
      await db.insert(messages).values({
        id: userMsg.id,
        conversationId: userMsg.conversationId,
        role: userMsg.role,
        content: userMsg.content,
        parts: userMsg.parts ? JSON.stringify(userMsg.parts) : null,
        createdAt: userMsg.createdAt,
      });
      working.push(userMsg);
    }

    // Auto-title from first user message (only if still default)
    if (conv.title === "New Chat") {
      const firstUser = working.find((m) => m.role === "user");
      if (firstUser) {
        const t = firstUser.content.slice(0, 40) || "New Chat";
        await db
          .update(conversations)
          .set({ title: t, updatedAt: Date.now() })
          .where(eq(conversations.id, conv.id));
      }
    } else {
      await db
        .update(conversations)
        .set({ updatedAt: Date.now() })
        .where(eq(conversations.id, conv.id));
    }

    const stream = sseReply(reply);

    // Create the assistant message placeholder (so we have an id)
    const assistantMsg: ChatMessage = {
      id: nanoid(),
      conversationId: conv.id,
      role: "assistant",
      content: "",
      parts: null,
      promptTokens: null,
      completionTokens: null,
      createdAt: Date.now(),
    };
    await db.insert(messages).values({
      id: assistantMsg.id,
      conversationId: assistantMsg.conversationId,
      role: assistantMsg.role,
      content: "",
      parts: null,
      createdAt: assistantMsg.createdAt,
    });

    const ac = new AbortController();
    req.raw.on("close", () => {
      ac.abort();
    });

    // Stream the response
    (async () => {
      try {
        const providerMessages = working
          .filter((m) => m.role !== "system")
          .map(messageToProvider);

        let promptTokens = 0;
        let completionTokens = 0;
        let acc = "";

        for await (const chunk of provider.chat({
          model: conv.model,
          systemPrompt: conv.systemPrompt ?? undefined,
          temperature: conv.temperature ?? 0.7,
          messages: providerMessages,
          signal: ac.signal,
          apiKey: setting.apiKey!,
          baseUrl: setting.baseUrl,
        })) {
          if (chunk.delta) {
            acc += chunk.delta;
            sendSse(stream, { type: "delta", text: chunk.delta });
          }
          if (chunk.usage) {
            promptTokens = chunk.usage.promptTokens;
            completionTokens = chunk.usage.completionTokens;
          }
        }

        // Finalize
        await db
          .update(messages)
          .set({
            content: acc,
            promptTokens,
            completionTokens,
          })
          .where(eq(messages.id, assistantMsg.id));
        await db
          .update(conversations)
          .set({ updatedAt: Date.now() })
          .where(eq(conversations.id, conv.id));

        sendSse(stream, { type: "usage", promptTokens, completionTokens });
        sendSse(stream, {
          type: "message",
          message: {
            ...assistantMsg,
            content: acc,
            promptTokens,
            completionTokens,
          },
        });
        sendSse(stream, { type: "done" });
        stream.end();
      } catch (err: any) {
        if (err?.name === "AbortError") {
          // Persist what we have so far
          try {
            await db
              .update(messages)
              .set({ content: "" }) // already saved incrementally via stream
              .where(eq(messages.id, assistantMsg.id));
          } catch {}
          try {
            sendSse(stream, { type: "error", message: "aborted" });
            stream.end();
          } catch {}
          return;
        }
        try {
          sendSse(stream, {
            type: "error",
            message: err?.message ?? "Upstream error",
          });
          stream.end();
        } catch {}
      }
    })();

    // Returning reply keeps Fastify happy; we've already hijacked.
    return reply;
  });
}
