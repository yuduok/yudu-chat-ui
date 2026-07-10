import type { FastifyInstance } from "fastify";
import { and, asc, eq, inArray } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "../db/index.js";
import { conversations, messages } from "../db/schema.js";
import { getProvider } from "../providers/registry.js";
import { getProviderSetting } from "./settings.js";
import { getAgent } from "../agents/index.js";
import { listTools, runTool } from "../tools/index.js";
import { getEnabledSkillsPrompt } from "../skills/index.js";
import { getAllSettings } from "./settings.js";
import type {
  AgentProfile,
  ChatMessage,
  ChatRequest,
  ContentPart,
  ProviderMessage,
  StreamEvent,
  ToolCallPart,
  ToolDefinition,
  ToolResultPart,
} from "@yudu/shared";

const MAX_TOOL_ROUNDS = 5;

function sseReply(reply: any) {
  reply.raw.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  reply.raw.setHeader("Cache-Control", "no-cache, no-transform");
  reply.raw.setHeader("Connection", "keep-alive");
  reply.raw.setHeader("X-Accel-Buffering", "no");
  reply.hijack();
  reply.raw.flushHeaders();
  return reply.raw;
}

function sendSse(stream: NodeJS.WritableStream, ev: StreamEvent) {
  stream.write(`data: ${JSON.stringify(ev)}\n\n`);
}

function messageToProvider(m: ChatMessage): ProviderMessage {
  if (m.parts && Array.isArray(m.parts) && m.parts.length) {
    // Translate content-side tool_call / tool_result parts into provider-side
    // tool_use / tool_result parts. Also populate the convenience toolCalls
    // snapshot for adapters that prefer it. Reasoning parts are chat-side
    // only — drop them before forwarding upstream.
    const toolCalls: NonNullable<ProviderMessage["toolCalls"]> = [];
    const providerParts: NonNullable<ProviderMessage["parts"]> = [];
    for (const p of m.parts) {
      if (p.type === "tool_call") {
        toolCalls.push({ id: p.id, name: p.name, arguments: p.arguments });
        providerParts.push({
          type: "tool_use",
          id: p.id,
          name: p.name,
          input: parseArgs(p.arguments),
        });
      } else if (p.type === "tool_result") {
        providerParts.push({
          type: "tool_result",
          toolUseId: p.toolCallId,
          content: p.content,
          isError: p.isError,
        });
      } else if (p.type === "text") {
        providerParts.push({ type: "text", text: p.text });
      } else if (p.type === "image_url") {
        providerParts.push({ type: "image_url", image_url: p.image_url });
      } else if (p.type === "document") {
        providerParts.push({
          type: "text",
          text: `[Attached document: ${JSON.stringify(p.name)} (${p.mimeType})]\n${p.text}\n[End attached document]`,
        });
      }
      // p.type === "reasoning" is intentionally dropped — chat-only.
    }
    const out: ProviderMessage = { role: m.role, content: m.content, parts: providerParts };
    if (toolCalls.length) out.toolCalls = toolCalls;
    return out;
  }
  return { role: m.role, content: m.content };
}

function parseArgs(args: Record<string, unknown> | string): Record<string, unknown> {
  if (typeof args !== "string") return args;
  try {
    return JSON.parse(args);
  } catch {
    return {};
  }
}

function withSkills(systemPrompt: string | null | undefined): string | undefined {
  if (!getAllSettings().skills.enabled) return systemPrompt ?? undefined;
  const skillsPrompt = getEnabledSkillsPrompt();
  if (!skillsPrompt) return systemPrompt ?? undefined;
  return [systemPrompt, "Follow these enabled user skills when relevant:", skillsPrompt].filter(Boolean).join("\n\n");
}

