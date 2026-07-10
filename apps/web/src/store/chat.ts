import { create, type StoreApi } from "zustand";
import type { ChatMessage, Conversation } from "@yudu/shared";
import * as api from "@/lib/api";
import { useUiDefaults } from "@/store/ui-defaults";

// ---------- Activity panel (tool calls + agent orchestration) ----------

export interface ActiveToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown> | string;
  status: "running" | "ok" | "error";
  result?: string;
  isError?: boolean;
  agentId?: string;
  startedAt: number;
  finishedAt?: number;
}

export interface ActiveAgentEvent {
  kind: "started" | "finished";
  agentId: string;
  label: string;
  ts: number;
}

interface ChatState {
  conversations: Conversation[];
  activeId: string | null;
  messages: ChatMessage[];
  streaming: boolean;
  error: string | null;

  // Tool + agent orchestration activity for the active turn. Reset on
  // conversation switch and after each successful send.
  activeToolCalls: ActiveToolCall[];
  activeAgentEvents: ActiveAgentEvent[];

  // Open tabs — the set of conversation ids the user has opened in
  // the current session, shown in the header tab strip. Distinct from
  // `conversations` (the full DB list shown in the sidebar) and from
  // `activeId` (the currently focused conversation). Clicking a
  // sidebar entry, creating a new chat, or importing a conversation
  // pins a tab here. Closing a tab drops its id from this set; the
  // conversation itself stays in the DB and in the sidebar so the
  // user can re-open it.
  openTabs: string[];

  // Actions
  // Drop a tab from the header strip without touching the DB. If the
  // tab being closed is the active one, the next available tab (or
  // `null` if none) becomes the active conversation.
  closeTab: (id: string) => void;
  loadConversations: () => Promise<void>;
  createConversation: (
    init?: Partial<
      Pick<
        Conversation,
        "title" | "provider" | "model" | "agentId" | "reasoningEffort" | "showThinking"
      >
    >,
  ) => Promise<Conversation>;
  selectConversation: (id: string | null) => Promise<void>;
  deleteConversation: (id: string) => Promise<void>;
  renameConversation: (id: string, title: string) => Promise<void>;
  updateConversationSettings: (
    id: string,
    patch: Partial<
      Pick<
        Conversation,
        | "provider"
        | "model"
        | "systemPrompt"
        | "temperature"
        | "agentId"
        | "reasoningEffort"
        | "showThinking"
      >
    >,
  ) => Promise<void>;
  // Apply a "global" settings patch to every conversation row.
  // The composer / agent / effort menus call this so changing the
  // provider / model / agent / reasoning-depth / show-thinking in
  // any tab is reflected across all tabs without the user having
  // to re-pick the same option. Title / systemPrompt / temperature
  // are intentionally NOT in this patch — those stay per-row.
  applyGlobalSettings: (
    patch: Partial<
      Pick<
        Conversation,
        "provider" | "model" | "agentId" | "reasoningEffort" | "showThinking"
      >
    >,
  ) => Promise<void>;
  deleteMessage: (id: string) => Promise<void>;
  // Import a previously-exported conversation JSON object. The server
  // re-keys ids so the import never collides with existing data; we
  // then prepend the new conversation to the sidebar and select it.
  importConversationFromObject: (payload: unknown) => Promise<Conversation>;

  // Activity actions (mostly internal; the sendMessage loop uses them)
  resetActivity: () => void;
  pushToolCall: (call: { id: string; name: string; arguments: Record<string, unknown> | string }) => void;
  resolveToolCall: (toolCallId: string, content: string, isError?: boolean, agentId?: string) => void;
  pushAgentEvent: (ev: { kind: "started" | "finished"; agentId: string; label: string }) => void;

  // Streaming
  sendMessage: (
    content: string,
    opts?: {
      regenerate?: boolean;
      editLastUser?: boolean;
      editMessageId?: string;
      useTools?: boolean;
      reasoningEffort?: "low" | "medium" | "high" | "xhigh";
      showThinking?: boolean;
      parts?: ChatMessage["parts"];
    },
  ) => Promise<void>;
  stop: () => void;
}

interface ActiveChatRequest {
  id: number;
  conversationId: string;
  serverRequestId: string;
  controller: AbortController;
}

let requestSequence = 0;
let activeRequest: ActiveChatRequest | null = null;
let globalSettingsQueue: Promise<void> = Promise.resolve();
let globalSettingsRevision = 0;
const globalSettingsFieldRevision = new Map<string, number>();
let conversationMutationRevision = 0;
let conversationListRequestSequence = 0;
let conversationDetailRequestSequence = 0;
let conversationMessageRevision = 0;

