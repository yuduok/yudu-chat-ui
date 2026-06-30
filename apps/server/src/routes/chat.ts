import type { FastifyInstance } from "fastify";
import { eq, asc } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "../db/index.js";
import { conversations, messages } from "../db/schema.js";
import { getProvider } from "../providers/registry.js";
import { getProviderSetting } from "./settings.js";
import { getAgent, listAgents } from "../agents/index.js";
import { listTools, runTool } from "../tools/index.js";
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

function serializeArgs(args: Record<string, unknown> | string): string {
  if (typeof args === "string") return args;
  return JSON.stringify(args);
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
    // Open the entire registry when useTools is on.
    for (const t of listTools()) wantNames.add(t.name);
  }
  if (opts.providerId === "mock") wantNames.add("get_weather");
  if (wantNames.size === 0) return [];
  return listTools().filter((t) => wantNames.has(t.name));
}

async function persistAssistant(
  conv: { id: string },
  assistantMsg: ChatMessage,
  content: string,
  toolCallIds: string[],
  promptTokens: number,
  completionTokens: number,
  agentId: string,
  label: string,
  stream: NodeJS.WritableStream,
) {
  // Persist the assistant message (this happens once per "real" turn).
  // We update the row in place; the row was inserted as a placeholder
  // by the caller.
  await db
    .update(messages)
    .set({
      content,
      toolCallIds: toolCallIds.length ? JSON.stringify(toolCallIds) : null,
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
      content,
      toolCallIds: toolCallIds.length ? toolCallIds : null,
      promptTokens,
      completionTokens,
    },
  });
  sendSse(stream, { type: "agent_finished", agentId, label });
  sendSse(stream, { type: "done" });
}