function rowToMessage(row: typeof messages.$inferSelect): ChatMessage {
  let parts: ChatMessage["parts"] = null;
  if (row.parts) {
    try { parts = JSON.parse(row.parts); } catch { parts = null; }
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

// Pick the tools that this turn should advertise. We merge:
//   1. agent.tools (if agent is active)
//   2. all registered tools (if useTools=true)
//   3. always include get_weather when the provider is mock (so the demo
//      tool loop is reachable without a real key)
function pickTools(opts: {
  agent: AgentProfile | null;
  useTools: boolean;
  providerId: string;
}): ToolDefinition[] {
  const wantNames = new Set<string>();
  if (opts.agent?.tools) opts.agent.tools.forEach((n) => wantNames.add(n));
  if (opts.useTools) {
    // Only expose tools explicitly marked safe for the global toggle.
    // Write/command tools require both an agent allowlist entry and a
    // server-side capability flag.
    for (const t of listTools({ defaultsOnly: true })) wantNames.add(t.name);
  }
  if (opts.providerId === "mock") wantNames.add("get_weather");
  if (wantNames.size === 0) return [];
  return listTools().filter((t) => wantNames.has(t.name));
}

const conversationLocks = new Map<string, Promise<void>>();
const chatRequestControllers = new Map<string, AbortController>();
const cancelledChatRequestIds = new Map<string, number>();

function pruneCancelledChatRequests(now = Date.now()): void {
  for (const [requestId, cancelledAt] of cancelledChatRequestIds) {
    if (now - cancelledAt > 60_000) cancelledChatRequestIds.delete(requestId);
  }
}

function unregisterChatRequest(requestId: string | null, controller: AbortController): void {
  if (requestId && chatRequestControllers.get(requestId) === controller) {
    chatRequestControllers.delete(requestId);
  }
}

async function acquireConversationLock(conversationId: string): Promise<() => void> {
  const previous = conversationLocks.get(conversationId) ?? Promise.resolve();
  let openGate!: () => void;
  const gate = new Promise<void>((resolve) => { openGate = resolve; });
  const tail = previous.then(() => gate);
  conversationLocks.set(conversationId, tail);
  await previous;

  let released = false;
  return () => {
    if (released) return;
    released = true;
    openGate();
    void tail.finally(() => {
      if (conversationLocks.get(conversationId) === tail) {
        conversationLocks.delete(conversationId);
      }
    });
  };
}

async function insertMessage(message: ChatMessage): Promise<void> {
  await db.insert(messages).values(messageInsertValues(message));
}

function messageInsertValues(message: ChatMessage): typeof messages.$inferInsert {
  return {
    id: message.id,
    conversationId: message.conversationId,
    role: message.role,
    content: message.content,
    parts: message.parts?.length ? JSON.stringify(message.parts) : null,
    toolCallIds: message.toolCallIds?.length ? JSON.stringify(message.toolCallIds) : null,
    promptTokens: message.promptTokens ?? null,
    completionTokens: message.completionTokens ?? null,
    createdAt: message.createdAt,
  };
}

async function restoreMessageTail(opts: {
  conversationId: string;
  anchorId: string;
  includeAnchor: boolean;
  originalRows: Array<typeof messages.$inferSelect>;
  conversation: { title: string; updatedAt: number };
}): Promise<void> {
  const current = await db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, opts.conversationId))
    .orderBy(asc(messages.createdAt));
  const anchorIndex = current.findIndex((row) => row.id === opts.anchorId);
  if (anchorIndex < 0) {
    throw new Error("cannot restore chat history because its anchor message is missing");
  }
  const deleteFrom = opts.includeAnchor ? anchorIndex : anchorIndex + 1;
  const currentTailIds = current.slice(deleteFrom).map((row) => row.id);

  db.transaction((tx) => {
    if (currentTailIds.length) {
      tx.delete(messages).where(inArray(messages.id, currentTailIds)).run();
    }
    if (opts.originalRows.length) {
      tx.insert(messages).values(opts.originalRows).run();
    }
    tx.update(conversations)
      .set({ title: opts.conversation.title, updatedAt: opts.conversation.updatedAt })
      .where(eq(conversations.id, opts.conversationId))
      .run();
  });
}

