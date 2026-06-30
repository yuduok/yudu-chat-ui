import { create } from "zustand";
import type { ChatMessage, Conversation } from "@yudu/shared";
import * as api from "@/lib/api";

interface ChatState {
  conversations: Conversation[];
  activeId: string | null;
  messages: ChatMessage[];
  streaming: boolean;
  // Per-conversation error to surface in the UI
  error: string | null;

  // Actions
  loadConversations: () => Promise<void>;
  createConversation: (init?: Partial<Pick<Conversation, "title" | "provider" | "model">>) => Promise<Conversation>;
  selectConversation: (id: string | null) => Promise<void>;
  deleteConversation: (id: string) => Promise<void>;
  renameConversation: (id: string, title: string) => Promise<void>;
  updateConversationSettings: (
    id: string,
    patch: Partial<Pick<Conversation, "provider" | "model" | "systemPrompt" | "temperature">>,
  ) => Promise<void>;
  deleteMessage: (id: string) => Promise<void>;

  // Streaming
  sendMessage: (content: string, opts?: { regenerate?: boolean; editLastUser?: boolean }) => Promise<void>;
  stop: () => void;
}

let currentAbort: AbortController | null = null;

export const useChat = create<ChatState>((set, get) => ({
  conversations: [],
  activeId: null,
  messages: [],
  streaming: false,
  error: null,

  async loadConversations() {
    const list = await api.listConversations();
    set({ conversations: list });
  },

  async createConversation(init) {
    const conv = await api.createConversation({
      provider: init?.provider ?? "mock",
      model: init?.model ?? "mock-1",
      title: init?.title,
    });
    set((s) => ({ conversations: [conv, ...s.conversations], activeId: conv.id, messages: [] }));
    return conv;
  },

  async selectConversation(id) {
    if (get().streaming) get().stop();
    set({ activeId: id, messages: [], error: null });
    if (!id) return;
    const detail = await api.getConversation(id);
    set({ messages: detail.messages });
  },

  async deleteConversation(id) {
    await api.deleteConversation(id);
    set((s) => ({
      conversations: s.conversations.filter((c) => c.id !== id),
      activeId: s.activeId === id ? null : s.activeId,
      messages: s.activeId === id ? [] : s.messages,
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

  stop() {
    currentAbort?.abort();
    currentAbort = null;
    set({ streaming: false });
  },

  async sendMessage(content, opts) {
    const { activeId, messages } = get();
    if (!activeId) return;
    if (get().streaming) return;

    set({ streaming: true, error: null });

    // Optimistically mutate local history so the UI updates immediately.
    let working: ChatMessage[] = messages;

    if (opts?.regenerate) {
      // drop trailing assistant message(s) before re-requesting
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
    // Append a placeholder assistant message
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
      for await (const ev of api.streamChat(
        {
          conversationId: activeId,
          content,
          regenerate: opts?.regenerate,
          editLastUser: opts?.editLastUser,
        },
        ac.signal,
      )) {
        if (ev.type === "delta") {
          acc += ev.text;
          set((s) => ({
            messages: s.messages.map((m) =>
              m.id === placeholderId ? { ...m, content: acc } : m,
            ),
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
          // refresh the sidebar so titles/timestamps stay in sync
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