async function runAgentTurn(opts: {
  // Static context
  convRow: typeof conversations.$inferSelect;
  agent: AgentProfile | null;
  tools: ToolDefinition[];
  // Mutable working state
  workingHistory: ChatMessage[];
  workingProviderMessages: ProviderMessage[];
  // The "current" placeholder assistant message that the stream will mutate.
  assistantMsg: ChatMessage;
  // The "label" / "agentId" that the UI shows for attribution.
  agentId: string;
  label: string;
  // Stream handles
  stream: NodeJS.WritableStream;
  // Abort signal wired to the client connection.
  signal: AbortSignal;
  // The setting object (api key, base url) for the provider actually
  // being used for this turn (may be overridden by the agent).
  setting: { apiKey: string | null | undefined; baseUrl?: string | undefined };
  // The provider to use for this turn.
  providerId: string;
  model: string;
  systemPrompt: string | null | undefined;
  temperature: number;
  // Reasoning controls forwarded to the provider. `showThinking` only
  // gates the SSE channel; the server still collects + persists reasoning
  // deltas so toggling the UI later doesn't lose history.
  reasoningEffort?: "low" | "medium" | "high" | "xhigh";
  showThinking?: boolean;
  // When true, this is the last agent in a chain — its text response
  // becomes the user-visible assistant message and is committed to the
  // conversation.
  isFinal: boolean;
}): Promise<{ content: string; toolCallIds: string[]; usage: { p: number; c: number } }> {
  const {
    agent,
    tools,
    workingHistory,
    workingProviderMessages,
    assistantMsg,
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
  } = opts;

  const provider = getProvider(providerId);
  if (!provider) {
    throw new Error(`Unknown provider: ${providerId}`);
  }
  if (!setting.apiKey && provider.id !== "mock") {
    throw new Error(`No API key configured for provider "${provider.id}".`);
  }

  sendSse(stream, { type: "agent_started", agentId, label });

  let acc = "";
  let accReasoning = "";
  let promptTokens = 0;
  let completionTokens = 0;
  const collectedToolCalls: Array<{ id: string; name: string; arguments: Record<string, unknown> | string }> = [];

  // Loop: first iteration uses the prompt as-is, subsequent iterations
  // run any tool calls and re-feed the model with results.
  for (let round = 0; round < MAX_TOOL_ROUNDS + 1; round++) {
    for await (const chunk of provider.chat({
      model,
      systemPrompt: systemPrompt ?? undefined,
      temperature,
      messages: workingProviderMessages,
      signal,
      apiKey: setting.apiKey ?? "",
      baseUrl: setting.baseUrl,
      tools: tools.length ? tools : undefined,
      toolChoice: tools.length ? "auto" : undefined,
      reasoningEffort,
    })) {
      if (chunk.delta) {
        acc += chunk.delta;
        // Only the final agent's text deltas reach the user.
        if (isFinal) sendSse(stream, { type: "delta", text: chunk.delta });
      }
      if (chunk.usage) {
        promptTokens = chunk.usage.promptTokens;
        completionTokens = chunk.usage.completionTokens;
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
        accReasoning += chunk.reasoningDelta;
        // Gate only the SSE channel; we keep accumulating so the part can
        // be persisted on the assistant message.
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

    if (collectedToolCalls.length === 0) break;
    if (round >= MAX_TOOL_ROUNDS) {
      // Out of budget — append the tool calls and let the final agent
      // synthesise without further tool calls. We do this by zeroing out
      // the tool list and breaking out of the loop with the partial text.
      break;
    }

    // Build the assistant message parts (with tool_calls) and persist.
    const assistantParts: ContentPart[] = [
      ...(accReasoning
        ? [{ type: "reasoning", text: accReasoning } as ContentPart]
        : []),
      ...(acc ? [{ type: "text", text: acc } as ContentPart] : []),
      ...collectedToolCalls.map(
        (c): ToolCallPart => ({
          type: "tool_call",
          id: c.id,
          name: c.name,
          arguments: c.arguments,
        }),
      ),
    ];
    const toolCallIds = collectedToolCalls.map((c) => c.id);

    // Persist the assistant message and reflect it in the working history.
    if (isFinal) {
      // The user-visible assistant message keeps the text the model
      // emitted *before* the tool calls, plus the tool call chips.
      await db
        .update(messages)
        .set({
          content: acc,
          parts: JSON.stringify(assistantParts),
          toolCallIds: JSON.stringify(toolCallIds),
          promptTokens,
          completionTokens,
        })
        .where(eq(messages.id, assistantMsg.id));
      workingHistory.push({
        ...assistantMsg,
        content: acc,
        parts: assistantParts,
        toolCallIds,
        promptTokens,
        completionTokens,
      });
    } else {
      // Intermediate agent: don't surface this turn as a user-visible
      // message. We still need the provider history to see the calls.
      const synthetic: ChatMessage = {
        ...assistantMsg,
        content: acc,
        parts: assistantParts,
        toolCallIds,
        promptTokens,
        completionTokens,
      };
      workingHistory.push(synthetic);
    }

    // Run each tool call and feed the results back.
    for (const call of collectedToolCalls) {
      let result: { content: string; isError?: boolean };
      try {
        result = await runTool(call.name, parseArgs(call.arguments), { signal });
      } catch (err: any) {
        result = { content: err?.message ?? String(err), isError: true };
      }
      const resultPart: ToolResultPart = {
        type: "tool_result",
        toolCallId: call.id,
        content: result.content,
        isError: result.isError,
        agentId,
      };
      // Persist the tool result as a new message row.
      const toolMsg: ChatMessage = {
        id: nanoid(),
        conversationId: assistantMsg.conversationId,
        role: "tool",
        content: result.content,
        parts: [resultPart],
        createdAt: Date.now(),
      };
      if (isFinal) {
        await db.insert(messages).values({
          id: toolMsg.id,
          conversationId: toolMsg.conversationId,
          role: toolMsg.role,
          content: toolMsg.content,
          parts: JSON.stringify(toolMsg.parts),
          createdAt: toolMsg.createdAt,
        });
      }
      workingHistory.push(toolMsg);
      // Provider-side message: tool_result part + tool_use call.
      const providerMsg = messageToProvider(toolMsg);
      workingProviderMessages.push(providerMsg);

      sendSse(stream, {
        type: "tool_result",
        toolCallId: call.id,
        agentId,
        content: result.content,
        isError: result.isError,
      });
    }

    // Reset accumulators for the second iteration (model will see the
    // tool results and produce a final answer). We deliberately keep the
    // reasoning accumulator between rounds so the persisted part still
    // captures the model's full thinking session.
    acc = "";
    collectedToolCalls.length = 0;
  }

  // Persist the final assistant turn once the loop is done. Without this
  // a plain text-only reply (no tool calls) leaves the placeholder row
  // empty in the DB. Intermediate agents don't write to the user-visible
  // row; the final agent in the chain does.
  if (isFinal && (acc || accReasoning || promptTokens || completionTokens)) {
    const finalParts: ContentPart[] = [
      ...(accReasoning ? [{ type: "reasoning", text: accReasoning } as ContentPart] : []),
      ...(acc ? [{ type: "text", text: acc } as ContentPart] : []),
    ];
    await db
      .update(messages)
      .set({
        content: acc,
        parts: finalParts.length ? JSON.stringify(finalParts) : null,
        promptTokens,
        completionTokens,
      })
      .where(eq(messages.id, assistantMsg.id));
    sendSse(stream, { type: "usage", promptTokens, completionTokens });
    sendSse(stream, {
      type: "message",
      message: {
        ...assistantMsg,
        content: acc,
        parts: finalParts,
        promptTokens,
        completionTokens,
      },
    });
    sendSse(stream, { type: "agent_finished", agentId, label });
  }

  return {
    content: acc,
    toolCallIds: collectedToolCalls.map((c) => c.id),
    usage: { p: promptTokens, c: completionTokens },
  };
}

export async function chatRoutes(app: FastifyInstance) {
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

    const agent = conv.agentId ? getAgent(conv.agentId) ?? null : null;
    const useTools = body.useTools === true;

    const providerId = agent?.provider ?? conv.provider;
    const model = agent?.model ?? conv.model;
    const systemPrompt = agent?.systemPrompt ?? conv.systemPrompt ?? undefined;
    const temperature = agent?.temperature ?? conv.temperature ?? 0.7;
    // Reasoning effort: per-turn override > agent > conversation > null.
    const allowedEfforts = ["low", "medium", "high", "xhigh"] as const;
    type Effort = (typeof allowedEfforts)[number];
    const resolveEffort = (v: unknown): Effort | undefined =>
      typeof v === "string" && (allowedEfforts as readonly string[]).includes(v)
        ? (v as Effort)
        : undefined;
    const reasoningEffort =
      resolveEffort(body.reasoningEffort) ??
      resolveEffort(agent?.reasoningEffort) ??
      resolveEffort(conv.reasoningEffort);
    // showThinking: default true. The flag controls only the SSE channel;
    // reasoning deltas are still collected + persisted server-side so the
    // UI can flip the toggle without losing history.
    const showThinking =
      body.showThinking ?? agent?.showThinking ?? conv.showThinking ?? true;
    const tools = pickTools({ agent, useTools, providerId });
    const setting = getProviderSetting(providerId);

    // Load existing messages
    const existing = await db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, conv.id))
      .orderBy(asc(messages.createdAt));
    let working: ChatMessage[] = existing.map(rowToMessage);

    // Handle edit-last-user: update the last user message in place.
    while (working.length && working[working.length - 1].role === "assistant") {
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
      // nothing to do
    } else {
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
    const ac = new AbortController();
    req.raw.on("close", () => ac.abort());

    (async () => {
      try {
        // The placeholder assistant message is created once. If the agent
        // chain runs multiple agents, the *final* agent's text lands here.
        // Intermediate agents emit their text into the SSE stream but
        // don't write to this row.
        const assistantMsg: ChatMessage = {
          id: nanoid(),
          conversationId: conv.id,
          role: "assistant",
          content: "",
          parts: null,
          toolCallIds: null,
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
          toolCallIds: null,
          createdAt: assistantMsg.createdAt,
        });

        const baseWorking = working.slice();
        const baseProviderMessages: ProviderMessage[] = baseWorking
          .filter((m) => m.role !== "system")
          .map(messageToProvider);

        // ---- Build the agent chain ----
        const chain: Array<{ agent: AgentProfile | null; id: string; label: string }> = [];
        const startAgent = agent;
        chain.push({
          agent: startAgent,
          id: startAgent?.id ?? "default",
          label: startAgent?.label ?? providerId,
        });
        // Walk the chain. We treat a non-empty `chain` array as the
        // explicit handoff list. We also let a single agent without a
        // chain end the run.
        let cursor: AgentProfile | null = startAgent;
        const seen = new Set<string>();
        while (cursor && Array.isArray(cursor.chain) && cursor.chain.length) {
          const nextId = cursor.chain[0];
          if (seen.has(nextId)) break; // cycle guard
          seen.add(nextId);
          const next = getAgent(nextId);
          if (!next) break;
          chain.push({ agent: next, id: next.id, label: next.label });
          cursor = next;
        }
        const finalIndex = chain.length - 1;

        // ---- Run each agent in the chain ----
        for (let i = 0; i < chain.length; i++) {
          const link = chain[i];
          const isFinal = i === finalIndex;
          // Per-agent overrides
          const linkProvider = link.agent?.provider ?? providerId;
          const linkModel = link.agent?.model ?? model;
          const linkSystem = link.agent?.systemPrompt ?? systemPrompt ?? undefined;
          const linkTemp = link.agent?.temperature ?? temperature;
          // Tools: each agent re-filters via its own allowlist.
          const linkTools = pickTools({
            agent: link.agent,
            useTools,
            providerId: linkProvider,
          });
          const linkSetting = getProviderSetting(linkProvider);

          // Build a fresh provider history per agent so they don't see
          // each other's raw tool calls unless they're the same role.
          // For simplicity we share working history; provider-side message
          // translation keeps tool_call/tool_result consistent.
          const linkProviderMessages: ProviderMessage[] = i === 0
            ? baseProviderMessages.slice()
            : baseProviderMessages.concat(); // start over from base
          // The chain: each non-first agent re-receives the *user* request
          // plus the previous agent's final text as context. We add a
          // synthetic "user" message carrying the prior agent's output so
          // the next agent can react to it without seeing the raw tool
          // results.
          if (i > 0) {
            // Find the previous agent's last assistant text from working.
            const prevFinal = working
              .slice()
              .reverse()
              .find((m) => m.role === "assistant");
            if (prevFinal) {
              linkProviderMessages.push({
                role: "user",
                content: `[Previous agent (${chain[i - 1].label}) said]\n${prevFinal.content}`,
              });
            }
          }

          await runAgentTurn({
            convRow: conv,
            agent: link.agent,
            tools: linkTools,
            workingHistory: working,
            workingProviderMessages: linkProviderMessages,
            assistantMsg,
            agentId: link.id,
            label: link.label,
            stream,
            signal: ac.signal,
            setting: { apiKey: linkSetting.apiKey ?? null, baseUrl: linkSetting.baseUrl },
            providerId: linkProvider,
            model: linkModel,
            systemPrompt: linkSystem,
            temperature: linkTemp,
            reasoningEffort,
            showThinking,
            isFinal,
          });
        }

        // Final: the placeholder message row already has the final agent's
        // text from the isFinal branch. We just emit done.
        // (runAgentTurn already emitted "done" inside its final pass; this
        // is a safety net if no agent ran.)
        try { stream.end(); } catch {}
      } catch (err: any) {
        if (err?.name === "AbortError") {
          try { sendSse(stream, { type: "error", message: "aborted" }); stream.end(); } catch {}
          return;
        }
        try {
          sendSse(stream, { type: "error", message: err?.message ?? "Upstream error" });
          stream.end();
        } catch {}
      }
    })();

    return reply;
  });
}