function providerHistoryFromMessages(history: ChatMessage[]): ProviderMessage[] {
  const normalized: ChatMessage[] = [];

  for (let index = 0; index < history.length; index += 1) {
    const message = history[index];
    if (message.role === "tool") {
      // Orphaned tool results can exist in legacy/imported histories. Sending
      // them upstream would make both OpenAI and Anthropic reject the turn.
      continue;
    }

    const callIds = message.role === "assistant"
      ? new Set(message.toolCallIds ?? message.parts
        ?.filter((part): part is ToolCallPart => part.type === "tool_call")
        .map((part) => part.id) ?? [])
      : new Set<string>();
    if (callIds.size === 0) {
      normalized.push(message);
      continue;
    }

    const toolResults: ChatMessage[] = [];
    let cursor = index + 1;
    while (cursor < history.length && history[cursor].role === "tool") {
      toolResults.push(history[cursor]);
      cursor += 1;
    }
    const resultIds = new Set(
      toolResults.flatMap((toolMessage) =>
        (toolMessage.parts ?? [])
          .filter((part): part is ToolResultPart => part.type === "tool_result")
          .map((part) => part.toolCallId),
      ),
    );

    // A tool-use turn is an atomic protocol group. Drop an incomplete legacy
    // group rather than forwarding a dangling tool_use/tool_result upstream.
    if ([...callIds].every((id) => resultIds.has(id))) {
      normalized.push(message);
      normalized.push(...toolResults.filter((toolMessage) =>
        (toolMessage.parts ?? []).some(
          (part) => part.type === "tool_result" && callIds.has(part.toolCallId),
        ),
      ));
    }
    index = cursor - 1;
  }

  return normalized
    .filter((message) => message.role !== "system")
    .map(messageToProvider);
}

function abortError(): Error {
  const error = new Error("aborted");
  error.name = "AbortError";
  return error;
}

