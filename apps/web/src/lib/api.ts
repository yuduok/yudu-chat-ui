import type {
  AgentProfile,
  ChatMessage,
  Conversation,
  ConversationWithMessages,
  ProviderConfig,
  StreamEvent,
  ChatRequest,
} from "@yudu/shared";

const BASE = "/api";

export async function listConversations(): Promise<Conversation[]> {
  const r = await fetch(`${BASE}/conversations`);
  if (!r.ok) throw new Error("listConversations failed");
  return r.json();
}

export async function createConversation(input: {
  title?: string;
  provider?: string;
  model?: string;
  systemPrompt?: string;
  temperature?: number;
  agentId?: string | null;
}): Promise<Conversation> {
  const r = await fetch(`${BASE}/conversations`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!r.ok) throw new Error("createConversation failed");
  return r.json();
}

export async function getConversation(id: string): Promise<ConversationWithMessages> {
  const r = await fetch(`${BASE}/conversations/${id}`);
  if (!r.ok) throw new Error("getConversation failed");
  return r.json();
}

export async function updateConversation(
  id: string,
  patch: Partial<
    Pick<Conversation, "title" | "provider" | "model" | "systemPrompt" | "temperature" | "agentId">
  >,
): Promise<Conversation> {
  const r = await fetch(`${BASE}/conversations/${id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!r.ok) throw new Error("updateConversation failed");
  return r.json();
}

export async function deleteConversation(id: string): Promise<void> {
  await fetch(`${BASE}/conversations/${id}`, { method: "DELETE" });
}

export async function deleteMessage(conversationId: string, messageId: string): Promise<void> {
  await fetch(`${BASE}/conversations/${conversationId}/messages/${messageId}`, { method: "DELETE" });
}

export async function listProviders(): Promise<ProviderConfig[]> {
  const r = await fetch(`${BASE}/providers`);
  if (!r.ok) throw new Error("listProviders failed");
  return r.json();
}

export async function listAgents(): Promise<AgentProfile[]> {
  const r = await fetch(`${BASE}/agents`);
  if (!r.ok) throw new Error("listAgents failed");
  return r.json();
}

export interface ProviderModels {
  provider: string;
  baseUrl: string | null;
  defaults: string[];
  manual: string[];
  models: string[];
  source: "remote" | "fallback";
  error?: string;
}

export async function getProviderModels(
  id: string,
  opts: { remote?: boolean } = {},
): Promise<ProviderModels> {
  const qs = opts.remote ? "?remote=1" : "";
  const r = await fetch(`${BASE}/providers/${encodeURIComponent(id)}/models${qs}`);
  if (!r.ok) throw new Error("getProviderModels failed");
  return r.json();
}

export interface Settings {
  providers: Record<string, { apiKeyMasked?: string; baseUrl?: string; manualModels: string[] }>;
  ui: { theme: "light" | "dark" | "system" };
}

export async function getSettings(): Promise<Settings> {
  const r = await fetch(`${BASE}/settings`);
  if (!r.ok) throw new Error("getSettings failed");
  return r.json();
}

export async function saveSettings(input: {
  providers: Record<string, { apiKey?: string; baseUrl?: string; manualModels?: string[] }>;
  ui?: { theme?: "light" | "dark" | "system" };
}): Promise<void> {
  await fetch(`${BASE}/settings`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
}

export interface StreamCallbacks {
  onToolCall?: (call: {
    id: string;
    name: string;
    arguments: Record<string, unknown> | string;
  }) => void;
  onToolResult?: (result: {
    toolCallId: string;
    agentId?: string;
    content: string;
    isError?: boolean;
  }) => void;
  onAgentEvent?: (event: {
    kind: "started" | "finished";
    agentId: string;
    label: string;
  }) => void;
}

export async function* streamChat(
  req: ChatRequest,
  signal: AbortSignal,
  callbacks: StreamCallbacks = {},
): AsyncGenerator<StreamEvent, void, void> {
  const r = await fetch(`${BASE}/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(req),
    signal,
  });
  if (!r.ok || !r.body) {
    const text = await r.text().catch(() => "");
    throw new Error(`Chat failed: ${r.status} ${text || r.statusText}`);
  }
  const reader = r.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf("\n\n")) !== -1) {
      const raw = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      for (const line of raw.split("\n")) {
        const t = line.trim();
        if (!t.startsWith("data:")) continue;
        const payload = t.slice(5).trim();
        if (!payload) continue;
        try {
          const ev = JSON.parse(payload) as StreamEvent;
          // Dispatch side-channel callbacks alongside the streamed event so
          // callers can update tool/agent UI without re-matching types.
          if (ev.type === "tool_call") callbacks.onToolCall?.(ev.call);
          else if (ev.type === "tool_result") callbacks.onToolResult?.(ev);
          else if (ev.type === "agent_started") callbacks.onAgentEvent?.({ kind: "started", ...ev });
          else if (ev.type === "agent_finished") callbacks.onAgentEvent?.({ kind: "finished", ...ev });
          yield ev;
          if (ev.type === "done" || ev.type === "error") return;
        } catch {
          // ignore malformed frames
        }
      }
    }
  }
}

export type { ChatMessage };
