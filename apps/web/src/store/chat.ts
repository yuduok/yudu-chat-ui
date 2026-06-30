import { create } from "zustand";
import type { ChatMessage, Conversation } from "@yudu/shared";
import * as api from "@/lib/api";

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

  // Open tabs — the conversation ids currently shown as tabs in the
  // header strip. `loadConversations` mirrors every persisted
  // conversation here so the strip is the user's at-a-glance view of
  // all their chats (not just the ones they have focused this
  // session). Closing a tab drops its id from this set; the
  // conversation itself stays in `conversations` and the sidebar so
  // the user can re-open it from there.
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
      useTools?: boolean;
      reasoningEffort?: "low" | "medium" | "high" | "xhigh";
      showThinking?: boolean;
    },
  ) => Promise<void>;
  stop: () => void;
}

let currentAbort: AbortController | null = null;

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
    const idx = before.openTabs.indexOf(id);
    const stillInStrip = before.openTabs.filter((x) => x !== id);
    let fallback: string | null = before.activeId;
    if (before.activeId === id) {
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
      messages: fallback ? before.messages : [],
    });
    if (fallback) {
      // Re-load messages for the now-active tab.
      api.getConversation(fallback).then((detail) => {
        // Guard: the user might have switched tabs again before the
        // request resolved.
        if (get().activeId !== fallback) return;
        set({ messages: detail.messages });
      }).catch(() => {});
    }
  },

  async loadConversations() {
    const list = await api.listConversations();
    set({
      conversations: list,
      // Mirror the full conversation list into the tab strip so every
      // persisted conversation is reachable from the header — not just
      // the ones the user has explicitly focused in this session.
      // Closing a tab removes its id from this set; the conversation
      // itself stays in `conversations` (and the sidebar) until the
      // user deletes it from there.
      openTabs: list.map((c) => c.id),
    });
  },

  // Import a previously-exported conversation JSON object. The server
  // re-keys ids so the import never collides with existing data; we
  // then prepend the new conversation to the sidebar and select it.
  async importConversationFromObject(payload: unknown) {
    if (get().streaming) get().stop();
    const conv = await api.importConversation(payload);
    set((s) => ({
      conversations: [conv, ...s.conversations],
      activeId: conv.id,
      messages: [],
      // Reset transient UI state from any prior conversation so the
      // imported one starts with a clean Activity panel.
      activeToolCalls: [],
      activeAgentEvents: [],
      error: null,
      openTabs: s.openTabs.includes(conv.id) ? s.openTabs : [conv.id, ...s.openTabs],
    }));
    const detail = await api.getConversation(conv.id);
    set({ messages: detail.messages });
    return conv;
  },


  async createConversation(init) {
    const conv = await api.createConversation({
      provider: init?.provider ?? "mock",
      model: init?.model ?? "mock-1",
      title: init?.title,
      agentId: init?.agentId ?? null,
      reasoningEffort: init?.reasoningEffort ?? null,
      showThinking: init?.showThinking ?? true,
    });
    set((s) => ({
      conversations: [conv, ...s.conversations],
      activeId: conv.id,
      messages: [],
      activeToolCalls: [],
      activeAgentEvents: [],
      // Add the new conversation to the tab strip; other tabs keep
      // their position so the user's existing strip layout is
      // preserved.
      openTabs: s.openTabs.includes(conv.id) ? s.openTabs : [conv.id, ...s.openTabs],
    }));
    return conv;
  },

  async selectConversation(id) {
    if (get().streaming) get().stop();
    set((s) => ({
      activeId: id,
      messages: [],
      error: null,
      activeToolCalls: [],
      activeAgentEvents: [],
      // No openTabs mutation needed: loadConversations mirrors every
      // persisted conversation into the strip, so the focused
      // conversation is already represented there.
      openTabs: s.openTabs,
    }));
    if (!id) return;
    const detail = await api.getConversation(id);
    set({ messages: detail.messages });
  },

  async deleteConversation(id) {
    // Abort any in-flight stream that belongs to this conversation
    // before removing it so we don't try to persist a message into a
    // conversation row that no longer exists.
    if (get().activeId === id && get().streaming) get().stop();
    await api.deleteConversation(id);
    set((s) => ({
      conversations: s.conversations.filter((c) => c.id !== id),
      activeId: s.activeId === id ? null : s.activeId,
      messages: s.activeId === id ? [] : s.messages,
      activeToolCalls: s.activeId === id ? [] : s.activeToolCalls,
      activeAgentEvents: s.activeId === id ? [] : s.activeAgentEvents,
      error: s.activeId === id ? null : s.error,
      openTabs: s.openTabs.filter((x) => x !== id),
    }));
  },

  async renameConversation(id, title) {
    await api.updateConversation(id, { title });
    set((s) => ({
      conversations: s.conversations.map((c) => (c.id === id ? { ...c, title } : c)),
    }));
  },

  async updateConversationSettings(id, patch) {
    const updated = await api.updateConversation(id, patch);
    set((s) => ({
      conversations: s.conversations.map((c) => (c.id === id ? updated : c)),
    }));
  },

  async deleteMessage(id) {
    const activeId = get().activeId;
    if (!activeId) return;
    await api.deleteMessage(activeId, id);
    set((s) => ({ messages: s.messages.filter((m) => m.id !== id) }));
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
    currentAbort?.abort();
    currentAbort = null;
    set({ streaming: false });
  },

  async sendMessage(content, opts) {
    const { activeId, messages } = get();
    if (!activeId) return;
    if (get().streaming) return;

    set({ streaming: true, error: null, activeToolCalls: [], activeAgentEvents: [] });

    // Optimistically mutate local history so the UI updates immediately.
    let working: ChatMessage[] = messages;

    if (opts?.regenerate) {
      while (working.length && working[working.length - 1].role === "assistant") {
        working = working.slice(0, -1);
      }
    } else if (opts?.editLastUser) {
      if (working.length && working[working.length - 1].role === "user") {
        working = working.slice(0, -1);
      }
      working = [
        ...working,
        {
          id: `local-${Date.now()}`,
          conversationId: activeId,
          role: "user",
          content,
          createdAt: Date.now(),
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
    set({ messages: working });

    const ac = new AbortController();
    currentAbort = ac;

    try {
      let acc = "";
      let accReasoning = "";
      for await (const ev of api.streamChat(
        {
          conversationId: activeId,
          content,
          regenerate: opts?.regenerate,
          editLastUser: opts?.editLastUser,
          useTools: opts?.useTools,
          reasoningEffort: opts?.reasoningEffort,
          showThinking: opts?.showThinking,
        },
        ac.signal,
        {
          onToolCall: (call) => get().pushToolCall(call),
          onToolResult: (r) => get().resolveToolCall(r.toolCallId, r.content, r.isError, r.agentId),
          onAgentEvent: (e) => get().pushAgentEvent(e),
        },
      )) {
        if (ev.type === "delta") {
          acc += ev.text;
          set((s) => ({
            messages: s.messages.map((m) =>
              m.id === placeholderId ? { ...m, content: acc } : m,
            ),
          }));
        } else if (ev.type === "reasoning_delta") {
          accReasoning += ev.text;
          // Stage the live reasoning trace on the placeholder so the UI
          // can render a streaming thinking block. The server will rewrite
          // the parts blob on `message`.
          set((s) => ({
            messages: s.messages.map((m) => {
              if (m.id !== placeholderId) return m;
              const parts: NonNullable<ChatMessage["parts"]> = (
                (m.parts ?? []) as NonNullable<ChatMessage["parts"]>
              ).filter((p) => p.type !== "reasoning");
              parts.unshift({ type: "reasoning", text: accReasoning });
              return { ...m, parts };
            }),
          }));
        } else if (ev.type === "message") {
          set((s) => ({
            messages: s.messages.map((m) =>
              m.id === placeholderId
                ? {
                    ...m,
                    id: ev.message.id,
                    content: ev.message.content || acc,
                    promptTokens: ev.message.promptTokens,
                    completionTokens: ev.message.completionTokens,
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
          set({ error: ev.message });
        } else if (ev.type === "done") {
          void get().loadConversations();
        }
      }
    } catch (err: any) {
      if (err?.name !== "AbortError") {
        set({ error: err?.message ?? "Stream failed" });
      }
    } finally {
      currentAbort = null;
      set({ streaming: false });
    }
  },
}));