async function runAgentTurn(opts: {
  conversationId: string;
  tools: ToolDefinition[];
  workingProviderMessages: ProviderMessage[];
  agentId: string;
  label: string;
  stream: NodeJS.WritableStream;
  signal: AbortSignal;
  setting: { apiKey: string | null | undefined; baseUrl?: string | undefined };
  providerId: string;
  model: string;
  systemPrompt: string | null | undefined;
  temperature: number;
  reasoningEffort?: "low" | "medium" | "high" | "xhigh";
  showThinking?: boolean;
  isFinal: boolean;
  nextCreatedAt: () => number;
}): Promise<{ content: string; message: ChatMessage; usage: { p: number; c: number } }> {
  const {
    conversationId,
    tools,
    workingProviderMessages,
    agentId,
    label,
    stream,
    signal,
    setting,
    providerId,
    model,
    systemPrompt,
    temperature,
    reasoningEffort,
    showThinking = true,
    isFinal,
    nextCreatedAt,
  } = opts;

  const provider = getProvider(providerId);
  if (!provider) {
    throw new Error(`Unknown provider: ${providerId}`);
  }
  if (!setting.apiKey && provider.id !== "mock") {
    throw new Error(`No API key configured for provider "${provider.id}".`);
  }

  sendSse(stream, { type: "agent_started", agentId, label });

  const allowedToolNames = new Set(tools.map((tool) => tool.name));
  let promptTokens = 0;
  let completionTokens = 0;
  let toolRounds = 0;

  while (true) {
    if (signal.aborted) throw abortError();
    let roundText = "";
    let roundReasoning = "";
    let roundPromptTokens = 0;
    let roundCompletionTokens = 0;
    const collectedToolCalls: Array<{
      id: string;
      name: string;
      arguments: Record<string, unknown> | string;
    }> = [];
    // After the tool budget is exhausted, make one final synthesis request
    // without advertising tools. This guarantees we never persist a dangling
    // tool_call that the server deliberately refuses to execute.
    const advertisedTools = toolRounds < MAX_TOOL_ROUNDS ? tools : [];

    for await (const chunk of provider.chat({
      model,
      systemPrompt: systemPrompt ?? undefined,
      temperature,
      messages: workingProviderMessages,
      signal,
      apiKey: setting.apiKey ?? "",
      baseUrl: setting.baseUrl,
      tools: advertisedTools.length ? advertisedTools : undefined,
      toolChoice: advertisedTools.length ? "auto" : "none",
      reasoningEffort,
    })) {
      if (chunk.delta) {
        roundText += chunk.delta;
        if (isFinal) sendSse(stream, { type: "delta", text: chunk.delta });
      }
      if (chunk.usage) {
        roundPromptTokens = chunk.usage.promptTokens;
        roundCompletionTokens = chunk.usage.completionTokens;
      }
      if (chunk.toolCall) {
        collectedToolCalls.push({
          id: chunk.toolCall.id,
          name: chunk.toolCall.name,
          arguments: chunk.toolCall.arguments,
        });
        sendSse(stream, { type: "tool_call", call: chunk.toolCall });
      }
      if (chunk.reasoningDelta) {
        roundReasoning += chunk.reasoningDelta;
        if (showThinking) {
          sendSse(stream, {
            type: "reasoning_delta",
            text: chunk.reasoningDelta,
          });
        }
      }
      if (chunk.toolResult) {
        const r = chunk.toolResult;
        sendSse(stream, { type: "tool_result", toolCallId: r.toolCallId, content: r.content, isError: r.isError, agentId: r.agentId });
      }
      if (chunk.agentEvent) {
        // Forward provider-level agent events to the client.
        sendSse(stream, { type: chunk.agentEvent.kind === "started" ? "agent_started" : "agent_finished", agentId: chunk.agentEvent.agentId, label: chunk.agentEvent.label });
      }
    }

    // Some adapters stop their async generator cleanly when aborted instead
    // of throwing. Do not mistake that graceful return for a complete model
    // response and persist a partial text/reasoning assistant message.
    if (signal.aborted) throw abortError();

    promptTokens += roundPromptTokens;
    completionTokens += roundCompletionTokens;

    if (collectedToolCalls.length > 0) {
      if (advertisedTools.length === 0) {
        throw new Error("Provider emitted a tool call after tools were disabled");
      }
      const toolCallIds = collectedToolCalls.map((call) => call.id);
      const assistantParts: ContentPart[] = [
        ...(roundReasoning ? [{ type: "reasoning", text: roundReasoning } as ContentPart] : []),
        ...(roundText ? [{ type: "text", text: roundText } as ContentPart] : []),
        ...collectedToolCalls.map(
          (call): ToolCallPart => ({
            type: "tool_call",
            id: call.id,
            name: call.name,
            arguments: call.arguments,
          }),
        ),
      ];
      const toolCallMessage: ChatMessage = {
        id: nanoid(),
        conversationId,
        role: "assistant",
        content: roundText,
        parts: assistantParts,
        toolCallIds,
        promptTokens: roundPromptTokens,
        completionTokens: roundCompletionTokens,
        createdAt: nextCreatedAt(),
      };
      const toolMessages: ChatMessage[] = [];

      for (const call of collectedToolCalls) {
        if (signal.aborted) throw abortError();
        let result: { content: string; isError?: boolean };
        if (!allowedToolNames.has(call.name)) {
          result = { content: `tool '${call.name}' is not authorized for this turn`, isError: true };
        } else {
          result = await runTool(call.name, parseArgs(call.arguments), { signal });
        }
        const resultPart: ToolResultPart = {
          type: "tool_result",
          toolCallId: call.id,
          content: result.content,
          isError: result.isError,
          agentId,
        };
        const toolMessage: ChatMessage = {
          id: nanoid(),
          conversationId,
          role: "tool",
          content: result.content,
          parts: [resultPart],
          toolCallIds: null,
          promptTokens: null,
          completionTokens: null,
          createdAt: nextCreatedAt(),
        };
        toolMessages.push(toolMessage);
      }

      if (isFinal) {
        // Persist the assistant tool_use and every matching tool_result as one
        // transaction. An abort between tools can no longer leave a history
        // suffix that real providers reject on the next request.
        db.transaction((tx) => {
          tx.insert(messages)
            .values([toolCallMessage, ...toolMessages].map(messageInsertValues))
            .run();
        });
      }

      // The assistant/tool_use turn must precede every tool_result in both
      // provider memory and persisted history.
      workingProviderMessages.push(messageToProvider(toolCallMessage));
      for (const toolMessage of toolMessages) {
        workingProviderMessages.push(messageToProvider(toolMessage));
        const resultPart = toolMessage.parts?.find(
          (part): part is ToolResultPart => part.type === "tool_result",
        );
        if (!resultPart) continue;
        sendSse(stream, {
          type: "tool_result",
          toolCallId: resultPart.toolCallId,
          agentId,
          content: resultPart.content,
          isError: resultPart.isError,
        });
      }
      toolRounds += 1;
      continue;
    }

    if (!roundText && !roundReasoning) {
      throw new Error("Provider returned an empty response");
    }
    const finalParts: ContentPart[] = [
      ...(roundReasoning ? [{ type: "reasoning", text: roundReasoning } as ContentPart] : []),
      ...(roundText ? [{ type: "text", text: roundText } as ContentPart] : []),
    ];
    const finalMessage: ChatMessage = {
      id: nanoid(),
      conversationId,
      role: "assistant",
      content: roundText,
      parts: finalParts.length ? finalParts : null,
      toolCallIds: null,
      // Each persisted assistant row owns only its provider request's usage.
      // The SSE usage event below reports the aggregate across tool rounds.
      promptTokens: roundPromptTokens,
      completionTokens: roundCompletionTokens,
      createdAt: nextCreatedAt(),
    };
    if (isFinal) {
      await insertMessage(finalMessage);
      await db
        .update(conversations)
        .set({ updatedAt: Date.now() })
        .where(eq(conversations.id, conversationId));
      sendSse(stream, { type: "usage", promptTokens, completionTokens });
      sendSse(stream, { type: "message", message: finalMessage });
    }
    workingProviderMessages.push(messageToProvider(finalMessage));
    sendSse(stream, { type: "agent_finished", agentId, label });
    return {
      content: roundText,
      message: finalMessage,
      usage: { p: promptTokens, c: completionTokens },
    };
  }
}

