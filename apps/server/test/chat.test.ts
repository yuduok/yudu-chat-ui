import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import Fastify from "fastify";
import sensible from "@fastify/sensible";
import { eq } from "drizzle-orm";

test("chat history mutations and tool turns stay consistent", { timeout: 30_000 }, async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "yudu-chat-routes-"));
  const previousDataDir = process.env.YUDU_DATA_DIR;
  process.env.YUDU_DATA_DIR = dataDir;

  const [
    { conversationRoutes },
    { chatRoutes },
    { registerBuiltinTools },
    { clearTools, registerTool },
    { getProvider },
    { loadAgents },
    { db },
    { messages: messageTable },
  ] = await Promise.all([
    import("../src/routes/conversations.js"),
    import("../src/routes/chat.js"),
    import("../src/tools/builtin.js"),
    import("../src/tools/index.js"),
    import("../src/providers/registry.js"),
    import("../src/agents/index.js"),
    import("../src/db/index.js"),
    import("../src/db/schema.js"),
  ]);

  clearTools();
  registerBuiltinTools();
  registerTool(
    {
      name: "abort_first",
      description: "Abort the current integration-test client",
      parameters: { type: "object", properties: {} },
    },
    async (_args, ctx) => {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, 1_000);
        const onAbort = () => {
          clearTimeout(timer);
          const error = new Error("aborted");
          error.name = "AbortError";
          reject(error);
        };
        if (ctx.signal?.aborted) onAbort();
        else {
          ctx.signal?.addEventListener("abort", onAbort, { once: true });
        }
      });
      return { content: "first-result" };
    },
  );
  registerTool(
    {
      name: "abort_second",
      description: "Second integration-test tool",
      parameters: { type: "object", properties: {} },
    },
    async () => ({ content: "second-result" }),
  );
  await loadAgents();
  const mock = getProvider("mock");
  assert.ok(mock);
  const originalChat = mock.chat;
  let responseNumber = 0;
  let failNextProviderCall = false;
  const providerCalls: Array<{ messages: any[] }> = [];
  let heldProviderGate: Promise<void> | null = null;
  let notifyProviderHeld: (() => void) | null = null;

  mock.chat = async function* (input) {
    providerCalls.push({ messages: JSON.parse(JSON.stringify(input.messages)) });
    if (failNextProviderCall) {
      failNextProviderCall = false;
      throw new Error("synthetic one-shot provider failure");
    }
    const lastUser = [...input.messages].reverse().find((message) => message.role === "user");
    const userText = lastUser?.content ?? "";
    if (userText === "__error__") throw new Error("synthetic provider failure");
    if (userText === "__slow__") await new Promise((resolve) => setTimeout(resolve, 30));
    if (userText === "__hold_lock__") {
      notifyProviderHeld?.();
      if (heldProviderGate) await heldProviderGate;
    }
    if (userText === "__graceful_abort__") {
      yield { reasoningDelta: "partial-reasoning" };
      if (!input.signal?.aborted) {
        await new Promise<void>((resolve) => {
          input.signal?.addEventListener("abort", () => resolve(), { once: true });
        });
      }
      return;
    }

    const lastUserIndex = input.messages.map((message) => message.role).lastIndexOf("user");
    const toolResult = input.messages
      .slice(lastUserIndex + 1)
      .reverse()
      .find((message) => message.role === "tool");
    if (toolResult) {
      const text = `tool-final:${toolResult.content}`;
      yield { delta: text };
      yield { usage: { promptTokens: 11, completionTokens: text.length } };
      return;
    }
    if (userText === "__multi_tool_abort__") {
      yield {
        toolCall: { id: "abort-call-1", name: "abort_first", arguments: {} },
      };
      yield {
        toolCall: { id: "abort-call-2", name: "abort_second", arguments: {} },
      };
      return;
    }
    if (/weather/i.test(userText) && input.tools?.some((tool) => tool.name === "get_weather")) {
      yield {
        toolCall: {
          id: "weather-call-1",
          name: "get_weather",
          arguments: { city: "Shanghai" },
        },
      };
      yield { usage: { promptTokens: 7, completionTokens: 1 } };
      return;
    }

    responseNumber += 1;
    const text = `reply-${responseNumber}:${userText}`;
    yield { delta: text };
    yield { usage: { promptTokens: userText.length, completionTokens: text.length } };
  };

  const app = Fastify();
  await app.register(sensible);
  await app.register(conversationRoutes);
  await app.register(chatRoutes);
  const origin = await app.listen({ host: "127.0.0.1", port: 0 });

  t.after(async () => {
    mock.chat = originalChat;
    clearTools();
    await app.close();
    if (previousDataDir === undefined) delete process.env.YUDU_DATA_DIR;
    else process.env.YUDU_DATA_DIR = previousDataDir;
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  async function createConversation(): Promise<string> {
    const response = await app.inject({
      method: "POST",
      url: "/api/conversations",
      payload: { provider: "mock", model: "mock-1" },
    });
    assert.equal(response.statusCode, 200);
    return response.json().id as string;
  }

  async function sendChat(conversationId: string, payload: Record<string, unknown>): Promise<string> {
    const response = await app.inject({
      method: "POST",
      url: "/api/chat",
      payload: { conversationId, ...payload },
    });
    assert.equal(response.statusCode, 200);
    return response.payload;
  }

  async function getConversation(conversationId: string): Promise<any> {
    const response = await app.inject({
      method: "GET",
      url: `/api/conversations/${conversationId}`,
    });
    assert.equal(response.statusCode, 200);
    return response.json();
  }

  await t.test("ordinary second turns preserve the first assistant response", async () => {
    const conversationId = await createConversation();
    await sendChat(conversationId, { content: "first" });
    await sendChat(conversationId, { content: "second" });
    const conversation = await getConversation(conversationId);
    assert.deepEqual(conversation.messages.map((message: any) => message.role), [
      "user",
      "assistant",
      "user",
      "assistant",
    ]);
    assert.match(conversation.messages[1].content, /first/);
    assert.match(conversation.messages[3].content, /second/);
  });

  await t.test("regenerate replaces only the last user turn's assistant/tool suffix", async () => {
    const conversationId = await createConversation();
    await sendChat(conversationId, { content: "first" });
    await sendChat(conversationId, { content: "second" });
    const before = await getConversation(conversationId);
    await sendChat(conversationId, { regenerate: true });
    const after = await getConversation(conversationId);

    assert.deepEqual(after.messages.map((message: any) => message.role), [
      "user",
      "assistant",
      "user",
      "assistant",
    ]);
    assert.equal(after.messages[0].id, before.messages[0].id);
    assert.equal(after.messages[1].id, before.messages[1].id);
    assert.equal(after.messages[2].id, before.messages[2].id);
    assert.notEqual(after.messages[3].id, before.messages[3].id);
    assert.match(after.messages[3].content, /second/);
  });

  await t.test("failed regenerate restores the previous assistant suffix", async () => {
    const conversationId = await createConversation();
    await sendChat(conversationId, { content: "keep this answer" });
    const before = await getConversation(conversationId);
    failNextProviderCall = true;
    const stream = await sendChat(conversationId, { regenerate: true });
    assert.match(stream, /synthetic one-shot provider failure/);
    const after = await getConversation(conversationId);
    assert.deepEqual(after.messages, before.messages);
    assert.equal(after.updatedAt, before.updatedAt);
  });

  await t.test("editMessageId updates that user row and truncates all later history", async () => {
    const conversationId = await createConversation();
    await sendChat(conversationId, { content: "first" });
    await sendChat(conversationId, { content: "second" });
    const before = await getConversation(conversationId);
    const targetId = before.messages[0].id as string;

    await sendChat(conversationId, { editMessageId: targetId, content: "edited-first" });
    const after = await getConversation(conversationId);
    assert.deepEqual(after.messages.map((message: any) => message.role), ["user", "assistant"]);
    assert.equal(after.messages[0].id, targetId);
    assert.equal(after.messages[0].content, "edited-first");
    assert.match(after.messages[1].content, /edited-first/);
  });

  await t.test("failed edit restores the original user message and later branch", async () => {
    const conversationId = await createConversation();
    await sendChat(conversationId, { content: "original first" });
    await sendChat(conversationId, { content: "original second" });
    const before = await getConversation(conversationId);
    failNextProviderCall = true;
    const stream = await sendChat(conversationId, {
      editMessageId: before.messages[0].id,
      content: "failed replacement",
    });
    assert.match(stream, /synthetic one-shot provider failure/);
    const after = await getConversation(conversationId);
    assert.deepEqual(after.messages, before.messages);
    assert.equal(after.updatedAt, before.updatedAt);
  });

  await t.test("editLastUser remains a compatible shorthand", async () => {
    const conversationId = await createConversation();
    await sendChat(conversationId, { content: "first" });
    await sendChat(conversationId, { content: "second" });
    const before = await getConversation(conversationId);

    await sendChat(conversationId, { editLastUser: true, content: "revised-second" });
    const after = await getConversation(conversationId);
    assert.deepEqual(after.messages.map((message: any) => message.role), [
      "user",
      "assistant",
      "user",
      "assistant",
    ]);
    assert.equal(after.messages[0].id, before.messages[0].id);
    assert.equal(after.messages[1].id, before.messages[1].id);
    assert.equal(after.messages[2].id, before.messages[2].id);
    assert.equal(after.messages[2].content, "revised-second");
  });

  await t.test("tool calls are persisted and replayed in provider-valid order", async () => {
    providerCalls.length = 0;
    const conversationId = await createConversation();
    await sendChat(conversationId, { content: "weather", useTools: true });
    const conversation = await getConversation(conversationId);

    assert.deepEqual(conversation.messages.map((message: any) => message.role), [
      "user",
      "assistant",
      "tool",
      "assistant",
    ]);
    const [, toolCallMessage, toolResultMessage, finalMessage] = conversation.messages;
    assert.deepEqual(toolCallMessage.toolCallIds, ["weather-call-1"]);
    assert.equal(toolCallMessage.parts.some((part: any) => part.type === "tool_call"), true);
    assert.equal(toolResultMessage.parts[0].toolCallId, "weather-call-1");
    assert.equal(finalMessage.toolCallIds, null);
    assert.equal(finalMessage.parts.some((part: any) => part.type === "tool_call"), false);
    assert.equal(finalMessage.promptTokens, 11);
    assert.equal(
      conversation.messages
        .filter((message: any) => message.role === "assistant")
        .reduce((total: number, message: any) => total + (message.promptTokens ?? 0), 0),
      18,
    );

    assert.equal(providerCalls.length, 2);
    assert.deepEqual(providerCalls[1].messages.map((message) => message.role), [
      "user",
      "assistant",
      "tool",
    ]);
    assert.equal(
      providerCalls[1].messages[1].parts.some((part: any) => part.type === "tool_use"),
      true,
    );
  });

  await t.test("aborting between multiple tools leaves no dangling tool protocol rows", async () => {
    const conversationId = await createConversation();
    const controller = new AbortController();
    const response = await fetch(`${origin}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        conversationId,
        content: "__multi_tool_abort__",
        useTools: true,
      }),
      signal: controller.signal,
    });
    assert.ok(response.body);
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let streamed = "";
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        streamed += decoder.decode(value, { stream: true });
        if (streamed.includes('"id":"abort-call-2"')) {
          controller.abort();
          break;
        }
      }
    } catch (error: any) {
      assert.equal(error?.name, "AbortError");
    } finally {
      reader.releaseLock();
    }

    // A follow-up also waits for the aborted request to release its lock.
    await sendChat(conversationId, { content: "after tool abort" });
    const conversation = await getConversation(conversationId);
    assert.deepEqual(conversation.messages.map((message: any) => message.role), [
      "user",
      "user",
      "assistant",
    ]);
    assert.equal(
      conversation.messages.some((message: any) =>
        message.role === "tool" || message.parts?.some((part: any) => part.type === "tool_call"),
      ),
      false,
    );
  });

  await t.test("a provider that returns cleanly on abort cannot persist a partial assistant", async () => {
    const conversationId = await createConversation();
    const requestId = "graceful-provider-abort";
    const response = await fetch(`${origin}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ conversationId, requestId, content: "__graceful_abort__" }),
    });
    assert.ok(response.body);
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let streamed = "";
    while (!streamed.includes("partial-reasoning")) {
      const { value, done } = await reader.read();
      assert.equal(done, false);
      streamed += decoder.decode(value, { stream: true });
    }
    const cancelResponse = await fetch(`${origin}/api/chat/cancel`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ requestId }),
    });
    assert.equal(cancelResponse.status, 200);
    while (!(await reader.read()).done) {
      // Drain the terminal SSE error frame.
    }
    reader.releaseLock();

    await sendChat(conversationId, { content: "after graceful abort" });
    const conversation = await getConversation(conversationId);
    assert.deepEqual(conversation.messages.map((message: any) => message.role), [
      "user",
      "user",
      "assistant",
    ]);
    assert.equal(
      conversation.messages.some((message: any) => message.content === "partial-reasoning"),
      false,
    );
  });

  await t.test("provider failures do not leave an empty assistant placeholder", async () => {
    const conversationId = await createConversation();
    const stream = await sendChat(conversationId, { content: "__error__" });
    assert.match(stream, /synthetic provider failure/);
    const conversation = await getConversation(conversationId);
    assert.deepEqual(conversation.messages.map((message: any) => message.role), ["user"]);
  });

  await t.test("overlapping turns are serialized per conversation", async () => {
    const conversationId = await createConversation();
    const first = sendChat(conversationId, { content: "__slow__" });
    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = sendChat(conversationId, { content: "after-slow" });
    await Promise.all([first, second]);
    const conversation = await getConversation(conversationId);
    assert.deepEqual(conversation.messages.map((message: any) => message.role), [
      "user",
      "assistant",
      "user",
      "assistant",
    ]);
  });

  await t.test("a queued request cancelled by its client never mutates history", async () => {
    const conversationId = await createConversation();
    let releaseHeldProvider!: () => void;
    heldProviderGate = new Promise<void>((resolve) => { releaseHeldProvider = resolve; });
    let markProviderHeld!: () => void;
    const providerHeld = new Promise<void>((resolve) => { markProviderHeld = resolve; });
    notifyProviderHeld = markProviderHeld;

    const firstRequest = fetch(`${origin}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ conversationId, content: "__hold_lock__" }),
    }).then((response) => response.text());
    await providerHeld;

    const queuedController = new AbortController();
    const queuedResponse = await fetch(`${origin}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        conversationId,
        requestId: "queued-cancel-request",
        content: "must-not-persist",
      }),
      signal: queuedController.signal,
    });
    assert.ok(queuedResponse.body);
    const queuedReader = queuedResponse.body.getReader();
    const queuedFrame = await queuedReader.read();
    assert.match(new TextDecoder().decode(queuedFrame.value), /queued/);
    const cancelResponse = await fetch(`${origin}/api/chat/cancel`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ requestId: "queued-cancel-request" }),
    });
    assert.equal(cancelResponse.status, 200);
    queuedController.abort();
    await assert.rejects(queuedReader.read(), (error: any) => error?.name === "AbortError");
    queuedReader.releaseLock();
    releaseHeldProvider();
    await firstRequest;
    heldProviderGate = null;
    notifyProviderHeld = null;

    // Queue one more turn so the server must first dispose of the cancelled
    // waiter. Its text must never appear in the canonical history.
    await sendChat(conversationId, { content: "after queued abort" });
    const conversation = await getConversation(conversationId);
    assert.deepEqual(conversation.messages.map((message: any) => message.role), [
      "user",
      "assistant",
      "user",
      "assistant",
    ]);
    assert.equal(
      conversation.messages.some((message: any) => message.content.includes("must-not-persist")),
      false,
    );
  });

  await t.test("deleting any tool-group member removes the whole protocol group", async () => {
    for (const targetRole of ["assistant", "tool"] as const) {
      const conversationId = await createConversation();
      await sendChat(conversationId, { content: "weather", useTools: true });
      const before = await getConversation(conversationId);
      const toolAssistant = before.messages.find(
        (message: any) => message.role === "assistant" && message.toolCallIds?.length,
      );
      const toolResult = before.messages.find((message: any) => message.role === "tool");
      const target = targetRole === "assistant" ? toolAssistant : toolResult;
      assert.ok(target);

      const response = await app.inject({
        method: "DELETE",
        url: `/api/conversations/${conversationId}/messages/${target.id}`,
      });
      assert.equal(response.statusCode, 200);
      const deletedIds = new Set(response.json().deletedIds as string[]);
      assert.equal(deletedIds.has(toolAssistant.id), true);
      assert.equal(deletedIds.has(toolResult.id), true);

      const after = await getConversation(conversationId);
      assert.deepEqual(after.messages.map((message: any) => message.role), ["user", "assistant"]);
      assert.equal(
        after.messages.some((message: any) =>
          message.role === "tool" || message.toolCallIds?.length,
        ),
        false,
      );
      await sendChat(conversationId, { content: `after deleting ${targetRole}` });
    }
  });

  await t.test("tool-group deletion uses adjacency even when providers reuse call ids", async () => {
    const conversationId = await createConversation();
    await sendChat(conversationId, { content: "weather first", useTools: true });
    await sendChat(conversationId, { content: "weather second", useTools: true });
    const before = await getConversation(conversationId);
    const toolResults = before.messages.filter((message: any) => message.role === "tool");
    const toolAssistants = before.messages.filter(
      (message: any) => message.role === "assistant" && message.toolCallIds?.length,
    );
    assert.equal(toolResults.length, 2);
    assert.equal(toolAssistants.length, 2);
    assert.equal(toolResults[0].parts[0].toolCallId, toolResults[1].parts[0].toolCallId);

    const response = await app.inject({
      method: "DELETE",
      url: `/api/conversations/${conversationId}/messages/${toolResults[1].id}`,
    });
    assert.equal(response.statusCode, 200);
    const deletedIds = new Set(response.json().deletedIds as string[]);
    assert.equal(deletedIds.has(toolAssistants[1].id), true);
    assert.equal(deletedIds.has(toolResults[1].id), true);
    assert.equal(deletedIds.has(toolAssistants[0].id), false);
    assert.equal(deletedIds.has(toolResults[0].id), false);

    const after = await getConversation(conversationId);
    assert.equal(after.messages.some((message: any) => message.id === toolAssistants[0].id), true);
    assert.equal(after.messages.some((message: any) => message.id === toolResults[0].id), true);
    assert.equal(after.messages.some((message: any) => message.id === toolAssistants[1].id), false);
    assert.equal(after.messages.some((message: any) => message.id === toolResults[1].id), false);
  });

  await t.test("message deletion is scoped to its conversation", async () => {
    const firstConversationId = await createConversation();
    const secondConversationId = await createConversation();
    await sendChat(firstConversationId, { content: "first conversation" });
    await sendChat(secondConversationId, { content: "second conversation" });
    const secondBefore = await getConversation(secondConversationId);
    const secondMessageId = secondBefore.messages[0].id as string;

    const wrongConversation = await app.inject({
      method: "DELETE",
      url: `/api/conversations/${firstConversationId}/messages/${secondMessageId}`,
    });
    assert.equal(wrongConversation.statusCode, 404);
    const secondAfterWrongDelete = await getConversation(secondConversationId);
    assert.equal(secondAfterWrongDelete.messages.length, secondBefore.messages.length);

    const correctConversation = await app.inject({
      method: "DELETE",
      url: `/api/conversations/${secondConversationId}/messages/${secondMessageId}`,
    });
    assert.equal(correctConversation.statusCode, 200);
    const secondAfterDelete = await getConversation(secondConversationId);
    assert.equal(secondAfterDelete.messages.some((message: any) => message.id === secondMessageId), false);
  });

  await t.test("deleting a conversation cascades to all message rows", async () => {
    const conversationId = await createConversation();
    await sendChat(conversationId, { content: "cascade" });
    const before = await db
      .select()
      .from(messageTable)
      .where(eq(messageTable.conversationId, conversationId));
    assert.ok(before.length > 0);

    const response = await app.inject({
      method: "DELETE",
      url: `/api/conversations/${conversationId}`,
    });
    assert.equal(response.statusCode, 200);
    const after = await db
      .select()
      .from(messageTable)
      .where(eq(messageTable.conversationId, conversationId));
    assert.deepEqual(after, []);
  });
});