interface ConversationDetailGuard {
  requestId: number;
  messageRevision: number;
}

function beginConversationDetailRequest(): ConversationDetailGuard {
  return {
    requestId: ++conversationDetailRequestSequence,
    messageRevision: conversationMessageRevision,
  };
}

function isConversationDetailCurrent(
  guard: ConversationDetailGuard,
  conversationId: string,
  activeId: string | null,
): boolean {
  return (
    guard.requestId === conversationDetailRequestSequence &&
    guard.messageRevision === conversationMessageRevision &&
    activeId === conversationId
  );
}

function createServerRequestId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `chat-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function abortChatRequest(request: ActiveChatRequest): void {
  // HTTP reader cancellation alone is not guaranteed to close a reused
  // connection. The explicit request id makes queued cancellation reliable.
  void api.cancelChat(request.serverRequestId).catch(() => {});
  request.controller.abort();
}

function supersedeActiveRequest(): void {
  const request = activeRequest;
  if (!request) return;
  abortChatRequest(request);
  if (activeRequest === request) activeRequest = null;
}

async function refreshActiveMessages(
  conversationId: string,
  get: StoreApi<ChatState>["getState"],
  set: StoreApi<ChatState>["setState"],
  stillValid: () => boolean = () => true,
): Promise<boolean> {
  if (!stillValid() || get().activeId !== conversationId) return false;
  const guard = beginConversationDetailRequest();
  const detail = await api.getConversation(conversationId);
  if (
    !stillValid() ||
    !isConversationDetailCurrent(guard, conversationId, get().activeId)
  ) {
    return false;
  }
  set({ messages: detail.messages });
  return true;
}

export const useChat = create<ChatState>((set, get) => ({
  conversations: [],
  activeId: null,
  messages: [],
  streaming: false,
  error: null,
  activeToolCalls: [],
  activeAgentEvents: [],
  openTabs: [],

  closeTab(id) {
    // Decide the fallback active id *before* mutating state so the
    // neighbor pick is based on the pre-close tab order.
    const before = get();
    const closingActive = before.activeId === id;
    if (closingActive && before.streaming) supersedeActiveRequest();
    const idx = before.openTabs.indexOf(id);
    const stillInStrip = before.openTabs.filter((x) => x !== id);
    let fallback: string | null = before.activeId;
    if (closingActive) {
      // Prefer the next neighbor; otherwise the previous; otherwise
      // whatever's still in the strip; otherwise null.
      const next = stillInStrip[idx] ?? stillInStrip[idx - 1] ?? stillInStrip[0] ?? null;
      fallback = next;
    }
    set({
      openTabs: stillInStrip,
      // If we just closed the active tab, move focus to the next
      // available tab (or clear the active conversation entirely if
      // there are none left).
      activeId: fallback,
      messages: closingActive ? [] : before.messages,
      activeToolCalls: closingActive ? [] : before.activeToolCalls,
      activeAgentEvents: closingActive ? [] : before.activeAgentEvents,
      error: closingActive ? null : before.error,
      streaming: closingActive ? false : before.streaming,
    });
    if (closingActive && fallback) {
      // Re-load messages for the now-active tab.
      void refreshActiveMessages(fallback, get, set).catch(() => {});
    }
  },

  async loadConversations() {
    const requestId = ++conversationListRequestSequence;
    const revisionAtStart = conversationMutationRevision;
    const list = await api.listConversations();
    if (
      requestId !== conversationListRequestSequence ||
      revisionAtStart !== conversationMutationRevision
    ) {
      return;
    }
    // Convergence: if localStorage has never been written to for the
    // UI defaults (i.e. this is the first load with the new global-
    // settings model — every prior conversation was using its own
    // per-row values), seed the defaults from the most-recently
    // updated row so existing users don't see the active chat reset
    // to mock/mock-1 after the upgrade. After this one-shot, the
    // user-owned localStorage entry takes over and `applyGlobal…`
    // keeps it (and the DB) in sync across every tab.
    const ui = useUiDefaults.getState();
    const hasPersisted =
      typeof window !== "undefined" &&
      !!window.localStorage.getItem("yudu-ui-defaults");
    if (!hasPersisted && list.length > 0) {
      const latest = list.slice().sort((a, b) => b.updatedAt - a.updatedAt)[0];
      ui.hydrate({
        provider: latest.provider,
        model: latest.model,
        agentId: latest.agentId ?? null,
        reasoningEffort:
          (latest.reasoningEffort as UiReasoningEffort) ?? null,
        showThinking: latest.showThinking ?? true,
      });
    }
    const before = get();
    const ids = new Set(list.map((conversation) => conversation.id));
    const keptTabs = before.openTabs.filter((id) => ids.has(id));
    const openTabs =
      keptTabs.length > 0 ? keptTabs : list.length > 0 ? [list[0].id] : [];
    const activeId =
      before.activeId && ids.has(before.activeId)
        ? before.activeId
        : openTabs[0] ?? null;
    const activeChanged = activeId !== before.activeId;
    set({
      conversations: list,
      openTabs,
      activeId,
      ...(activeChanged
        ? {
            messages: [],
            error: null,
            activeToolCalls: [],
            activeAgentEvents: [],
          }
        : {}),
    });
    if (activeChanged && activeId) {
      await refreshActiveMessages(activeId, get, set);
    }
  },

  // Import a previously-exported conversation JSON object. The server
  // re-keys ids so the import never collides with existing data; we
  // then prepend the new conversation to the sidebar and select it.
  async importConversationFromObject(payload: unknown) {
    const interruptedId = get().streaming ? get().activeId : null;
    const recoveryMessageRevision = conversationMessageRevision;
    if (interruptedId) {
      supersedeActiveRequest();
      set({ streaming: false, activeToolCalls: [], activeAgentEvents: [], error: null });
    }
    let conv: Conversation;
    try {
      conv = await api.importConversation(payload);
    } catch (error: any) {
      if (interruptedId && get().activeId === interruptedId) {
        try {
          const canRecover = () =>
            recoveryMessageRevision === conversationMessageRevision && !get().streaming;
          await refreshActiveMessages(interruptedId, get, set, canRecover);
        } catch {}
      }
      set({ error: error?.message ?? "Failed to import conversation." });
      throw error;
    }
    conversationMutationRevision += 1;
    set((s) => ({
      conversations: [conv, ...s.conversations],
      activeId: conv.id,
      messages: [],
      // Reset transient UI state from any prior conversation so the
      // imported one starts with a clean Activity panel.
      activeToolCalls: [],
      activeAgentEvents: [],
      error: null,
      streaming: false,
      openTabs: s.openTabs.includes(conv.id) ? s.openTabs : [conv.id, ...s.openTabs],
    }));
    await refreshActiveMessages(conv.id, get, set);
    return conv;
  },


  async createConversation(init) {
    const interruptedId = get().streaming ? get().activeId : null;
    const recoveryMessageRevision = conversationMessageRevision;
    if (interruptedId) {
      supersedeActiveRequest();
      set({ streaming: false, activeToolCalls: [], activeAgentEvents: [], error: null });
    }
    // Inherit the user's last-picked defaults so a brand-new chat
    // starts with the same provider / model / agent / reasoning-depth
    // / show-thinking as their previous one, instead of silently
    // dropping back to mock. Explicit `init` overrides win.
    const ui = useUiDefaults.getState();
    let conv: Conversation;
    try {
      conv = await api.createConversation({
        provider: init?.provider ?? ui.provider,
        model: init?.model ?? ui.model,
        title: init?.title,
        agentId: init?.agentId ?? ui.agentId ?? null,
        reasoningEffort: init?.reasoningEffort ?? ui.reasoningEffort ?? null,
        showThinking: init?.showThinking ?? ui.showThinking ?? true,
      });
    } catch (error: any) {
      if (interruptedId && get().activeId === interruptedId) {
        try {
          const canRecover = () =>
            recoveryMessageRevision === conversationMessageRevision && !get().streaming;
          await refreshActiveMessages(interruptedId, get, set, canRecover);
        } catch {}
      }
      set({ error: error?.message ?? "Failed to create conversation." });
      throw error;
    }
    conversationMutationRevision += 1;
    set((s) => ({
      conversations: [conv, ...s.conversations],
      activeId: conv.id,
      messages: [],
      activeToolCalls: [],
      activeAgentEvents: [],
      // Auto-open the new conversation in the tab strip.
      openTabs: s.openTabs.includes(conv.id) ? s.openTabs : [conv.id, ...s.openTabs],
    }));
    return conv;
  },

  async selectConversation(id) {
    if (id === get().activeId) return;
    if (get().streaming) supersedeActiveRequest();
    set((s) => ({
      activeId: id,
      messages: [],
      error: null,
      activeToolCalls: [],
      activeAgentEvents: [],
      streaming: false,
      // Selecting a sidebar entry (or anything that focuses a
      // conversation) pins its tab in the header so the user can
      // switch back to it without re-opening from the sidebar.
      openTabs: id == null || s.openTabs.includes(id) ? s.openTabs : [id, ...s.openTabs],
    }));
    if (!id) return;
    await refreshActiveMessages(id, get, set);
  },

  async deleteConversation(id) {
    // Abort any in-flight stream that belongs to this conversation
    // before removing it so we don't try to persist a message into a
    // conversation row that no longer exists.
    const interrupted = get().activeId === id && get().streaming;
    const recoveryMessageRevision = conversationMessageRevision;
    if (interrupted) {
      supersedeActiveRequest();
      set({ streaming: false, activeToolCalls: [], activeAgentEvents: [], error: null });
    }
    try {
      await api.deleteConversation(id);
    } catch (error: any) {
      if (interrupted && get().activeId === id) {
        try {
          const canRecover = () =>
            recoveryMessageRevision === conversationMessageRevision && !get().streaming;
          await refreshActiveMessages(id, get, set, canRecover);
        } catch {}
      }
      set({ error: error?.message ?? "Failed to delete conversation." });
      throw error;
    }
    conversationMutationRevision += 1;
    set((s) => ({
      conversations: s.conversations.filter((c) => c.id !== id),
      activeId: s.activeId === id ? null : s.activeId,
      messages: s.activeId === id ? [] : s.messages,
      activeToolCalls: s.activeId === id ? [] : s.activeToolCalls,
      activeAgentEvents: s.activeId === id ? [] : s.activeAgentEvents,
      error: s.activeId === id ? null : s.error,
      streaming: s.activeId === id ? false : s.streaming,
      openTabs: s.openTabs.filter((x) => x !== id),
    }));
  },

  async renameConversation(id, title) {
    await api.updateConversation(id, { title });
    conversationMutationRevision += 1;
    set((s) => ({
      conversations: s.conversations.map((c) => (c.id === id ? { ...c, title } : c)),
    }));
  },

  async updateConversationSettings(id, patch) {
    const updated = await api.updateConversation(id, patch);
    conversationMutationRevision += 1;
    set((s) => ({
      conversations: s.conversations.map((c) => (c.id === id ? updated : c)),
    }));
  },

  async applyGlobalSettings(patch) {
    const before = new Map(get().conversations.map((conversation) => [conversation.id, conversation]));
    const fields = Object.keys(patch) as Array<keyof typeof patch>;
    const revision = ++globalSettingsRevision;
    conversationMutationRevision += 1;
    for (const field of fields) globalSettingsFieldRevision.set(field, revision);
    set((s) => ({
      conversations: s.conversations.map((c) => ({ ...c, ...patch })),
    }));

    const operation = globalSettingsQueue.then(async () => {
      const updated = await api.applyGlobalConversationSettings(patch);
      const byId = new Map(updated.map((conversation) => [conversation.id, conversation]));
      set((state) => ({
        conversations: state.conversations.map((conversation) => {
          const server = byId.get(conversation.id);
          if (!server) return conversation;
          const next = { ...conversation };
          for (const field of fields) {
            // A newer optimistic write to the same field wins over this older response.
            if (globalSettingsFieldRevision.get(field) === revision) {
              (next as any)[field] = server[field];
            }
          }
          next.updatedAt = Math.max(next.updatedAt, server.updatedAt);
          return next;
        }),
      }));
    });
    globalSettingsQueue = operation.catch(() => {});

    try {
      await operation;
    } catch (error: any) {
      let canonical: Conversation[] | null = null;
      try {
        canonical = await api.listConversations();
      } catch {}
      const canonicalById = new Map(
        (canonical ?? []).map((conversation) => [conversation.id, conversation]),
      );
      const current = get();
      const defaultsSource =
        canonicalById.get(current.activeId ?? "") ?? canonical?.[0] ??
        (current.activeId ? before.get(current.activeId) : undefined) ?? before.values().next().value;
      const defaultsPatch: Partial<UiDefaults> = {};
      for (const field of fields) {
        if (globalSettingsFieldRevision.get(field) !== revision || !defaultsSource) continue;
        if (field === "provider") defaultsPatch.provider = defaultsSource.provider;
        else if (field === "model") defaultsPatch.model = defaultsSource.model;
        else if (field === "agentId") defaultsPatch.agentId = defaultsSource.agentId ?? null;
        else if (field === "reasoningEffort") {
          defaultsPatch.reasoningEffort =
            (defaultsSource.reasoningEffort as UiReasoningEffort) ?? null;
        } else if (field === "showThinking") {
          defaultsPatch.showThinking = defaultsSource.showThinking ?? true;
        }
      }
      if (Object.keys(defaultsPatch).length > 0) {
        useUiDefaults.getState().hydrate(defaultsPatch);
      }
      set((state) => ({
        error: error?.message ?? "Failed to save conversation settings.",
        conversations: state.conversations.map((conversation) => {
          const source = canonicalById.get(conversation.id) ?? before.get(conversation.id);
          if (!source) return conversation;
          const next = { ...conversation };
          for (const field of fields) {
            if (globalSettingsFieldRevision.get(field) === revision) {
              (next as any)[field] = source[field];
            }
          }
          return next;
        }),
      }));
    }
  },

  async deleteMessage(id) {
    const activeId = get().activeId;
    if (!activeId) return;
    const deletedIds = new Set(await api.deleteMessage(activeId, id));
    if (get().activeId !== activeId) return;
    conversationMutationRevision += 1;
    conversationMessageRevision += 1;
    set((s) => ({ messages: s.messages.filter((message) => !deletedIds.has(message.id)) }));
  },

  resetActivity() {
    set({ activeToolCalls: [], activeAgentEvents: [] });
  },

  pushToolCall(call) {
    set((s) => {
      // Avoid duplicates if a tool_call chunk is replayed.
      if (s.activeToolCalls.some((c) => c.id === call.id)) return s;
      return {
        activeToolCalls: [
          ...s.activeToolCalls,
          {
            id: call.id,
            name: call.name,
            arguments: call.arguments,
            status: "running",
            startedAt: Date.now(),
          },
        ],
      };
    });
  },

  resolveToolCall(toolCallId, content, isError, agentId) {
    set((s) => ({
      activeToolCalls: s.activeToolCalls.map((c) =>
        c.id === toolCallId
          ? {
              ...c,
              status: isError ? "error" : "ok",
              result: content,
              isError,
              agentId: agentId ?? c.agentId,
              finishedAt: Date.now(),
            }
          : c,
      ),
    }));
  },

  pushAgentEvent(ev) {
    set((s) => ({
      activeAgentEvents: [...s.activeAgentEvents, { ...ev, ts: Date.now() }],
    }));
  },

  stop() {
    const request = activeRequest;
    if (request) abortChatRequest(request);
  },

  async sendMessage(content, opts) {
    const { activeId, messages } = get();
    if (!activeId) return;
    if (get().streaming) return;

    set({ streaming: true, error: null, activeToolCalls: [], activeAgentEvents: [] });

    // Optimistically mutate local history so the UI updates immediately.
    let working: ChatMessage[] = messages;

    if (opts?.regenerate) {
      const lastUserIndex = working.map((message) => message.role).lastIndexOf("user");
      if (lastUserIndex === -1) {
        set({ streaming: false, error: "There is no user message to regenerate." });
        return;
      }
      working = working.slice(0, lastUserIndex + 1);
    } else if (opts?.editMessageId) {
      const targetIndex = working.findIndex(
        (message) => message.id === opts.editMessageId && message.role === "user",
      );
      if (targetIndex === -1) {
        set({ streaming: false, error: "The message being edited is no longer available." });
        return;
      }
      working = [
        ...working.slice(0, targetIndex),
        {
          ...working[targetIndex],
          content,
          parts: opts.parts ?? null,
        },
      ];
    } else if (opts?.editLastUser) {
      const targetIndex = working.map((message) => message.role).lastIndexOf("user");
      if (targetIndex === -1) {
        set({ streaming: false, error: "There is no user message to edit." });
        return;
      }
      working = [
        ...working.slice(0, targetIndex),
        {
          ...working[targetIndex],
          content,
          parts: opts?.parts ?? null,
        },
      ];
    } else {
      working = [
        ...working,
        {
          id: `local-${Date.now()}`,
          conversationId: activeId,
          role: "user",
          content,
          parts: opts?.parts ?? null,
          createdAt: Date.now(),
        },
      ];
    }
    const placeholderId = `local-assistant-${Date.now()}`;
    working = [
      ...working,
      {
        id: placeholderId,
        conversationId: activeId,
        role: "assistant",
        content: "",
        createdAt: Date.now(),
      },
    ];
    conversationMutationRevision += 1;
    conversationMessageRevision += 1;
    set({ messages: working });

    const ac = new AbortController();
    const serverRequestId = createServerRequestId();
    const request: ActiveChatRequest = {
      id: ++requestSequence,
      conversationId: activeId,
      serverRequestId,
      controller: ac,
    };
    activeRequest = request;
    const ownsRequest = () => activeRequest?.id === request.id;
    let shouldReconcile = false;
    let pendingFrame: number | null = null;

    try {
      let acc = "";
      let accReasoning = "";
      const flushStreamingDraft = () => {
        pendingFrame = null;
        if (!ownsRequest()) return;
        set((state) => {
          const index = state.messages.findIndex((message) => message.id === placeholderId);
          if (index === -1) return state;
          const current = state.messages[index];
          const nonReasoning = (current.parts ?? []).filter((part) => part.type !== "reasoning");
          const parts: ChatMessage["parts"] = accReasoning
            ? [{ type: "reasoning", text: accReasoning }, ...nonReasoning]
            : nonReasoning.length
              ? nonReasoning
              : null;
          const nextMessages = state.messages.slice();
          nextMessages[index] = { ...current, content: acc, parts };
          return { messages: nextMessages };
        });
      };
      const scheduleStreamingDraft = () => {
        if (pendingFrame === null) {
          pendingFrame = window.requestAnimationFrame(flushStreamingDraft);
        }
      };
      const cancelStreamingDraft = () => {
        if (pendingFrame !== null) {
          window.cancelAnimationFrame(pendingFrame);
          pendingFrame = null;
        }
      };
      for await (const ev of api.streamChat(
        {
          conversationId: activeId,
          requestId: serverRequestId,
          content,
          parts: opts?.parts ?? undefined,
          regenerate: opts?.regenerate,
          editLastUser: opts?.editLastUser,
          editMessageId: opts?.editMessageId,
          useTools: opts?.useTools,
          reasoningEffort: opts?.reasoningEffort,
          showThinking: opts?.showThinking,
        },
        ac.signal,
        {
          onToolCall: (call) => {
            if (ownsRequest()) get().pushToolCall(call);
          },
          onToolResult: (r) => {
            if (ownsRequest()) {
              get().resolveToolCall(r.toolCallId, r.content, r.isError, r.agentId);
            }
          },
          onAgentEvent: (e) => {
            if (ownsRequest()) get().pushAgentEvent(e);
          },
        },
      )) {
        if (!ownsRequest()) continue;
        if (ev.type === "delta") {
          acc += ev.text;
          scheduleStreamingDraft();
        } else if (ev.type === "reasoning_delta") {
          accReasoning += ev.text;
          scheduleStreamingDraft();
        } else if (ev.type === "message") {
          cancelStreamingDraft();
          set((s) => ({
            messages: s.messages.map((m) =>
              m.id === placeholderId
                ? {
                    ...m,
                    id: ev.message.id,
                    content: ev.message.content || acc,
                    parts: ev.message.parts ?? m.parts ?? null,
                    toolCallIds: ev.message.toolCallIds ?? null,
                    promptTokens: ev.message.promptTokens,
                    completionTokens: ev.message.completionTokens,
                    createdAt: ev.message.createdAt,
                  }
                : m,
            ),
          }));
        } else if (ev.type === "usage") {
          set((s) => ({
            messages: s.messages.map((m) =>
              m.id === placeholderId
                ? { ...m, promptTokens: ev.promptTokens, completionTokens: ev.completionTokens }
                : m,
            ),
          }));
        } else if (ev.type === "error") {
          if (!(ac.signal.aborted && ev.message === "aborted")) {
            set({ error: ev.message });
          }
          shouldReconcile = true;
        } else if (ev.type === "done") {
          cancelStreamingDraft();
          await get().loadConversations();
          await refreshActiveMessages(activeId, get, set, ownsRequest);
        }
      }
    } catch (err: any) {
      shouldReconcile = true;
      if (ownsRequest() && err?.name !== "AbortError") {
        set({ error: err?.message ?? "Stream failed" });
      }
    } finally {
      if (pendingFrame !== null) window.cancelAnimationFrame(pendingFrame);
      if (!ownsRequest()) return;
      if (shouldReconcile && get().activeId === request.conversationId) {
        try {
          await refreshActiveMessages(activeId, get, set, ownsRequest);
        } catch {}
      }
      if (!ownsRequest()) return;
      activeRequest = null;
      set({ streaming: false });
    }
  },
}));
import type { ReasoningEffort as UiReasoningEffort, UiDefaults } from "@/store/ui-defaults";