export async function chatRoutes(app: FastifyInstance) {
  app.post<{ Body: { requestId?: string } }>("/api/chat/cancel", async (req, reply) => {
    const requestId = req.body?.requestId;
    if (typeof requestId !== "string" || !requestId.trim() || requestId.length > 128) {
      return reply.code(400).send({ error: "valid requestId required" });
    }
    pruneCancelledChatRequests();
    const active = chatRequestControllers.get(requestId);
    if (active) active.abort();
    else cancelledChatRequestIds.set(requestId, Date.now());
    return { ok: true, active: Boolean(active) };
  });

  app.post<{ Body: ChatRequest }>("/api/chat", async (req, reply) => {
    const body = req.body;
    if (!body?.conversationId) {
      return reply.code(400).send({ error: "conversationId required" });
    }
    const editing = typeof body.editMessageId === "string" || body.editLastUser === true;
    if (body.regenerate && editing) {
      return reply.code(400).send({ error: "regenerate cannot be combined with edit" });
    }
    if (
      body.editMessageId !== undefined &&
      (typeof body.editMessageId !== "string" || !body.editMessageId.trim())
    ) {
      return reply.code(400).send({ error: "editMessageId must not be empty" });
    }
    if (
      body.requestId !== undefined &&
      (typeof body.requestId !== "string" || !body.requestId.trim() || body.requestId.length > 128)
    ) {
      return reply.code(400).send({ error: "requestId must be a non-empty string" });
    }

    // Preserve normal HTTP validation errors before committing the response
    // to SSE. The same state is checked again after the lock because another
    // queued turn may change it in between.
    const [preflightConversation] = await db
      .select({ id: conversations.id })
      .from(conversations)
      .where(eq(conversations.id, body.conversationId));
    if (!preflightConversation) {
      return reply.code(404).send({ error: "Conversation not found" });
    }
    if (editing || body.regenerate) {
      const preflightMessages = await db
        .select({ id: messages.id, role: messages.role })
        .from(messages)
        .where(eq(messages.conversationId, body.conversationId))
        .orderBy(asc(messages.createdAt));
      if (editing) {
        const editable = typeof body.editMessageId === "string"
          ? preflightMessages.some(
            (message) => message.id === body.editMessageId && message.role === "user",
          )
          : preflightMessages.some((message) => message.role === "user");
        if (!editable) {
          return reply.code(404).send({ error: "Editable user message not found" });
        }
      } else if (!preflightMessages.some((message) => message.role === "user")) {
        return reply.code(400).send({ error: "Cannot regenerate without a user message" });
      }
    }

    // Install disconnect listeners before waiting for the per-conversation
    // lock. Otherwise a queued request can be cancelled by the client, miss
    // the event entirely, and still mutate history once it reaches the front.
    const ac = new AbortController();
    const requestId = typeof body.requestId === "string" ? body.requestId : null;
    if (requestId) {
      pruneCancelledChatRequests();
      chatRequestControllers.get(requestId)?.abort();
      chatRequestControllers.set(requestId, ac);
      if (cancelledChatRequestIds.delete(requestId)) ac.abort();
    }
    const abort = () => ac.abort();
    const abortOnClose = () => {
      if (!reply.raw.writableEnded) ac.abort();
    };
    req.raw.once("aborted", abort);
    reply.raw.once("close", abortOnClose);

    // Commit and flush the SSE response before joining the lock queue. A
    // browser can then cancel the queued response stream, which gives the
    // server an observable close event before any history is mutated.
    const stream = sseReply(reply);
    stream.write(": queued\n\n");
    const releaseLock = await acquireConversationLock(body.conversationId);
    let streamOwnsLock = false;
    let rollbackMutation: (() => Promise<void>) | null = null;
    try {
      // IncomingMessage.destroyed becomes true after Fastify consumes a
      // perfectly healthy JSON body, so it is not a disconnect signal here.
      if (ac.signal.aborted || req.raw.aborted || reply.raw.destroyed) {
        if (!stream.writableEnded) stream.end();
        return reply;
      }
      const [conv] = await db
        .select()
        .from(conversations)
        .where(eq(conversations.id, body.conversationId));
      if (!conv) {
        sendSse(stream, { type: "error", message: "Conversation not found" });
        stream.end();
        return reply;
      }

      const existing = await db
        .select()
        .from(messages)
        .where(eq(messages.conversationId, conv.id))
        .orderBy(asc(messages.createdAt));
      let working: ChatMessage[] = existing.map(rowToMessage);
      let lastCreatedAt = working.reduce((max, message) => Math.max(max, message.createdAt), Date.now());
      const nextCreatedAt = () => {
        lastCreatedAt = Math.max(Date.now(), lastCreatedAt + 1);
        return lastCreatedAt;
      };

      if (editing) {
        const targetIndex = typeof body.editMessageId === "string"
          ? working.findIndex((message) => message.id === body.editMessageId && message.role === "user")
          : working.map((message) => message.role).lastIndexOf("user");
        if (targetIndex < 0) {
          sendSse(stream, { type: "error", message: "Editable user message not found" });
          stream.end();
          return reply;
        }
        const target = working[targetIndex];
        const originalTail = existing.slice(targetIndex);
        rollbackMutation = () => restoreMessageTail({
          conversationId: conv.id,
          anchorId: target.id,
          includeAnchor: true,
          originalRows: originalTail,
          conversation: { title: conv.title, updatedAt: conv.updatedAt },
        });
        const truncatedIds = working.slice(targetIndex + 1).map((message) => message.id);
        const nextContent = body.content ?? target.content;
        const nextParts = body.parts !== undefined ? body.parts : target.parts ?? null;
        db.transaction((tx) => {
          if (truncatedIds.length) {
            tx.delete(messages).where(inArray(messages.id, truncatedIds)).run();
          }
          tx.update(messages)
            .set({
              content: nextContent,
              parts: nextParts?.length ? JSON.stringify(nextParts) : null,
            })
            .where(and(eq(messages.id, target.id), eq(messages.conversationId, conv.id)))
            .run();
        });
        working = [
          ...working.slice(0, targetIndex),
          { ...target, content: nextContent, parts: nextParts },
        ];
      } else if (body.regenerate) {
        const lastUserIndex = working.map((message) => message.role).lastIndexOf("user");
        if (lastUserIndex < 0) {
          sendSse(stream, { type: "error", message: "Cannot regenerate without a user message" });
          stream.end();
          return reply;
        }
        const anchor = working[lastUserIndex];
        const originalSuffix = existing.slice(lastUserIndex + 1);
        rollbackMutation = () => restoreMessageTail({
          conversationId: conv.id,
          anchorId: anchor.id,
          includeAnchor: false,
          originalRows: originalSuffix,
          conversation: { title: conv.title, updatedAt: conv.updatedAt },
        });
        const truncatedIds = working.slice(lastUserIndex + 1).map((message) => message.id);
        if (truncatedIds.length) {
          await db.delete(messages).where(inArray(messages.id, truncatedIds));
        }
        working = working.slice(0, lastUserIndex + 1);
      } else {
        const userMessage: ChatMessage = {
          id: nanoid(),
          conversationId: conv.id,
          role: "user",
          content: body.content ?? "",
          parts: body.parts ?? null,
          toolCallIds: null,
          promptTokens: null,
          completionTokens: null,
          createdAt: nextCreatedAt(),
        };
        await insertMessage(userMessage);
        working.push(userMessage);
      }

      const conversationPatch: { updatedAt: number; title?: string } = { updatedAt: Date.now() };
      if (conv.title === "New Chat") {
        const firstUser = working.find((message) => message.role === "user");
        if (firstUser) conversationPatch.title = firstUser.content.slice(0, 40) || "New Chat";
      }
      await db
        .update(conversations)
        .set(conversationPatch)
        .where(eq(conversations.id, conv.id));

      const agent = conv.agentId ? getAgent(conv.agentId) ?? null : null;
      const useTools = body.useTools === true;
      const providerId = agent?.provider ?? conv.provider;
      const model = agent?.model ?? conv.model;
      const systemPrompt = withSkills(agent?.systemPrompt ?? conv.systemPrompt ?? undefined);
      const temperature = agent?.temperature ?? conv.temperature ?? 0.7;
      const allowedEfforts = ["low", "medium", "high", "xhigh"] as const;
      type Effort = (typeof allowedEfforts)[number];
      const resolveEffort = (value: unknown): Effort | undefined =>
        typeof value === "string" && (allowedEfforts as readonly string[]).includes(value)
          ? (value as Effort)
          : undefined;
      const reasoningEffort =
        resolveEffort(body.reasoningEffort) ??
        resolveEffort(agent?.reasoningEffort) ??
        resolveEffort(conv.reasoningEffort);
      const showThinking = body.showThinking ?? agent?.showThinking ?? conv.showThinking ?? true;

      streamOwnsLock = true;

      void (async () => {
        try {
          const baseProviderMessages = providerHistoryFromMessages(working);
          const chain: Array<{ agent: AgentProfile | null; id: string; label: string }> = [{
            agent,
            id: agent?.id ?? "default",
            label: agent?.label ?? providerId,
          }];
          let cursor: AgentProfile | null = agent;
          const seen = new Set<string>(agent ? [agent.id] : []);
          while (cursor && Array.isArray(cursor.chain) && cursor.chain.length) {
            const nextId = cursor.chain[0];
            if (seen.has(nextId)) break;
            seen.add(nextId);
            const next = getAgent(nextId);
            if (!next) break;
            chain.push({ agent: next, id: next.id, label: next.label });
            cursor = next;
          }

          let previousAgentOutput: string | undefined;
          for (let index = 0; index < chain.length; index += 1) {
            const link = chain[index];
            const isFinal = index === chain.length - 1;
            const linkProvider = link.agent?.provider ?? providerId;
            const linkModel = link.agent?.model ?? model;
            const linkSystem = link.agent?.systemPrompt ? withSkills(link.agent.systemPrompt) : systemPrompt;
            const linkTemperature = link.agent?.temperature ?? temperature;
            const linkTools = pickTools({ agent: link.agent, useTools, providerId: linkProvider });
            const linkSetting = getProviderSetting(linkProvider);
            const linkProviderMessages = baseProviderMessages.slice();
            if (previousAgentOutput !== undefined) {
              linkProviderMessages.push({
                role: "user",
                content: `[Previous agent (${chain[index - 1].label}) said]\n${previousAgentOutput}`,
              });
            }
            const result = await runAgentTurn({
              conversationId: conv.id,
              tools: linkTools,
              workingProviderMessages: linkProviderMessages,
              agentId: link.id,
              label: link.label,
              stream,
              signal: ac.signal,
              setting: { apiKey: linkSetting.apiKey ?? null, baseUrl: linkSetting.baseUrl },
              providerId: linkProvider,
              model: linkModel,
              systemPrompt: linkSystem,
              temperature: linkTemperature,
              reasoningEffort: resolveEffort(link.agent?.reasoningEffort) ?? reasoningEffort,
              showThinking: body.showThinking ?? link.agent?.showThinking ?? showThinking,
              isFinal,
              nextCreatedAt,
            });
            previousAgentOutput = result.content;
          }
          rollbackMutation = null;
          sendSse(stream, { type: "done" });
          stream.end();
        } catch (error: any) {
          if (rollbackMutation) {
            const rollback = rollbackMutation;
            rollbackMutation = null;
            try {
              await rollback();
            } catch (rollbackError) {
              req.log.error({ err: rollbackError }, "failed to restore chat history after generation error");
            }
          }
          const message = error?.name === "AbortError" ? "aborted" : error?.message ?? "Upstream error";
          try {
            sendSse(stream, { type: "error", message });
            stream.end();
          } catch {}
        } finally {
          req.raw.removeListener("aborted", abort);
          reply.raw.removeListener("close", abortOnClose);
          unregisterChatRequest(requestId, ac);
          releaseLock();
        }
      })();

      return reply;
    } catch (error: any) {
      if (rollbackMutation) {
        const rollback = rollbackMutation;
        rollbackMutation = null;
        try {
          await rollback();
        } catch (rollbackError) {
          req.log.error({ err: rollbackError }, "failed to restore chat history after preparation error");
        }
      }
      const message = error?.name === "AbortError"
        ? "aborted"
        : error?.message ?? "Failed to prepare chat request";
      try {
        if (!stream.writableEnded) {
          sendSse(stream, { type: "error", message });
          stream.end();
        }
      } catch {}
      return reply;
    } finally {
      if (!streamOwnsLock) {
        req.raw.removeListener("aborted", abort);
        reply.raw.removeListener("close", abortOnClose);
        unregisterChatRequest(requestId, ac);
        if (!stream.writableEnded) stream.end();
        releaseLock();
      }
    }
  });
}
